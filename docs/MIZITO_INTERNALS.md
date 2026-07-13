# How Mizito works, and how we extract its data

This is the engineering writeup of how the Mizito platform is built and the method
we use to pull a workspace's data out of it. It documents *mechanisms and approach*,
not results. For the terse endpoint/payload reference, see [`API_NOTES.md`](./API_NOTES.md).

Everything here was learned by observing the official web app — there is no public API
or documentation. It reflects the app version we inspected (`a_.js` `1.0.4-589`); Mizito
can change without notice, so treat specifics as version-pinned and re-verify if the app
updates.

---

## 1. System shape

Mizito is a single-page web app talking to a JSON backend over two hosts:

| Host | Role |
| --- | --- |
| `office.mizito.ir` | The web app (a hash-routed SPA). Serves HTML + one big JS bundle (`a_.js`). |
| `app.mizito.ir` | The backend the SPA calls. All data lives behind here. |

The SPA's runtime config exposes the backend as `Config.App.api_url` = `https://app.mizito.ir`.
Two URL prefixes are used:

- **`/capi/...`** — the authentication/session endpoints (e.g. `session/create`).
- **`/api/...`** — everything else (the actual data).

All data calls are `POST`, send and receive JSON, and follow a standard envelope:

```json
{ "status": 1, "data": <payload>, "msg": "" }
```

`status === 1` means success; our client unwraps `.data` and treats anything else as an
error.

---

## 2. Authentication

### Login

Login is `POST /capi/session/create` with `{ username, password, loginCode, regId }`.
The password is **not** sent in clear: the SPA sends `md5(password) + "|" + sha256(password)`
(unless the tenant uses dedicated AD/SSO, where the raw password is sent). On success the
backend returns a **session token** (status `1` or `5`, token at the top level of the body),
which the SPA stores in `localStorage.token` / `sessionStorage.token`. A wrong
username/password returns `{ status: 0 }`; a login needing a one-time code returns `status 7`.

Two ways to obtain that token:

1. **Browser login** (`apps/crawler/login.mjs`) — drive a real Chromium; the person logs in
   themselves and we capture the resulting `localStorage` token plus cookies. Credentials never
   touch our code, and any future SMS/2FA/SSO step is handled by the user transparently. This is
   the right choice for first-time setup, OTP-gated accounts, and AD/SSO tenants.
2. **Headless login** (`core/login.js`, `apps/crawler/relogin.mjs`) — replay the call directly.
   The client-side hashing was recovered from the bundle and **verified byte-for-byte** equal to
   Node's `crypto` hex digests (the MD5 is the open-source `gdi2290.md5-service`; the SHA-256 is
   the bundle's `sha256` factory), so the password field is just
   `md5_hex(pw) + "|" + sha256_hex(pw)` with no browser and no extra dependency. This lets a
   password-only account mint a fresh token **on demand**, which is what makes automatic
   re-login possible (see §8). It needs the user's credentials (env `MIZITO_USERNAME` /
   `MIZITO_PASSWORD`, or the gitignored `auth/credentials.json`) — a security trade-off the
   browser flow avoids.

### Authenticated requests

Every subsequent call carries the session token in a request header:

```
x-token: <token>
```

That's the entire auth model for data calls — no cookies required, no per-request signing.
Once we have the token, any HTTP client can call the backend; we don't need a browser after
login.

---

## 3. Why discovery was necessary

The endpoint **names** are mostly built at runtime by the SPA (string concatenation inside a
generic `invokeApi("group.action", …)` helper), so they don't appear as complete URLs in the
bundle. Static scanning of `a_.js` only reveals fragments. The reliable way to learn the real
endpoints, payloads, and response shapes is to **observe live traffic**:

1. Load the app with a saved session in an automated browser.
2. Record every request to `app.mizito.ir/.../api/...`, capturing method, request body, and a
   sample of the response.
3. Drive the relevant UI (open a project, a task, a chat) so the corresponding calls fire, then
   read the captured catalogue.

We also probe candidate endpoints directly with the token (fast, no browser) once we know the
shape. Both techniques are baked into the toolkit as reusable scripts (`discover`, `capture`,
`probe`, `extract`).

---

## 4. Workspaces are session state

A user can belong to several workspaces. The backend tracks **one active workspace per session**,
and most data calls implicitly act on whichever workspace is active — there is no
`workspace_id` parameter on the data endpoints.

- `workspace/userId` is the bootstrap call: it returns the user/workspace ids and the list of
  the account's workspaces (`{_id, title, active}`).
- To read a *specific* workspace, call **`workspace/switch { workspace_id }`**. Crucially this
  returns a **new token scoped to that workspace**; the original session token is unaffected.
  So switching is **non-disruptive** — it does not change the user's active workspace in their
  own browser, it just mints a key we use for our reads.

This is what makes the extraction parameterisable by workspace *name*: bootstrap → find the
workspace by title → switch → use the scoped token for everything that follows.

---

## 5. The data model

### Bootstrap and reference data

After selecting a workspace we pull the reference entities:

- **Members** — `workspace/getUsers` (people, roles, status). Note a user keeps the same id
  across workspaces, so "membership" is really (user, workspace).
- **Projects** — `projects/getList`. Each project carries its `kanban_boards` (columns), an
  `is_advanced` flag, and — importantly — a `dialog` id.
- **Labels** — `labels/getAll { type: "task" }`.
- Plus workspace name, plan info, and dashboard summaries.

### The key insight: a project is a chat, and a task is a message

This is the non-obvious heart of Mizito. An **advanced project is a chat group**
(`is_project_group: true`, `project_entity: <projectId>`), addressed by the project's `dialog`
id. Its tasks are **messages** in that group: a message whose `media._ === "messageMediaTask"`
carries the full task object under `media.task` (title, notes, owner, assignees, board,
labels, dates, checklist, …).

Consequences for extraction:

- To get a project's tasks you **page through its chat history**, not a "tasks" endpoint.
- A task is re-posted to the group on every edit, so the same task id appears in many messages.
  We de-duplicate by task id, keeping the newest version.

### Dialogs and message history

A "dialog" is any conversation — a project group, a team group, or a direct message. To read
one:

- `chat/getFullChat { dialog }` — the conversation's metadata (title, members, type).
- `chat/getHistory { dialog, offset }` — a **page of messages** (page size 15). Walk `offset`
  forward by the page length until a short/empty page signals the end.

The set of dialogs to crawl = every project's `dialog` (from `projects/getList`) plus everything
returned by `chat/getDialogs` (DMs and non-project groups).

Messages come in a few flavours: task messages (`messageMediaTask`), plain text, document
attachments (`messageMediaDocument`), and **service events** (`messageService` — group
created, member added, title/photo changed).

### Comments

A task's `last_comment` is embedded, but the **full thread** is a separate call:
`tasks/getComments { token: <task.access_token> }`. Note it is keyed by the task's
`access_token` (a per-task JWT carried in the task object), **not** the task id — which is why
naive `{task: id}` probes fail. It returns the comment array (author, text, time, attachments,
reply-to).

### Writing back

Reads are only half the story — the same token can drive the mutating endpoints the SPA
uses. They're recovered from the bundle the same way as the reads, but note the calls are
written `invokeApi("group.action", …)` with a **dot** (e.g. `tasks.newComment`); the dot
maps to a slash in the URL (`POST /api/tasks/newComment`). Because a task is a message in a
project group, **creating a task** (`tasks/add`) with `insert_to_chat_group:true` posts a
`messageMediaTask` message into that group — the write mirror of how we read tasks out. The
implemented writes:

- **Create / edit task** — `tasks/add` / `tasks/save` (returns the task, incl. its
  `access_token`).
- **Comment on a task** — `tasks/newComment`, keyed by the task `access_token` (same key as
  reading comments).
- **Progress / completion** — `tasks/updateProgress`, `tasks/setCompleted` (the latter
  needs the task's `project`).
- **Chat message** — `chat/send` (the full outgoing message object; returns `true` with no
  id, so a just-sent message is re-found via `getHistory` if you need its `mid`).

One sharp edge: `tasks/removeTask` refuses a *completed* task (HTML "Bad Request") — reopen
it first. Exact payloads and the full recovered surface are in
[`API_NOTES.md`](./API_NOTES.md); the code lives in `core/write.js` (name-resolving layer)
over `core/mizito.js` (raw calls), and every write is exercised by
`apps/crawler/write-probe.mjs`.

### Files / attachments

Attachments are `messageMediaDocument` objects (on task messages, task `attachments`, and
comment `attachments`). Each `document` has `name`, `size`, `content_key`, and a `content`
**JWT** encoding the file id, the owning workspace, and a timestamp.

Download is `GET https://app.mizito.ir/cdn/<content-token>`:

- If the token is **workspace-scoped** (its `auth.workspace` is set), the request **must**
  include that workspace's `x-token`; without it the CDN returns a tiny "invalid" stub. Tokens
  with `auth.workspace: null` are public.
- The content tokens **expire** (they embed a timestamp), so files must be fetched soon after a
  crawl; re-crawling refreshes them.

### What isn't there

Mizito chat has **no message reactions** — no such field on messages and no reaction code in the
bundle. (Recorded so it isn't re-investigated.)

---

## 6. Real-time channel

The web app keeps a live **socket.io** connection (path `/socket.io`, `websocket` transport).
When the server pushes a packet, the SPA raises in-app events such as `newMessage` and
`task_updated` to update the UI live. Mizito exposes **no webhooks**, but this channel is the
basis for any future "watch" capability: a client could connect with the session token and
record events as they arrive (near real-time). A simpler alternative is to poll lightweight
status endpoints (badges, pending, unread counts) on a schedule and diff against the last copy.

---

## 7. The extraction method, end to end

Putting the above together, the toolkit's flow is:

1. **Authenticate** (once) — real-browser login, save the session token.
2. **Select the workspace** — bootstrap, find it by name, `workspace/switch` to get a
   scoped token. Everything after uses that token; the user's session is untouched.
3. **Pull reference data** — workspace info, members, projects (+ boards), labels, dashboards.
4. **Walk every dialog** — `getFullChat` + paginated `getHistory`, saving the full message
   history per dialog.
5. **Extract tasks** — collect `media.task` from task messages across the project dialogs,
   de-duplicated by id (newest wins).
6. **Fetch comment threads** — `tasks/getComments` for every task that has comments, keyed by
   its `access_token`.
7. **Catalogue and download files** — gather every `messageMediaDocument`, then `GET /cdn/…`
   each with the scoped `x-token`.
8. **Normalise and store** — write durable JSON, then load it into a single relational
   database; one database holds many workspaces.

Discovery, crawl, file download, and database load are independent steps so each can be re-run
on its own.

---

## 8. Maintenance / failure modes

- **Token expiry.** The session token and the per-file content tokens expire (the session
  every few days). Symptoms: data calls return **HTTP 401** (an HTML error page — the client
  raises a typed `MizitoApiError{httpStatus:401}` for it), or file downloads return the small
  "invalid" stub. Fix: re-login (`npm run login` or `npm run relogin`) and/or re-crawl, then
  download files promptly. When credentials are configured, `buildContext` (core/feed.js)
  **re-logs-in automatically** on that 401 and retries once, so long-running tools (the MCP
  server) heal without intervention.
- **App version pinning.** The bundle is fetched by version (`a_.js?v=1.0.4-589`). After a Mizito
  release, endpoint names/shapes can shift; re-run the discovery scripts to re-learn them.
- **New auth steps.** The browser login handles added SMS/2FA/SSO steps transparently (the user
  completes them in the window). Headless login is password-only: if Mizito starts requiring an
  OTP (`status 7`), pass it via `--code`/`loginCode`, or fall back to the browser login.
- **Rate / politeness.** Calls are paced and retried with backoff; pagination and file downloads
  are bounded and resumable.
