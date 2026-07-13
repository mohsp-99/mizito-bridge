// src/config.ts
import path from "path";
var ROOT = path.resolve(process.env.MIZITO_DATA_DIR || process.cwd());
var WEB_BASE = "https://office.mizito.ir";
var WEB_LOGIN_URL = `${WEB_BASE}/#/lg/login`;
var API_BASE = "https://app.mizito.ir";
var API_PREFIX = "/api";
var LOGIN_PREFIX = "/capi";
var SESSION_CREATE_URL = `${API_BASE}${LOGIN_PREFIX}/session/create`;
var CDN_BASE = `${API_BASE}/cdn/`;
var TOKEN_HEADER = "x-token";
var AUTH_DIR = path.join(ROOT, "auth");
var DATA_DIR = path.join(ROOT, "data");
var STORAGE_STATE_PATH = path.join(AUTH_DIR, "storageState.json");
var SESSION_PATH = path.join(AUTH_DIR, "session.json");
var CREDENTIALS_PATH = path.join(AUTH_DIR, "credentials.json");
var TARGET_WORKSPACE = process.env.WORKSPACE || "";

// src/util.ts
import fs from "fs";
import path2 from "path";
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function writeJson(filePath, value) {
  ensureDir(path2.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  return filePath;
}
function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    if (fallback !== void 0) return fallback;
    throw err;
  }
}
function exists(p) {
  return fs.existsSync(p);
}
var ts = () => (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 19);
var log = {
  info: (...a) => console.log(`[${ts()}]`, ...a),
  ok: (...a) => console.log(`[${ts()}] \u2713`, ...a),
  warn: (...a) => console.warn(`[${ts()}] !`, ...a),
  err: (...a) => console.error(`[${ts()}] \u2717`, ...a)
};
function stripHtml(html) {
  if (html == null) return "";
  let s = String(html);
  s = s.replace(/<\s*\/?\s*(br|p|div|li|tr|h[1-6])\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/&nbsp;/gi, " ").replace(/&zwnj;/gi, "\u200C").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#0*39;/g, "'").replace(/&#(\d+);/g, (_, n) => {
    try {
      return String.fromCodePoint(Number(n));
    } catch {
      return "";
    }
  });
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}
function slug(name) {
  return String(name).trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 80);
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// src/transport/errors.ts
function codeForHttpStatus(httpStatus) {
  if (httpStatus === 401 || httpStatus === 403) return "auth";
  if (httpStatus === 429) return "rate_limit";
  if (httpStatus >= 500) return "server";
  return null;
}
var MizitoApiError = class extends Error {
  code;
  status;
  httpStatus;
  endpoint;
  body;
  constructor(message, { code, status, httpStatus, endpoint, body } = {}) {
    super(message);
    this.name = "MizitoApiError";
    this.code = code ?? (httpStatus != null ? codeForHttpStatus(httpStatus) ?? "api" : "api");
    this.status = status;
    this.httpStatus = httpStatus;
    this.endpoint = endpoint;
    this.body = body;
  }
};

// src/transport/http.ts
function createHttp({ tokens, pacingMs = 250 }) {
  function resolve(endpoint) {
    if (/^https?:\/\//.test(endpoint)) return endpoint;
    let p = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    if (!p.startsWith(API_PREFIX)) p = `${API_PREFIX}${p}`;
    return `${API_BASE}${p}`;
  }
  async function call(endpoint, payload = {}, { method = "POST", raw = false } = {}) {
    const url = resolve(endpoint);
    let lastErr;
    let healedAuth = false;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const token = await tokens.getToken();
        const init = {
          method,
          headers: {
            [TOKEN_HEADER]: token,
            accept: "application/json, text/javascript, */*; q=0.01",
            "content-type": "application/json;charset=UTF-8",
            origin: "https://office.mizito.ir",
            referer: "https://office.mizito.ir/"
          }
        };
        if (method !== "GET" && method !== "HEAD") {
          init.body = JSON.stringify(payload ?? {});
        }
        const res = await fetch(url, init);
        const text = await res.text();
        let json;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          json = { _nonJson: true, _raw: text };
        }
        if (res.status === 401 || res.status === 403) {
          if (!healedAuth && tokens.onAuthExpired) {
            const fresh = await tokens.onAuthExpired();
            if (fresh) {
              healedAuth = true;
              attempt--;
              continue;
            }
          }
          throw new MizitoApiError(`HTTP ${res.status} (auth) from ${endpoint}`, {
            code: "auth",
            httpStatus: res.status,
            endpoint,
            body: json
          });
        }
        if (res.status === 429 || res.status >= 500) {
          throw new MizitoApiError(`HTTP ${res.status} from ${endpoint}`, {
            code: res.status === 429 ? "rate_limit" : "server",
            httpStatus: res.status,
            endpoint,
            body: json
          });
        }
        if (pacingMs) await sleep(pacingMs);
        if (raw) return json;
        if (json && typeof json === "object" && "status" in json) {
          const env = json;
          if (env.status === 1 || env.status === true) {
            return env.data !== void 0 ? env.data : env;
          }
          throw new MizitoApiError(`API status ${env.status} for ${endpoint}: ${env.msg ?? ""}`, {
            code: "api",
            status: env.status,
            httpStatus: res.status,
            endpoint,
            body: json
          });
        }
        return json;
      } catch (err) {
        lastErr = err;
        const retriable = err instanceof MizitoApiError ? err.code === "rate_limit" || err.code === "server" : true;
        if (!retriable || attempt === 4) break;
        const backoff = 500 * attempt;
        log.warn(
          `${endpoint} failed (attempt ${attempt}): ${err.message}; retrying in ${backoff}ms`
        );
        await sleep(backoff);
      }
    }
    if (lastErr instanceof MizitoApiError) throw lastErr;
    throw new MizitoApiError(`Network failure for ${endpoint}: ${lastErr?.message ?? lastErr}`, {
      code: "network",
      endpoint
    });
  }
  return {
    call,
    resolve,
    currentToken: async () => tokens.getToken(),
    tokens
  };
}

// src/auth/hash.ts
import crypto from "crypto";
function hashPassword(password) {
  const md5 = crypto.createHash("md5").update(password, "utf8").digest("hex");
  const sha256 = crypto.createHash("sha256").update(password, "utf8").digest("hex");
  return `${md5}|${sha256}`;
}

// src/auth/session.ts
function tokenFromStorageState(storageState) {
  const origins = storageState?.origins ?? [];
  for (const o of origins) {
    if (!o.origin || !o.origin.includes("mizito.ir")) continue;
    const hit = (o.localStorage ?? []).find((kv) => kv.name === "token");
    if (hit?.value) return hit.value;
  }
  return null;
}
function saveSession({ token, user }, sessionPath = SESSION_PATH) {
  const session = { token, user: user ?? null, savedAt: (/* @__PURE__ */ new Date()).toISOString() };
  writeJson(sessionPath, session);
  return session;
}
function loadToken(sessionPath = SESSION_PATH) {
  if (exists(sessionPath)) {
    const s = readJson(sessionPath, {});
    if (s.token) return s.token;
  }
  if (exists(STORAGE_STATE_PATH)) {
    const token = tokenFromStorageState(readJson(STORAGE_STATE_PATH, {}));
    if (token) return token;
  }
  return null;
}
function requireToken() {
  const token = loadToken();
  if (!token) {
    log.err("No saved session. Run `npm run login` first.");
    process.exit(1);
  }
  return token;
}

// src/auth/login.ts
function describeLoginFailure(json) {
  switch (json?.status) {
    case 0:
      return "wrong username or password";
    case 7:
      return "this login requires a one-time code (OTP); pass loginCode";
    default:
      return json?.msg || json?.message || "";
  }
}
async function createSession({
  username,
  password,
  loginCode = "",
  regId = null,
  save = true
}) {
  if (!username || !password) {
    throw new Error("createSession: username and password are required.");
  }
  const res = await fetch(SESSION_CREATE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json;charset=UTF-8",
      accept: "application/json, text/javascript, */*; q=0.01",
      origin: WEB_BASE,
      referer: `${WEB_BASE}/`
    },
    body: JSON.stringify({ username, password: hashPassword(password), loginCode, regId })
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Login failed: non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  const ok = json.status === 1 || json.status === 5 || json.status === true;
  const token = json.token || json.data?.token || null;
  if (!ok || !token) {
    const hint = describeLoginFailure(json);
    throw new Error(`Mizito login failed (status ${json.status ?? "?"})${hint ? `: ${hint}` : ""}.`);
  }
  const user = json.user ?? json.data?.user ?? null;
  if (save) saveSession({ token, user });
  return { token, status: json.status ?? 1, user };
}

// src/auth/providers.ts
function loadCredentials() {
  const username = process.env.MIZITO_USERNAME || process.env.MIZITO_USER || null;
  const password = process.env.MIZITO_PASSWORD || process.env.MIZITO_PASS || null;
  if (username && password) {
    return {
      username,
      password,
      loginCode: process.env.MIZITO_LOGIN_CODE || "",
      regId: process.env.MIZITO_REG_ID || null
    };
  }
  if (exists(CREDENTIALS_PATH)) {
    const c = readJson(CREDENTIALS_PATH, {});
    if (c.username && c.password) {
      return {
        username: c.username,
        password: c.password,
        loginCode: c.loginCode || "",
        regId: c.regId ?? null
      };
    }
  }
  return null;
}
function hasCredentials() {
  return loadCredentials() != null;
}
async function reauthenticate() {
  const creds = loadCredentials();
  if (!creds) return null;
  return createSession(creds);
}
function staticToken(token) {
  if (!token) throw new Error("staticToken: no token (run `mizito login` or `mizito relogin`).");
  return {
    getToken: () => token,
    onAuthExpired: () => null
  };
}
function diskSession({ path: path5, credentials } = {}) {
  const login = async () => {
    const creds = credentials ?? loadCredentials();
    if (!creds) return null;
    const { token, user } = await createSession({ ...creds, save: false });
    saveSession({ token, user }, path5);
    return token;
  };
  return {
    async getToken() {
      const token = loadToken(path5);
      if (token) return token;
      const fresh = await login();
      if (fresh) return fresh;
      throw new MizitoApiError(
        "No Mizito session found. Run `mizito login` to sign in, or set MIZITO_USERNAME/MIZITO_PASSWORD (or auth/credentials.json) for automatic login.",
        { code: "auth" }
      );
    },
    async onAuthExpired() {
      const creds = credentials ?? loadCredentials();
      if (!creds) return null;
      console.error("[mizito] session expired \u2014 re-authenticating with stored credentials\u2026");
      return login();
    }
  };
}
function passwordSession(credentials) {
  if (!credentials?.username || !credentials?.password) {
    throw new Error("passwordSession: username and password are required.");
  }
  let cached = null;
  const login = async () => {
    const { token } = await createSession({ ...credentials, save: false });
    cached = token;
    return token;
  };
  return {
    async getToken() {
      return cached ?? login();
    },
    async onAuthExpired() {
      return login();
    }
  };
}

// src/resources/tasks.ts
function tasksResource(call) {
  return {
    // Every task in the (active/scoped) workspace — the authoritative source.
    // "My tasks" is derived by filtering this on assignee/responsible (see
    // feeds/index.ts). Note: `tasks/upcoming {outbox:false}` is a *feed* of
    // upcoming/unassigned tasks in dialogs you follow, NOT your assignments.
    getAll: () => call("tasks/getAll", {}),
    // The dashboard's personal feed. outbox:false = tasks coming to me
    // (assigned to / awaiting me) rather than ones I assigned out (outbox:true).
    upcoming: (outbox = false) => call("tasks/upcoming", { outbox, from_dashboard: true, from: null, filter: null }),
    badge: () => call("tasks/badge", {}),
    // Full comment thread for a task, addressed by the task's access_token JWT
    // (not its id). Returns an array of comments.
    getComments: (accessToken) => call("tasks/getComments", { token: accessToken }),
    // --- writes (mutating) ---
    // Create a task. `task` is the full add payload (title, assignee, project,
    // kanban_board, ...); returns the created task object (with _id,
    // access_token, dialog). Advanced-project tasks are posted into the project
    // chat group when `insert_to_chat_group` is true.
    add: (task) => call("tasks/add", task),
    // Edit an existing task. Needs `task_id` + the task's `token` (access_token).
    save: (task) => call("tasks/save", task),
    // Delete a task, addressed by its access_token JWT.
    remove: (accessToken) => call("tasks/removeTask", { token: accessToken }),
    // Add a comment to a task's thread (keyed by access_token, like getComments).
    newComment: ({ token, comment, attachments = [], mention = [], reply_id = null }) => call("tasks/newComment", { token, comment, attachments, mention, reply_id }),
    // Set a task's progress (0..100). 100 marks it completed server-side.
    updateProgress: (accessToken, progress) => call("tasks/updateProgress", { token: accessToken, progress }),
    // Complete (or reopen) a task. `project` is required by the API. On reopen
    // (completed:false) pass the target `progress` and optional `undone_user_id`.
    setCompleted: ({ token, completed, project, progress, undone_user_id = null }) => call("tasks/setCompleted", {
      token,
      completed,
      project,
      ...progress != null ? { progress } : {},
      undone_user_id
    })
  };
}

// src/resources/chat.ts
var CHAT_PAGE_SIZE = 15;
function chatResource(call) {
  const getHistory = (dialog, offset = 0) => call("chat/getHistory", { dialog, offset });
  return {
    getDialogs: () => call("chat/getDialogs", {}),
    getFullChat: (dialog) => call("chat/getFullChat", { dialog }),
    getHistory,
    // Combined view of a dialog (members, admins, pinned, counts, title).
    getChatView: (dialog) => call("chat/getChatView", { dialog }),
    // Full-text search across messages. mode='all' (or a dialog id); optional
    // search_str and bookmarked filter. Returns an array of matching messages.
    search: ({ mode = "all", offset = 0, search_str, bookmarked } = {}) => call("chat/search", {
      mode,
      offset,
      ...search_str ? { search_str } : {},
      ...bookmarked ? { bookmarked } : {}
    }),
    // --- writes (mutating) ---
    // Send a message to a dialog. `message` is the full outgoing message object
    // ({ _:'message', dialog, out:true, message, from, date, randomId, ... }).
    // Returns `true` on success (no message id echoed back).
    send: (message) => call("chat/send", message),
    // Delete a message you sent, addressed by dialog + message id (mid).
    removeSentMessage: (dialog, mid) => call("chat/removeSentMessage", { dialog, mid }),
    // Open (or return) a direct-message dialog with a user. Returns the dialog.
    createDialog: (user) => call("chat/createDialog", { user }),
    // Mark a dialog seen up to `seen_count` messages.
    seen: (dialog, seen_count) => call("chat/seen", { dialog, seen_count }),
    // Page through a dialog's entire message history. Returns all messages,
    // oldest-to-newest order as the API provides them.
    async fullHistory(dialog, { max = 1e5, onPage } = {}) {
      const all = [];
      let offset = 0;
      for (; ; ) {
        const page = await getHistory(dialog, offset);
        if (!Array.isArray(page) || page.length === 0) break;
        all.push(...page);
        if (onPage) onPage({ offset, size: page.length, total: all.length });
        offset += page.length;
        if (page.length < CHAT_PAGE_SIZE) break;
        if (all.length >= max) break;
      }
      return all;
    }
  };
}
function taskFromMessage(message) {
  if (message?.media?._ === "messageMediaTask" && message.media.task) {
    return message.media.task;
  }
  return null;
}

// src/resources/projects.ts
function projectsResource(call) {
  return {
    getList: () => call("projects/getList", {}),
    allSummary: () => call("projects/allSummary", {})
  };
}

// src/resources/labels.ts
function labelsResource(call) {
  return {
    getAll: (type = "task") => call("labels/getAll", { type })
  };
}

// src/resources/workspaces.ts
function tokenFromSwitch(sw) {
  if (!sw) return null;
  if (typeof sw === "string") return sw;
  const o = sw;
  return o.data?.token || o.token || null;
}
function workspacesResource(call) {
  return {
    // Identity + the account's workspaces (`workspace/userId`).
    bootstrap: () => call("workspace/userId", { regId: null }),
    // Switch the active workspace. Returns a NEW token scoped to that workspace;
    // the original token is unaffected (token-scoped, not account-wide state).
    // Raw response — use switchToken() for just the token.
    switchRaw: (workspace_id) => call("workspace/switch", { workspace_id }, { raw: true }),
    async switchToken(workspace_id) {
      return tokenFromSwitch(await call("workspace/switch", { workspace_id }, { raw: true }));
    },
    name: () => call("workspace/name", {}),
    planInfo: () => call("workspace/planInfo", {}),
    getUsers: () => call("workspace/getUsers", {})
  };
}

// src/resources/letters.ts
function lettersResource(call) {
  return {
    getInbox: (mode = "inbox", offset = 0, extra = {}) => call("inbox/getInbox", { mode, offset, ...extra }),
    getHistory: (thread) => call("inbox/getHistory", { thread }),
    getMessageLabels: (thread) => call("inbox/getMessageLabels", { thread }),
    badge: () => call("inbox/badge", {}),
    // --- writes (mutating). Recovered from the SPA bundle; unlike the
    // task/chat writes these are NOT yet exercised live — see docs/API_NOTES.md.
    // Compose/send a letter. `body` is the compose model:
    // { to:[uid], subject, content, attachments:[], tasks_insert_to_chat_groups:[],
    //   labels:[] } — plus `thread` when replying within an existing thread.
    send: (body) => call("inbox/send", body),
    seen: (thread) => call("inbox/seen", { thread }),
    // Archive/unarchive a letter thread. Sent (outbox) letters use the
    // `.sender` variant (dots map to slashes in the URL).
    archive: (thread, { outbox = false } = {}) => call(outbox ? "inbox/archive/sender" : "inbox/archive", { thread }),
    unarchive: (thread, { outbox = false } = {}) => call(outbox ? "inbox/unArchive/sender" : "inbox/unArchive", { thread }),
    toggleBookmark: (thread) => call("inbox/toggleBookmark", { thread })
  };
}

// src/resources/dashboard.ts
function dashboardResource(call) {
  return {
    getAllSummary: () => call("dashboard/getAllSummary", {}),
    getAllWorkspacesUsers: () => call("dashboard/getAllWorkspacesUsers", {})
  };
}

// src/resources/files.ts
function filesResource(http) {
  return {
    /**
     * Download an attachment by its CDN content token; returns the bytes.
     * Content tokens expire — re-read the comment/message for a fresh one if
     * a download fails.
     */
    async download(contentToken) {
      const token = await http.currentToken();
      const res = await fetch(CDN_BASE + contentToken, { headers: { [TOKEN_HEADER]: token } });
      if (!res.ok) {
        throw new MizitoApiError(`CDN returned HTTP ${res.status} for this attachment.`, {
          code: res.status === 401 || res.status === 403 ? "auth" : "server",
          httpStatus: res.status,
          endpoint: "cdn"
        });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length <= 32 && /invalid/i.test(buf.toString("utf8"))) {
        throw new MizitoApiError(
          'CDN returned an "invalid" stub \u2014 the content token is expired or scoped to a different workspace. Re-read the comment for a fresh token, and pass the workspace the task belongs to.',
          { code: "not_found", endpoint: "cdn" }
        );
      }
      return buf;
    }
  };
}

// src/client.ts
function createClient({ tokens, token, pacingMs = 200 } = {}) {
  const provider = tokens ?? (token != null ? staticToken(token) : diskSession());
  const http = createHttp({ tokens: provider, pacingMs });
  const workspaces = workspacesResource(http.call);
  const client = {
    http,
    call: http.call,
    resolve: http.resolve,
    currentToken: http.currentToken,
    tasks: tasksResource(http.call),
    chat: chatResource(http.call),
    projects: projectsResource(http.call),
    labels: labelsResource(http.call),
    workspaces: {
      ...workspaces,
      async switch(workspaceId) {
        const scoped = await workspaces.switchToken(workspaceId);
        if (!scoped) throw new Error(`Could not switch into workspace "${workspaceId}".`);
        return createClient({ token: scoped, pacingMs });
      }
    },
    letters: lettersResource(http.call),
    dashboard: dashboardResource(http.call),
    files: filesResource(http)
  };
  return client;
}
function createMizito({ token, pacingMs = 200 } = {}) {
  const c = createClient(token != null ? { token, pacingMs } : { pacingMs });
  return {
    /** Raw transport view ({ call, resolve }); token resolves via the provider. */
    client: { call: c.call, resolve: c.resolve, token, currentToken: c.currentToken },
    // --- workspace ---
    bootstrap: () => c.workspaces.bootstrap(),
    switchWorkspace: (workspace_id) => c.workspaces.switchRaw(workspace_id),
    workspaceName: () => c.workspaces.name(),
    planInfo: () => c.workspaces.planInfo(),
    members: () => c.workspaces.getUsers(),
    // --- projects ---
    projects: () => c.projects.getList(),
    projectSummaries: () => c.projects.allSummary(),
    // --- labels ---
    taskLabels: () => c.labels.getAll("task"),
    // --- tasks ---
    taskComments: (accessToken) => c.tasks.getComments(accessToken),
    addTask: (task) => c.tasks.add(task),
    saveTask: (task) => c.tasks.save(task),
    removeTask: (accessToken) => c.tasks.remove(accessToken),
    newTaskComment: (input) => c.tasks.newComment(input),
    updateTaskProgress: (accessToken, progress) => c.tasks.updateProgress(accessToken, progress),
    setTaskCompleted: (input) => c.tasks.setCompleted(input),
    allTasks: () => c.tasks.getAll(),
    upcomingFeed: (outbox = false) => c.tasks.upcoming(outbox),
    tasksBadge: () => c.tasks.badge(),
    inboxBadge: () => c.letters.badge(),
    // --- chat ---
    sendMessage: (message) => c.chat.send(message),
    removeSentMessage: (dialog, mid) => c.chat.removeSentMessage(dialog, mid),
    dialogs: () => c.chat.getDialogs(),
    fullChat: (dialog) => c.chat.getFullChat(dialog),
    history: (dialog, offset = 0) => c.chat.getHistory(dialog, offset),
    chatView: (dialog) => c.chat.getChatView(dialog),
    searchMessages: (input = {}) => c.chat.search(input),
    createDialog: (user) => c.chat.createDialog(user),
    chatSeen: (dialog, seen_count) => c.chat.seen(dialog, seen_count),
    fullHistory: (dialog, opts = {}) => c.chat.fullHistory(dialog, opts),
    // --- dashboard ---
    dashboardSummary: () => c.dashboard.getAllSummary(),
    workspacesUsers: () => c.dashboard.getAllWorkspacesUsers(),
    // --- letters ---
    letters: (mode = "inbox", offset = 0, extra = {}) => c.letters.getInbox(mode, offset, extra),
    letterThread: (thread) => c.letters.getHistory(thread),
    letterLabels: (thread) => c.letters.getMessageLabels(thread),
    sendLetter: (body) => c.letters.send(body),
    letterSeen: (thread) => c.letters.seen(thread),
    letterArchive: (thread, opts = {}) => c.letters.archive(thread, opts),
    letterUnarchive: (thread, opts = {}) => c.letters.unarchive(thread, opts),
    letterToggleBookmark: (thread) => c.letters.toggleBookmark(thread)
  };
}

// src/feeds/index.ts
function isAuthLikeError(err) {
  if (!(err instanceof MizitoApiError)) return false;
  return err.code === "auth" || err.code === "api";
}
async function buildContext(tokensOrToken) {
  const tokens = typeof tokensOrToken === "string" ? staticToken(tokensOrToken) : tokensOrToken ?? diskSession();
  const root = createClient({ tokens });
  let boot;
  try {
    boot = await root.workspaces.bootstrap();
  } catch (err) {
    if (err instanceof MizitoApiError && err.code === "api" && tokens.onAuthExpired) {
      const fresh = await tokens.onAuthExpired();
      if (fresh) {
        boot = await root.workspaces.bootstrap();
        return { tokens, token: await root.currentToken(), root, boot };
      }
    }
    if (isAuthLikeError(err) && !hasCredentials()) {
      throw new Error(
        "Mizito session is invalid or expired. Run `mizito login`, or set MIZITO_USERNAME/MIZITO_PASSWORD (or auth/credentials.json) for automatic re-login."
      );
    }
    throw err;
  }
  return { tokens, token: await root.currentToken(), root, boot };
}
async function clientForWorkspace(root, baseToken, ws) {
  if (ws.active) return createClient({ token: baseToken });
  const token = await root.workspaces.switchToken(ws._id);
  if (!token) throw new Error(`Could not switch into workspace "${ws.title}".`);
  return createClient({ token });
}
async function resolveWorkspace(ctx, { workspace } = {}) {
  const all = ctx.boot.workspaces ?? [];
  let ws;
  if (!workspace) {
    ws = all.find((w) => w.active) ?? all[0];
  } else {
    const needle = String(workspace).trim().toLowerCase();
    ws = all.find((w) => w._id === workspace || (w.title ?? "").trim().toLowerCase() === needle);
    if (!ws) {
      const names = all.map((w) => `"${w.title}"`).join(", ");
      throw new Error(`No workspace matches "${workspace}". Available: ${names}.`);
    }
  }
  if (!ws) throw new Error("No workspaces available on this account.");
  const mz = await clientForWorkspace(ctx.root, ctx.token, ws);
  return { mz, ws: { id: ws._id, title: ws.title, active: !!ws.active } };
}
function selectWorkspaces(boot, { workspace } = {}) {
  const all = boot.workspaces ?? [];
  if (!workspace) return all;
  const needle = String(workspace).trim().toLowerCase();
  const hit = all.filter(
    (w) => w._id === workspace || (w.title ?? "").trim().toLowerCase() === needle
  );
  return hit.length ? hit : all;
}
async function forEachWorkspace(ctx, opts, fn) {
  const targets = selectWorkspaces(ctx.boot, opts);
  const out = [];
  for (const ws of targets) {
    const workspace = { id: ws._id, title: ws.title, active: !!ws.active };
    try {
      const mz = await clientForWorkspace(ctx.root, ctx.token, ws);
      out.push({ workspace, ok: true, value: await fn(mz, ws) });
    } catch (err) {
      out.push({ workspace, ok: false, error: String(err.message || err) });
    }
  }
  return out;
}
function identity(ctx) {
  const b = ctx.boot;
  return {
    uid: b.uid,
    phone: b.phone,
    client_version: b.client_version,
    workspaces: (b.workspaces ?? []).map((w) => ({
      id: w._id,
      title: w.title,
      active: !!w.active
    }))
  };
}
async function overview(ctx) {
  const summary = await ctx.root.dashboard.getAllSummary();
  const rows = Array.isArray(summary) ? summary : summary?.summary ?? [];
  return rows.map((s) => ({
    workspace: s.workspace_title,
    workspaceId: s.workspace_id,
    inbox: s.inbox ?? 0,
    unread_chats: s.chat ?? 0,
    tasks: {
      today: s.task?.today ?? 0,
      overdue: s.task?.overdue ?? 0,
      with_time: s.task?.with_time ?? 0,
      no_time: s.task?.no_time ?? 0
    },
    meetings: Array.isArray(s.meetings) ? s.meetings.length : 0
  }));
}
function normalizeTask(t, projectTitles, ws, role) {
  return {
    id: t._id,
    title: t.title,
    role,
    // 'assignee' or 'responsible' — why this is "my" task
    notes: t.notes ? String(t.notes).slice(0, 500) : "",
    workspace: ws.title,
    project: (t.project && projectTitles.get(t.project)) ?? null,
    progress: t.progress ?? 0,
    completed: !!t.completed,
    has_deadline: !!t.has_deadline,
    deadline: t.alarm_at ?? null,
    has_attachments: !!t.has_attachments,
    labels: Array.isArray(t.labels) ? t.labels.length : 0,
    modified_at: t.modified_at ?? null,
    dialog: t.dialog ?? null
  };
}
function references(field, uid) {
  if (field === uid) return true;
  const arr = Array.isArray(field) ? field : [field];
  return arr.some(
    (x) => x != null && (x === uid || typeof x === "object" && (x._id === uid || x.user === uid || x.uid === uid))
  );
}
async function myTasks(ctx, { workspace, includeCompleted = false } = {}) {
  const uid = ctx.boot.uid;
  const per = await forEachWorkspace(ctx, { workspace }, async (mz, ws) => {
    const [tasks2, projects] = await Promise.all([
      mz.tasks.getAll().catch(() => []),
      mz.projects.getList().catch(() => null)
    ]);
    const titles = /* @__PURE__ */ new Map();
    for (const p of projects?.projects ?? []) titles.set(p._id, p.title);
    const list = [];
    for (const t of Array.isArray(tasks2) ? tasks2 : []) {
      if (t.deleted) continue;
      if (!includeCompleted && t.completed) continue;
      const role = references(t.assignee, uid) ? "assignee" : references(t.responsible, uid) ? "responsible" : null;
      if (!role) continue;
      list.push(normalizeTask(t, titles, ws, role));
    }
    return list;
  });
  const tasks = per.flatMap((r) => r.ok && r.value ? r.value : []);
  tasks.sort((a, b) => {
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return String(b.modified_at).localeCompare(String(a.modified_at));
  });
  const errors = per.filter((r) => !r.ok).map((r) => ({ workspace: r.workspace.title, error: r.error }));
  return { count: tasks.length, tasks, errors };
}
async function unreadMessages(ctx, { workspace } = {}) {
  const per = await forEachWorkspace(ctx, { workspace }, async (mz, ws) => {
    const res = await mz.chat.getDialogs();
    const dialogs = res?.dialogs ?? [];
    return dialogs.filter((d) => (d.unread_count ?? 0) > 0 || (d.history_unread_count ?? 0) > 0).map((d) => ({
      dialog: d._id,
      title: d.title || (d.is_group ? "(group)" : "(direct message)"),
      workspace: ws.title,
      is_group: !!d.is_group,
      is_project: !!d.is_project_group,
      unread_count: d.unread_count ?? 0,
      history_unread_count: d.history_unread_count ?? 0,
      last_message_date: d.last_message_date ?? null
    }));
  });
  const conversations = per.flatMap((r) => r.ok && r.value ? r.value : []);
  conversations.sort(
    (a, b) => String(b.last_message_date).localeCompare(String(a.last_message_date))
  );
  const total_unread = conversations.reduce(
    (n, c) => n + (c.unread_count || c.history_unread_count || 0),
    0
  );
  const errors = per.filter((r) => !r.ok).map((r) => ({ workspace: r.workspace.title, error: r.error }));
  return { conversations: conversations.length, total_unread, items: conversations, errors };
}

// src/feeds/write.ts
import fs2 from "fs";
import path3 from "path";
var norm = (s) => String(s ?? "").trim().toLowerCase();
var boardId = (b) => typeof b === "string" ? b : b?._id ?? null;
var boardTitle = (b) => typeof b === "string" ? "" : b?.title ?? "";
var fullName = (u) => `${u?.first_name ?? ""} ${u?.last_name ?? ""}`.trim();
function attachmentOf(a) {
  const node = a;
  const d = node?.media?.document || node?.document || (node?._id && node?.content ? node : null);
  if (!d?._id) return null;
  return {
    id: d._id,
    name: d.name || d._id,
    size: d.size ?? null,
    content_token: d.content || null,
    content_key: d.content_key || null
  };
}
function safeName(name, fallback) {
  const s = String(name || fallback || "file").replace(/[\\/:*?"<>| -]+/g, "_").trim();
  return s || String(fallback || "file");
}
async function loadProjects(mz) {
  const r = await mz.projects.getList().catch(() => null);
  return r?.projects ?? [];
}
async function loadMembers(mz) {
  const r = await mz.workspaces.getUsers().catch(() => null);
  return r?.users ?? [];
}
function findByName(items, ref, nameOf3) {
  if (!ref) return null;
  const n = norm(ref);
  return items.find((it) => it._id === ref) || items.find((it) => norm(nameOf3(it)) === n) || items.find((it) => norm(nameOf3(it)).includes(n)) || null;
}
function findProject(projects, ref) {
  return findByName(
    projects.filter((p) => !p.deleted),
    ref,
    (p) => p.title
  );
}
function findBoard(project, ref) {
  const boards = project?.kanban_boards ?? [];
  if (!ref) return boards[0] ?? null;
  const n = norm(ref);
  return boards.find((b) => boardId(b) === ref) || boards.find((b) => norm(boardTitle(b)) === n) || boards.find((b) => norm(boardTitle(b)).includes(n)) || null;
}
function pickTask(list, { taskId, title }) {
  if (taskId) {
    const t = list.find((x) => x._id === taskId);
    return t ? { task: t } : { none: true };
  }
  const n = norm(title);
  const exact = list.filter((x) => norm(x.title) === n);
  const part = list.filter((x) => norm(x.title).includes(n));
  const hits = exact.length ? exact : part;
  if (hits.length === 1) return { task: hits[0] };
  if (hits.length === 0) return { none: true };
  return { ambiguous: hits };
}
function ambiguityError(title, hits) {
  return new Error(
    `"${title}" matches ${hits.length} tasks (${hits.slice(0, 5).map((t) => `"${t.title}"`).join(", ")}\u2026). Pass task_id to disambiguate.`
  );
}
async function scanProjectsForTask(mz, { taskId, title }, { maxPagesPerDialog = 40 } = {}) {
  const projects = await loadProjects(mz);
  const dialogs = projects.filter((p) => !p.deleted && p.dialog).map((p) => p.dialog);
  const byId = /* @__PURE__ */ new Map();
  for (const dialog of dialogs) {
    let offset = 0;
    for (let page = 0; page < maxPagesPerDialog; page++) {
      const msgs = await mz.chat.getHistory(dialog, offset).catch(() => []);
      if (!Array.isArray(msgs) || msgs.length === 0) break;
      for (const m of msgs) {
        const t = taskFromMessage(m);
        if (t && !byId.has(t._id)) byId.set(t._id, t);
      }
      if (taskId && byId.has(taskId)) return byId.get(taskId) ?? null;
      offset += msgs.length;
      if (msgs.length < CHAT_PAGE_SIZE) break;
    }
  }
  const list = [...byId.values()].filter((t) => !t.deleted);
  const r = pickTask(list, { taskId, title });
  if (r.task) return r.task;
  if (r.ambiguous) throw ambiguityError(title, r.ambiguous);
  return null;
}
async function findTask(mz, { taskId, title }) {
  if (!taskId && !title) throw new Error("Provide task_id or task_title to identify the task.");
  const all = await mz.tasks.getAll().catch(() => []);
  const open = (Array.isArray(all) ? all : []).filter((t) => !t.deleted);
  const fast = pickTask(open, { taskId, title });
  if (fast.task) return fast.task;
  if (fast.ambiguous) throw ambiguityError(title, fast.ambiguous);
  const found = await scanProjectsForTask(mz, { taskId, title });
  if (found) return found;
  throw new Error(
    taskId ? `No task with id "${taskId}" in this workspace.` : `No task matches title "${title}" in this workspace.`
  );
}
function projectTitleOf(projects, id) {
  return projects.find((p) => p._id === id)?.title ?? null;
}
async function listProjects(ctx, { workspace } = {}) {
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const projects = await loadProjects(mz);
  return {
    workspace: ws.title,
    count: projects.filter((p) => !p.deleted).length,
    projects: projects.filter((p) => !p.deleted).map((p) => ({
      id: p._id,
      title: p.title,
      is_advanced: !!p.is_advanced,
      archived: !!p.archived,
      dialog: p.dialog ?? null,
      boards: (p.kanban_boards ?? []).map((b) => ({ id: boardId(b), title: boardTitle(b) }))
    }))
  };
}
async function createTask(ctx, {
  workspace,
  project,
  board,
  title,
  notes = "",
  assignees,
  deadline = null,
  deadlineStart = null,
  progress = 0,
  labels = [],
  postToChat = true
}) {
  if (!title || !String(title).trim()) throw new Error("title is required.");
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const projects = await loadProjects(mz);
  const proj = project ? findProject(projects, project) : null;
  if (project && !proj) {
    const names = projects.filter((p) => !p.deleted).map((p) => `"${p.title}"`).join(", ");
    throw new Error(`No project matches "${project}" in "${ws.title}". Available: ${names}.`);
  }
  const boardObj = proj ? findBoard(proj, board) : null;
  if (proj && board && !boardObj) {
    const names = (proj.kanban_boards ?? []).map((b) => `"${boardTitle(b)}"`).join(", ");
    throw new Error(`No board matches "${board}" in project "${proj.title}". Boards: ${names}.`);
  }
  let assigneeIds;
  const list = assignees == null ? [] : Array.isArray(assignees) ? assignees : [assignees];
  if (!list.length) {
    assigneeIds = [ctx.boot.uid];
  } else {
    const members = await loadMembers(mz);
    assigneeIds = list.map((ref) => {
      const u = findByName(members, ref, fullName) || findByName(members, ref, (m) => m.first_name);
      if (!u) throw new Error(`No member matches "${ref}" in "${ws.title}".`);
      return u._id;
    });
  }
  const payload = {
    title: String(title).trim(),
    notes: notes ?? "",
    assignee: assigneeIds,
    project: proj?._id ?? null,
    kanban_board: proj ? boardId(boardObj) : null,
    labels: labels ?? [],
    attachments: [],
    deleted: false,
    alarm_options: null,
    progress: progress ?? 0,
    deadline_start: deadlineStart ?? null,
    deadline: deadline ?? null,
    checklist: [],
    responsible: null,
    insert_to_chat_group: proj ? !!postToChat : false
  };
  const res = await mz.tasks.add(payload);
  const task = Array.isArray(res) ? res[0] : res;
  if (!task || task.error) throw new Error(`Create failed: ${task?.error || JSON.stringify(res)}`);
  return {
    workspace: ws.title,
    created: true,
    task: {
      id: task._id,
      title: task.title,
      project: proj?.title ?? projectTitleOf(projects, task.project),
      board: boardObj ? boardTitle(boardObj) : null,
      assignees: assigneeIds.length,
      progress: task.progress ?? 0,
      deadline: task.deadline ?? task.alarm_at ?? null,
      dialog: task.dialog ?? null
    }
  };
}
async function editTask(ctx, { workspace, taskId, taskTitle, title, notes, deadline, deadlineStart, progress, board, assignees } = {}) {
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const task = await findTask(mz, { taskId, title: taskTitle });
  let boardId_ = task.kanban_board ?? null;
  if (board !== void 0 && task.project) {
    const projects = await loadProjects(mz);
    const proj = projects.find((p) => p._id === task.project) ?? null;
    const b = proj ? findBoard(proj, board) : null;
    if (board && !b) throw new Error(`No board matches "${board}" in this task's project.`);
    boardId_ = b ? boardId(b) : null;
  }
  let assigneeIds = Array.isArray(task.assignee) ? task.assignee : task.assignee ? [task.assignee] : [];
  if (assignees !== void 0) {
    const members = await loadMembers(mz);
    const list = assignees == null ? [] : Array.isArray(assignees) ? assignees : [assignees];
    assigneeIds = list.map((ref) => {
      const u = findByName(members, ref, fullName) || findByName(members, ref, (m) => m.first_name);
      if (!u) throw new Error(`No member matches "${ref}" in "${ws.title}".`);
      return u._id;
    });
  }
  const payload = {
    task_id: task._id,
    token: task.access_token,
    title: title != null ? String(title) : task.title,
    notes: notes != null ? String(notes) : task.notes ?? "",
    assignee: assigneeIds,
    project: task.project ?? null,
    kanban_board: boardId_,
    labels: task.labels ?? [],
    attachments: task.attachments ?? [],
    deleted: false,
    alarm_options: task.alarm_options ?? null,
    progress: progress != null ? Number(progress) : task.progress ?? 0,
    deadline_start: deadlineStart !== void 0 ? deadlineStart : task.deadline_start ?? null,
    deadline: deadline !== void 0 ? deadline : task.deadline ?? task.alarm_at ?? null,
    checklist: task.checklist ?? [],
    responsible: task.responsible ?? null
  };
  const res = await mz.tasks.save(payload);
  const saved = Array.isArray(res) ? res[0] : res;
  if (!saved || saved.error) throw new Error(`Edit failed: ${saved?.error || JSON.stringify(res)}`);
  return {
    workspace: ws.title,
    task_id: saved._id ?? task._id,
    title: saved.title ?? payload.title,
    progress: saved.progress ?? payload.progress,
    deadline: saved.deadline ?? saved.alarm_at ?? payload.deadline ?? null,
    updated: true
  };
}
async function commentOnTask(ctx, { workspace, taskId, taskTitle, comment }) {
  if (!comment || !String(comment).trim()) throw new Error("comment is required.");
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const task = await findTask(mz, { taskId, title: taskTitle });
  await mz.tasks.newComment({ token: task.access_token, comment: String(comment) });
  return { workspace: ws.title, task_id: task._id, title: task.title, commented: true };
}
async function setTaskProgress(ctx, { workspace, taskId, taskTitle, progress }) {
  const p = Number(progress);
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error("progress must be a number 0..100.");
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const task = await findTask(mz, { taskId, title: taskTitle });
  const res = await mz.tasks.updateProgress(task.access_token, p);
  if (res?.error) throw new Error(res.error);
  return {
    workspace: ws.title,
    task_id: task._id,
    title: res?.title ?? task.title,
    progress: res?.progress ?? p,
    completed: !!res?.completed
  };
}
async function setTaskCompleted(ctx, { workspace, taskId, taskTitle, completed = true } = {}) {
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const task = await findTask(mz, { taskId, title: taskTitle });
  const res = await mz.tasks.setCompleted({
    token: task.access_token,
    completed: !!completed,
    project: task.project ?? null,
    ...completed ? {} : { progress: 0 }
  });
  if (res?.error) throw new Error(res.error);
  return {
    workspace: ws.title,
    task_id: task._id,
    title: res?.title ?? task.title,
    completed: res?.completed ?? !!completed
  };
}
async function sendMessage(ctx, { workspace, project, dialog, text }) {
  if (!text || !String(text).trim()) throw new Error("text is required.");
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  let dlg = dialog || null;
  let where = dialog || null;
  if (!dlg) {
    if (!project) throw new Error("Provide a project (name/id) or a dialog id to send to.");
    const projects = await loadProjects(mz);
    const proj = findProject(projects, project);
    if (!proj) throw new Error(`No project matches "${project}" in "${ws.title}".`);
    if (!proj.dialog) throw new Error(`Project "${proj.title}" has no chat dialog.`);
    dlg = proj.dialog;
    where = proj.title;
  }
  const message = {
    _: "message",
    dialog: dlg,
    out: true,
    message: String(text),
    media: null,
    from: ctx.boot.uid,
    date: Date.now(),
    reply_to: null,
    mention: [],
    seen_count: 1,
    randomId: Math.floor(Math.random() * 1e9),
    pending: true
  };
  await mz.chat.send(message);
  return { workspace: ws.title, dialog: dlg, sent_to: where, text: String(text), sent: true };
}
async function getTaskComments(ctx, { workspace, taskId, taskTitle } = {}) {
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const task = await findTask(mz, { taskId, title: taskTitle });
  const [comments, members] = await Promise.all([
    mz.tasks.getComments(task.access_token).catch(() => []),
    loadMembers(mz).catch(() => [])
  ]);
  const nameById = new Map(members.map((m) => [m._id, fullName(m)]));
  const list = (Array.isArray(comments) ? comments : []).filter((c) => !c.deleted).map((c) => ({
    id: c._id,
    author: c.comment_owner && nameById.get(c.comment_owner) || c.comment_owner || null,
    text: c.comment || "",
    date: c.comment_at || null,
    edited: !!c.edited,
    attachments: (c.attachments || []).map(attachmentOf).filter((x) => x != null)
  }));
  const attachmentCount = list.reduce((n, c) => n + c.attachments.length, 0);
  return {
    workspace: ws.title,
    task_id: task._id,
    title: task.title,
    count: list.length,
    attachment_count: attachmentCount,
    comments: list
  };
}
async function downloadAttachment(ctx, {
  workspace,
  contentToken,
  name,
  dir,
  maxInlineBytes = 0
}) {
  if (!contentToken || !String(contentToken).trim()) throw new Error("contentToken is required.");
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const buf = await mz.files.download(contentToken);
  const outDir = dir || path3.join(ROOT, "downloads", slug(ws.title));
  ensureDir(outDir);
  let dest = path3.join(outDir, safeName(name, "attachment"));
  if (fs2.existsSync(dest) && fs2.statSync(dest).size !== buf.length) {
    const ext = path3.extname(dest);
    dest = dest.slice(0, dest.length - ext.length) + `_${buf.length}` + ext;
  }
  fs2.writeFileSync(dest, buf);
  const result = {
    workspace: ws.title,
    name: name || path3.basename(dest),
    path: dest,
    size: buf.length,
    saved: true
  };
  if (maxInlineBytes && buf.length <= maxInlineBytes) {
    result.base64 = buf.toString("base64");
  }
  return result;
}

// src/feeds/letters.ts
var MAILBOXES = /* @__PURE__ */ new Set(["inbox", "outbox", "archive"]);
var nameOf = (map, id) => id ? map.get(id) || id : null;
function memberMap(members) {
  return new Map(members.map((m) => [m._id, fullName(m) || m.username || m._id]));
}
function snippet(html, n = 240) {
  const s = stripHtml(html).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "\u2026" : s;
}
function resolveRecipients(members, refs, wsTitle) {
  const list = refs == null ? [] : Array.isArray(refs) ? refs : [refs];
  return list.map((ref) => {
    const u = findByName(members, ref, fullName) || findByName(members, ref, (m) => m.first_name) || findByName(members, ref, (m) => m.username);
    if (!u) throw new Error(`No member matches "${ref}" in "${wsTitle}".`);
    return u._id;
  });
}
async function listLetters(ctx, { workspace, box = "inbox", limit = 30 } = {}) {
  const mode = MAILBOXES.has(String(box)) ? String(box) : "inbox";
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const [rows, members] = await Promise.all([
    mz.letters.getInbox(mode, 0).catch(() => []),
    loadMembers(mz).catch(() => [])
  ]);
  const names = memberMap(members);
  const letters = (Array.isArray(rows) ? rows : []).slice(0, limit).map((r) => ({
    thread: r.thread || r._id,
    subject: r.subject || "(no subject)",
    from: nameOf(names, r.from),
    // Sent letters carry `receivers`; received ones don't list them in the row.
    recipients: Array.isArray(r.receivers) ? r.receivers.map((id) => nameOf(names, id)) : void 0,
    unread: !!r.unread,
    date: r.send_date || null,
    attachments: r.attachments_count ?? 0,
    labels: Array.isArray(r.labels) ? r.labels.length : 0,
    // A non-empty `secretariat` means the letter is formally registered
    // (نامه‌ی ثبت‌شده در دبیرخانه) with an in/out number.
    registered: !!(r.secretariat && Object.keys(r.secretariat).length),
    snippet: snippet(r.short_content || r.raw_content || "")
  }));
  return { workspace: ws.title, box: mode, count: letters.length, letters };
}
async function readLetter(ctx, { workspace, thread }) {
  if (!thread || !String(thread).trim()) throw new Error("thread is required (from mizito_letters).");
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const [letter, members] = await Promise.all([
    mz.letters.getHistory(thread),
    loadMembers(mz).catch(() => [])
  ]);
  if (!letter || typeof letter !== "object") {
    throw new Error(`No letter thread "${thread}" in "${ws.title}".`);
  }
  const names = memberMap(members);
  const recipients = (letter.to || []).map((t) => ({
    name: nameOf(names, t.user),
    seen: !t.unread,
    seen_date: t.seen_date || null,
    archived: !!t.archived
  }));
  const attachments = (letter.attachments || []).map(attachmentOf).filter((x) => x != null);
  const followups = (letter.messages || []).map((m) => ({
    from: nameOf(names, m.from),
    date: m.send_date || m.date || null,
    text: stripHtml(m.content || m.message || ""),
    attachments: (m.attachments || []).map(attachmentOf).filter((x) => x != null)
  }));
  return {
    workspace: ws.title,
    thread: letter.thread || thread,
    subject: letter.subject || "(no subject)",
    from: nameOf(names, letter.from),
    to: recipients,
    date: letter.send_date || null,
    seen: !!letter.is_seen,
    bookmarked: !!letter.bookmarked,
    labels: Array.isArray(letter.labels) ? letter.labels.length : 0,
    body: stripHtml(letter.content || ""),
    attachments,
    followups
  };
}
async function sendLetter(ctx, {
  workspace,
  to,
  subject,
  content,
  labels = []
}) {
  if (!subject || !String(subject).trim()) throw new Error("subject is required.");
  if (!content || !String(content).trim()) throw new Error("content is required.");
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const members = await loadMembers(mz);
  const toIds = resolveRecipients(members, to, ws.title);
  if (!toIds.length) throw new Error("At least one recipient (to) is required.");
  const body = {
    to: toIds,
    subject: String(subject),
    content: String(content),
    attachments: [],
    tasks_insert_to_chat_groups: [],
    labels: labels ?? []
  };
  const res = await mz.letters.send(body);
  return {
    workspace: ws.title,
    sent: true,
    recipients: toIds.length,
    subject: body.subject,
    thread: res?.thread || res?._id || null
  };
}
async function replyLetter(ctx, { workspace, thread, content }) {
  if (!thread || !String(thread).trim()) throw new Error("thread is required.");
  if (!content || !String(content).trim()) throw new Error("content is required.");
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const letter = await mz.letters.getHistory(thread);
  if (!letter || typeof letter !== "object") {
    throw new Error(`No letter thread "${thread}" in "${ws.title}".`);
  }
  const me = ctx.boot.uid;
  const participants = /* @__PURE__ */ new Set();
  if (letter.from) participants.add(letter.from);
  for (const t of letter.to || []) if (t.user) participants.add(t.user);
  participants.delete(me);
  const toIds = [...participants];
  const body = {
    thread,
    to: toIds,
    subject: letter.subject || "",
    content: String(content),
    attachments: [],
    tasks_insert_to_chat_groups: [],
    labels: []
  };
  await mz.letters.send(body);
  return { workspace: ws.title, thread, recipients: toIds.length, replied: true };
}
async function markLetterRead(ctx, { workspace, thread }) {
  if (!thread || !String(thread).trim()) throw new Error("thread is required.");
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  await mz.letters.seen(thread);
  return { workspace: ws.title, thread, marked_read: true };
}
async function archiveLetter(ctx, {
  workspace,
  thread,
  box = "inbox",
  unarchive = false
}) {
  if (!thread || !String(thread).trim()) throw new Error("thread is required.");
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const outbox = String(box) === "outbox";
  if (unarchive) await mz.letters.unarchive(thread, { outbox });
  else await mz.letters.archive(thread, { outbox });
  return { workspace: ws.title, thread, archived: !unarchive };
}

// src/feeds/conversations.ts
var nameOf2 = (map, id) => id ? map.get(id) || id : null;
function memberMap2(members) {
  return new Map(members.map((m) => [m._id, fullName(m) || m.username || m._id]));
}
function dialogTitle(d, names) {
  if (d.title) return d.title;
  if (d.is_group || d.is_project_group) return "(group)";
  return nameOf2(names, d.peer_user) || "(direct message)";
}
function dialogKind(d) {
  if (d.is_project_group) return "project";
  if (d.is_group) return "group";
  return "direct";
}
function photoOf(photo) {
  if (!photo) return null;
  const r = photo.photo_large || photo.photo_medium || photo.photo_small || {};
  return {
    name: photo.name || photo._id || "photo",
    size: r.size ?? null,
    content_token: r.content || null,
    content_key: r.content_key || photo.content_key || null
  };
}
function normalizeMessage(m, names, uid) {
  const kind = m?.media?._ || m?._ || (typeof m?.message === "string" ? "message" : "unknown");
  const base = {
    mid: m._id || m.mid || null,
    from: nameOf2(names, m.from),
    mine: m.from === uid,
    date: m.date || null,
    reply_to: m.reply_to || null
  };
  switch (kind) {
    case "message":
      return { ...base, type: "text", text: m.message || "" };
    case "messageMediaTask":
    case "messageMediaMentionInTask": {
      const t = taskFromMessage(m) || m.media?.task || {};
      return {
        ...base,
        type: kind === "messageMediaMentionInTask" ? "task_mention" : "task",
        task: {
          id: t._id,
          title: t.title,
          progress: t.progress ?? 0,
          completed: !!t.completed
        }
      };
    }
    case "messageMediaPhoto":
      return { ...base, type: "photo", photo: photoOf(m.media?.photo) };
    case "messageMediaDocument":
      return { ...base, type: "document", attachment: attachmentOf(m.media) };
    case "messageService":
      return { ...base, type: "service", text: m.message || m.action || "(event)" };
    default:
      return { ...base, type: kind, text: m.message || "" };
  }
}
async function listConversations(ctx, { workspace, unreadOnly = false, limit = 50 } = {}) {
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const [res, members] = await Promise.all([
    mz.chat.getDialogs(),
    loadMembers(mz).catch(() => [])
  ]);
  const names = memberMap2(members);
  let dialogs = res?.dialogs ?? [];
  if (unreadOnly) {
    dialogs = dialogs.filter((d) => (d.unread_count ?? 0) > 0 || (d.history_unread_count ?? 0) > 0);
  }
  dialogs.sort((a, b) => String(b.last_message_date).localeCompare(String(a.last_message_date)));
  const conversations = dialogs.slice(0, limit).map((d) => ({
    dialog: d._id,
    title: dialogTitle(d, names),
    kind: dialogKind(d),
    unread: d.unread_count ?? d.history_unread_count ?? 0,
    messages: d.messages_count ?? 0,
    last_message_date: d.last_message_date ?? null
  }));
  return { workspace: ws.title, count: conversations.length, conversations };
}
async function resolveDialog(ctx, mz, ws, { dialog, project, user }) {
  if (dialog) return { dialog, where: dialog };
  if (project) {
    const projects = (await loadProjects(mz)).filter((p) => !p.deleted);
    const proj = findByName(projects, project, (p) => p.title);
    if (!proj) throw new Error(`No project matches "${project}" in "${ws.title}".`);
    if (!proj.dialog) throw new Error(`Project "${proj.title}" has no chat dialog.`);
    return { dialog: proj.dialog, where: proj.title };
  }
  if (user) {
    const [members, res] = await Promise.all([loadMembers(mz), mz.chat.getDialogs()]);
    const u = findByName(members, user, fullName) || findByName(members, user, (m) => m.first_name) || findByName(members, user, (m) => m.username);
    if (!u) throw new Error(`No member matches "${user}" in "${ws.title}".`);
    const dm = (res?.dialogs ?? []).find(
      (d) => !d.is_group && !d.is_project_group && d.peer_user === u._id
    );
    if (!dm) {
      throw new Error(
        `No existing direct message with "${fullName(u) || user}". Send them a message first (mizito_send_message with user).`
      );
    }
    return { dialog: dm._id, where: fullName(u) || user };
  }
  throw new Error("Provide a dialog id, a project name/id, or a user name/id to read.");
}
async function readConversation(ctx, {
  workspace,
  dialog,
  project,
  user,
  limit = 30
} = {}) {
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const { dialog: dlg, where } = await resolveDialog(ctx, mz, ws, { dialog, project, user });
  const cap = Math.max(1, Math.min(Number(limit) || 30, 200));
  const collected = [];
  let offset = 0;
  for (; ; ) {
    const page = await mz.chat.getHistory(dlg, offset).catch(() => []);
    if (!Array.isArray(page) || page.length === 0) break;
    collected.push(...page);
    offset += page.length;
    if (collected.length >= cap || page.length < CHAT_PAGE_SIZE) break;
  }
  const members = await loadMembers(mz).catch(() => []);
  const names = memberMap2(members);
  const uid = ctx.boot.uid;
  const messages = collected.slice(0, cap).map((m) => normalizeMessage(m, names, uid)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { workspace: ws.title, dialog: dlg, conversation: where, count: messages.length, messages };
}
async function messageUser(ctx, { workspace, user, text }) {
  if (!user || !String(user).trim()) throw new Error("user is required.");
  if (!text || !String(text).trim()) throw new Error("text is required.");
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const members = await loadMembers(mz);
  const u = findByName(members, user, fullName) || findByName(members, user, (m) => m.first_name) || findByName(members, user, (m) => m.username);
  if (!u) throw new Error(`No member matches "${user}" in "${ws.title}".`);
  const created = await mz.chat.createDialog(u._id);
  const dlg = created?._id || created?.dialog || created?.data?._id;
  if (!dlg) throw new Error("Could not open a direct message with that member.");
  const message = {
    _: "message",
    dialog: dlg,
    out: true,
    message: String(text),
    media: null,
    from: ctx.boot.uid,
    date: Date.now(),
    reply_to: null,
    mention: [],
    seen_count: 1,
    randomId: Math.floor(Math.random() * 1e9),
    pending: true
  };
  await mz.chat.send(message);
  return { workspace: ws.title, dialog: dlg, sent_to: fullName(u) || user, text: String(text), sent: true };
}

// src/files.ts
import fs3 from "fs";
import path4 from "path";
function docOf(node) {
  const d = node?.media?.document;
  if (!d?._id) return null;
  return {
    id: d._id,
    name: d.name || d._id,
    size: d.size ?? null,
    content_token: d.content || null,
    content_key: d.content_key || null
  };
}
function extractFiles(base) {
  const out = /* @__PURE__ */ new Map();
  const add = (doc, extra) => {
    if (!doc || out.has(doc.id)) return;
    out.set(doc.id, { ...doc, ...extra });
  };
  const tasks = readJson(path4.join(base, "tasks.json"), []);
  for (const t of tasks) {
    for (const a of t.attachments || [])
      add(docOf(a), { source_type: "task", source_id: t._id, task_id: t._id, dialog_id: t._dialog ?? null });
    for (const a of t.last_comment?.attachments || [])
      add(docOf(a), { source_type: "comment", source_id: t._id, task_id: t._id, dialog_id: t._dialog ?? null });
  }
  const commentDoc = readJson(
    path4.join(base, "comments.json"),
    []
  );
  for (const entry of commentDoc) {
    for (const cm of entry.comments || []) {
      for (const a of cm.attachments || [])
        add(docOf(a), { source_type: "comment", source_id: cm._id ?? null, task_id: entry.task_id ?? null, dialog_id: null });
    }
  }
  const chatsDir = path4.join(base, "chats");
  if (exists(chatsDir)) {
    for (const f of fs3.readdirSync(chatsDir)) {
      const chat = readJson(path4.join(chatsDir, f), { messages: [] });
      const dialogId = path4.basename(f, ".json");
      for (const m of chat.messages || []) {
        add(docOf(m), {
          source_type: "message",
          source_id: m._id ?? null,
          task_id: m.media?.task?._id ?? null,
          dialog_id: dialogId
        });
      }
    }
  }
  return [...out.values()];
}
export {
  API_BASE,
  API_PREFIX,
  AUTH_DIR,
  CDN_BASE,
  CHAT_PAGE_SIZE,
  CREDENTIALS_PATH,
  DATA_DIR,
  LOGIN_PREFIX,
  MizitoApiError,
  ROOT,
  SESSION_CREATE_URL,
  SESSION_PATH,
  STORAGE_STATE_PATH,
  TARGET_WORKSPACE,
  TOKEN_HEADER,
  WEB_BASE,
  WEB_LOGIN_URL,
  archiveLetter,
  buildContext,
  codeForHttpStatus,
  commentOnTask,
  createClient,
  createHttp,
  createMizito,
  createSession,
  createTask,
  diskSession,
  docOf,
  downloadAttachment,
  editTask,
  ensureDir,
  exists,
  extractFiles,
  getTaskComments,
  hasCredentials,
  hashPassword,
  identity,
  listConversations,
  listLetters,
  listProjects,
  loadCredentials,
  loadToken,
  log,
  markLetterRead,
  messageUser,
  myTasks,
  overview,
  passwordSession,
  readConversation,
  readJson,
  readLetter,
  reauthenticate,
  replyLetter,
  requireToken,
  resolveWorkspace,
  saveSession,
  sendLetter,
  sendMessage,
  setTaskCompleted,
  setTaskProgress,
  sleep,
  slug,
  staticToken,
  stripHtml,
  taskFromMessage,
  tokenFromStorageState,
  unreadMessages,
  writeJson
};
//# sourceMappingURL=index.js.map