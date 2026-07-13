# mizito-bridge

Bridge your [Mizito](https://office.mizito.ir) workspace to AI assistants and local
tooling. Mizito is a closed SaaS with no public API, so this repo provides — as three
workspace packages on one shared core:

- **[`@mohsp-99/mizito`](packages/mizito)** — a typed, dependency-free **TypeScript
  client library** for Mizito's (reverse-engineered) API: resource namespaces
  (`client.tasks.*`, `client.chat.*`, `client.letters.*`, …), cross-workspace feeds,
  and pluggable token providers with automatic re-login. Use it directly from any
  Node ≥ 20 script — no browser, no server.
- **[`@mohsp-99/mizito-mcp`](packages/mizito-mcp)** — an
  **[MCP](https://modelcontextprotocol.io) server** that lets an AI client
  (Claude Desktop / Claude Code) both **read** your account ("what tasks do I have?",
  "any unread messages?", "read my latest letter") **and take actions** on it — create,
  edit, comment on, progress and complete tasks; send chat messages; and send/reply to
  formal letters (the correspondence module).
- **[`@mohsp-99/mizito-crawler`](packages/mizito-crawler)** — the **browser login,
  crawler, viewer and SQLite loader** to pull a workspace's data (tasks, chats,
  comments, files) to disk as JSON you can browse, query, and keep.

You sign in once through a real browser (your password and any SMS code stay with you);
the session token is saved locally and reused.

> **Writes to your account.** The action tools create tasks, post comments, and send
> messages as you. MCP clients prompt before each tool call, so you allow or decline per
> action (or tell the assistant up front you don't want it writing). The read tools and
> the crawler never mutate anything.

> **Unofficial.** Not affiliated with Mizito; the API is reverse-engineered and
> version-pinned, so a Mizito update can change it. Use it on your own account and
> respect Mizito's terms of service.

---

## Requirements

- **Node.js ≥ 20** (uses built-in `node:sqlite` and `fetch`).
- A Mizito account you can log into.
- For the MCP server: [Claude Desktop](https://claude.ai/download) or
  [Claude Code](https://docs.claude.com/claude-code).

## Install

From a clone:

```bash
git clone https://github.com/mohsp-99/mizito-bridge.git
cd mizito-bridge
npm install          # links the workspaces; also downloads Chromium for the browser login
npm run build        # builds the TypeScript core + MCP server into dist/
```

The repo is an npm-workspaces monorepo (`packages/mizito`, `packages/mizito-crawler`,
`packages/mizito-mcp`). The root `mizito` CLI wraps every entry point (`login`, `mcp`,
`projects`, `crawl`, `files`, `db`, `view`, `api`, …); `npm run <script>` works from the
repo root.

> **Where data lives.** All tools anchor their runtime dirs (`auth/`, `data/`, `db/`,
> `downloads/`) at the **current working directory**, or at `MIZITO_DATA_DIR` when set.
> Run them from the repo root (the npm scripts do), or export
> `MIZITO_DATA_DIR=/path/to/mizito-bridge` for tools launched from elsewhere — e.g. the
> MCP server started by Claude Desktop.

## Sign in

Two ways to get a session — pick per your setup:

**Browser login** (works for every account, incl. SMS/2FA and AD/SSO):

```bash
npm run login
```

Opens a browser at the Mizito login page. Log in by hand; once the app stores a token, the
session is saved to `auth/` (git-ignored). Credentials never touch this code.

**Headless login** (password-only accounts — no browser, and the token can be refreshed
on demand). Provide credentials via environment variables:

```bash
export MIZITO_USERNAME=09xxxxxxxxx      # your phone number
export MIZITO_PASSWORD='your-password'
npm run relogin
```

…or a git-ignored `auth/credentials.json`:

```json
{ "username": "09xxxxxxxxx", "password": "your-password" }
```

The password is sent exactly as the web app sends it — `md5(pw)|sha256(pw)`, verified
byte-for-byte against Mizito's own bundle — so no browser is needed. If your account ever
asks for a one-time code, pass it: `npm run relogin -- --code 123456`.

**Automatic re-login.** Mizito sessions expire every few days. When credentials are
configured (env vars or `auth/credentials.json`), the tools detect the resulting `401` and
re-login transparently on the next call — so the MCP server keeps working without you
re-running anything. Without credentials, a stale session just asks you to sign in again.

> `auth/session.json` grants access to your account, and `auth/credentials.json` /
> `MIZITO_PASSWORD` are password-equivalent secrets. **Treat them like a password** — never
> commit or share them (the whole `auth/` dir is git-ignored by default). Prefer the browser
> login if you'd rather not store a password on disk.

---

## Use it with an AI assistant (MCP)

The MCP server (`packages/mizito-mcp/`) exposes these tools. The **read** tools aggregate across all
your workspaces; the **write** tools target one workspace (the active one unless you name
another) and resolve project/board/member/task by name.

**Read**

| Tool | Answers |
| --- | --- |
| `mizito_whoami` | who you are + your workspaces |
| `mizito_overview` | per-workspace counts: inbox, unread chats, task buckets |
| `mizito_my_tasks` | tasks assigned to you (title, project, deadline, progress) |
| `mizito_unread_messages` | conversations with unread messages (across workspaces) |
| `mizito_projects` | projects + kanban boards (+ dialog ids) in a workspace |
| `mizito_task_comments` | a task's comment thread + attachment metadata (by id or title) |
| `mizito_download_file` | download an attachment by its content token to `downloads/` |
| `mizito_conversations` | list conversations in a workspace (direct/group/project) |
| `mizito_read_conversation` | read a conversation's messages (by dialog, project, or member) |
| `mizito_letters` | list letters — inbox / outbox / archive (the correspondence module) |
| `mizito_read_letter` | read a letter thread (recipients, read receipts, body, attachments) |

**Write** (mutates your account — clients prompt before each call)

| Tool | Does |
| --- | --- |
| `mizito_create_task` | create/define a task (title, project, board, notes, assignees) |
| `mizito_edit_task` | edit a task's title/notes/deadline/progress/board/assignees |
| `mizito_comment_task` | add a comment to a task (by id or exact title) |
| `mizito_update_task_progress` | set a task's progress 0–100 (100 completes it) |
| `mizito_complete_task` | complete a task, or reopen it |
| `mizito_send_message` | send a chat message to a project chat, a dialog, or a member (DM) |
| `mizito_send_letter` | send a formal letter (recipients, subject, content) |
| `mizito_reply_letter` | reply within a letter thread |
| `mizito_mark_letter_read` | mark a letter thread read |
| `mizito_archive_letter` | archive a letter (or move it back) |

**Letters vs. chat.** Mizito has two messaging systems: **chat** (`mizito_send_message`,
`mizito_conversations`) for quick conversations, and **letters** (`mizito_letters`,
`mizito_send_letter`) — a formal, threaded correspondence module (the دبیرخانه/مکاتبات
feature) with recipients, per-person read receipts, and optional secretariat
registration. The letter *read* tools are verified live; the letter *write* tools are
built from the app's own API but not yet exercised end-to-end, so double-check the first
one you send.

A typical flow: `mizito_projects` to see valid project/board names → `mizito_create_task`
to file one → `mizito_my_tasks` then `mizito_comment_task` / `mizito_update_task_progress`
to work it. Tasks are addressed by `task_id` (from `mizito_my_tasks`) or by exact title.

Smoke-test it standalone first (it speaks MCP over stdio; build once with
`npm run build`):

```bash
npm run mcp
```

Confirm the write endpoints work against your live account at any time — this creates a
test task/comment/message in your active workspace and **deletes them again**:

```bash
npm run test:write
```

### Claude Desktop

Add an entry under `mcpServers` in your Claude Desktop config, then restart Claude
Desktop. The config file is at:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Use the **absolute path** to `packages/mizito-mcp/dist/index.js` in your clone (build it
first with `npm run build`), make sure `node` is on your PATH (or give its absolute path
as `command`), and point `MIZITO_DATA_DIR` at the clone so the server finds `auth/`:

```json
{
  "mcpServers": {
    "mizito": {
      "command": "node",
      "args": ["/absolute/path/to/mizito-bridge/packages/mizito-mcp/dist/index.js"],
      "env": { "MIZITO_DATA_DIR": "/absolute/path/to/mizito-bridge" }
    }
  }
}
```

On Windows, JSON needs escaped backslashes, e.g.
`"C:\\Users\\you\\mizito-bridge\\packages\\mizito-mcp\\dist\\index.js"`.

### Claude Code

```bash
# from anywhere; --scope user makes it available in every project
claude mcp add mizito --scope user --env MIZITO_DATA_DIR=/absolute/path/to/mizito-bridge \
  -- node /absolute/path/to/mizito-bridge/packages/mizito-mcp/dist/index.js
```

Then ask: *"What Mizito tasks do I have?"*, *"Any unread Mizito messages?"*, or have it
act — *"Create a Mizito task 'Draft the report' in the Ops project"*, *"Comment 'done' on
my task X"*, *"Mark task Y complete"*. It'll ask before each write.

---

## Crawl & explore your data

The crawler pulls a full workspace snapshot to `data/<workspace>/` (git-ignored).

```bash
npm run crawl                       # the account's active workspace
npm run crawl -- "Workspace Name"   # any workspace by name (exact or whitespace/ZWNJ-normalized)
WORKSPACE="Workspace Name" npm run crawl
```

`npm run crawl` looks the workspace up by name, **switches to it** (Mizito mints a token
scoped to that workspace; your active workspace is unaffected), and crawls it — so it
works for **any** workspace on the account, not just the active one.

**What you get** in `data/<workspace>/`: `workspace.json`, `members.json`,
`projects.json`, `project-summaries.json`, `labels.json`, `dashboard.json`,
`dialogs.json`, a normalized `tasks.json`, full per-task comment threads in
`comments.json`, per-dialog message history under `chats/`, and a `manifest.json` index.
(In Mizito an advanced project is a chat group and each task is a `messageMediaTask`
message; tasks are extracted from those and de-duplicated by id, newest wins.)

### Download attachments

```bash
npm run files                       # files for every crawled workspace
npm run files -- "Workspace Name"   # one workspace
MAX_MB=20 npm run files             # skip files larger than 20 MB
LIMIT=5 npm run files               # cap how many to download (spot-check)
```

Downloads task/comment/chat attachments to `data/<workspace>/files/` with an
`index.json` map. Idempotent (skips files already on disk at the right size). Mizito's
file tokens **expire**, so run this soon after a crawl; re-crawl if downloads start
failing.

### Load into SQLite

```bash
npm run db                          # load every crawled workspace under data/
npm run db -- "Workspace Name"      # just one

# then query with any sqlite tool, e.g.:
#   SELECT w.name, COUNT(*) FROM task t JOIN workspace w ON w.id = t.workspace_id GROUP BY w.id;
```

Loads the crawled JSON into `db/mizito.db` (git-ignored) via Node's built-in
`node:sqlite` — a simple relational model (`workspace`, `member`, `project`, `board`,
`label`, `task` + `task_assignee`/`task_label`, `comment`, `dialog`, `message`, `file`),
every row tagged by `workspace_id`. Idempotent per workspace; one database holds many.

### Browse it

```bash
npm run view                        # http://localhost:4173
```

A dependency-free single-page viewer (RTL, Persian-aware): a kanban board, a sortable
task table, members, projects, and a raw-JSON browser. A **Chats** tab renders each
dialog as a thread with inline task cards; the task detail modal shows the discussion and
links downloaded attachments. Reads straight from `data/` — re-crawl and refresh.

### Discovery / maintenance tools

For re-learning the API if Mizito changes (see [`docs/API_NOTES.md`](docs/API_NOTES.md)):

```bash
npm run discover                       # record live /api traffic while the app loads
npm run extract                        # list endpoint-shaped literals from the JS bundle
npm run api workspace/userId           # call any endpoint with the saved session
node packages/mizito-crawler/src/probe.mjs            # try candidate endpoints/payloads
node packages/mizito-crawler/src/capture-project.mjs  # capture a project's calls by driving the UI
```

---

## Layout

```
bin/                      the `mizito` CLI dispatcher (one entry point over the package scripts)
packages/mizito/          @mohsp-99/mizito — the core TypeScript library (zero dependencies)
  src/client.ts             createClient() → resource namespaces (tasks, chat, letters, …)
  src/transport/            fetch wrapper: envelope unwrap, retries, typed error codes
  src/auth/                 verified password hash, headless login, token providers
  src/feeds/                cross-workspace reads + name-resolving write layer
  src/types/                reverse-engineered API shapes (Task, Dialog, Letter, …)
packages/mizito-crawler/  login / relogin / discover / crawl / files / db / viewer / probes
packages/mizito-mcp/      MCP server — read + write tools (Claude Desktop / Claude Code)
docs/                     how Mizito works + reverse-engineering notes (incl. write endpoints)
auth/                     saved session + optional credentials (git-ignored — never commit)
data/                     crawl output (git-ignored)
db/                       SQLite store (git-ignored)
```

### Use it as a library

The core is a normal npm package — installing it pulls **no browser and no MCP SDK**,
and it ships types:

```ts
import { createClient, buildContext, createTask, myTasks, passwordSession } from '@mohsp-99/mizito';

// Low-level: typed resource namespaces over one workspace token.
const client = createClient();                          // token from the saved session
const tasks = await client.tasks.getAll();
const scoped = await client.workspaces.switch(otherWorkspaceId);

// High-level: cross-workspace feeds + name-resolving writes.
const ctx = await buildContext();                       // heals expired sessions itself
await createTask(ctx, { project: 'Ops', title: 'Ship it' });
const mine = await myTasks(ctx);

// No disk at all: keep the session in memory (e.g. CI, serverless).
const ephemeral = await buildContext(passwordSession({ username: '09…', password: '…' }));
```

Tokens come from a pluggable `TokenProvider` (`staticToken` / `diskSession` /
`passwordSession`, or your own `{ getToken, onAuthExpired }`), so the library never
dictates where your secrets live.

## How it works

Mizito is a single-page app (`office.mizito.ir`) talking to a JSON backend
(`app.mizito.ir`); every call carries a session token in the `x-token` header. The
endpoints are built at runtime, so they're discovered by observing live traffic. The
non-obvious core: **an advanced project is a chat group and a task is a message in it.**
Full details:

- [`docs/MIZITO_INTERNALS.md`](docs/MIZITO_INTERNALS.md) — how the platform is built and
  the extraction method, end to end.
- [`docs/API_NOTES.md`](docs/API_NOTES.md) — terse endpoint/payload reference.

## Security & limitations

- The session token is like a password — keep `auth/` private (git-ignored by default).
  Stored login credentials (`auth/credentials.json` / `MIZITO_PASSWORD`) are the same:
  password-equivalent. If you'd rather not store a password, use the browser login only.
- The token expires every few days (or can be revoked server-side). Re-run `npm run login`
  (or `npm run relogin`) when it does — or configure credentials so re-login happens
  automatically on the next call.
- File/content tokens expire quickly — download attachments soon after a crawl.
- Endpoints are reverse-engineered and **version-pinned**; a Mizito update can change
  them. Re-run the discovery tools to re-learn the API.

## License

MIT — see [`LICENSE`](LICENSE).
