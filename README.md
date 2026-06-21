# mizito-bridge

Bridge your [Mizito](https://office.mizito.ir) workspace to AI assistants and local
tooling. Mizito is a closed SaaS with no public API, so `mizito-bridge`:

- runs a **read-only [MCP](https://modelcontextprotocol.io) server** that lets an AI
  client (Claude Desktop / Claude Code) answer "what tasks do I have?" and "any unread
  messages?" from your live Mizito account, and
- ships a **crawler + viewer + SQLite loader** to pull a workspace's data (tasks,
  chats, comments, files) to disk as JSON you can browse, query, and keep.

You sign in once through a real browser (your password and any SMS code stay with you);
the session token is saved locally and reused. Nothing here writes to or mutates your
Mizito account.

> **Unofficial.** Not affiliated with Mizito. It only reads data you already have access
> to. Use it on your own account and respect Mizito's terms of service.

---

## Requirements

- **Node.js ≥ 20** (uses built-in `node:sqlite` and `fetch`).
- A Mizito account you can log into.
- For the MCP server: [Claude Desktop](https://claude.ai/download) or
  [Claude Code](https://docs.claude.com/claude-code).

## Install

```bash
git clone https://github.com/mohsp-99/mizito-bridge.git
cd mizito-bridge
npm install          # also downloads the Chromium build Playwright drives for login
```

## Sign in (once)

```bash
npm run login
```

This opens a browser at the Mizito login page. Log in by hand (including any SMS/2FA).
Once the app stores a token, the session is saved to `auth/` (git-ignored). The token is
long-lived but can be invalidated server-side — if calls later fail with auth errors,
just run `npm run login` again.

> `auth/session.json` grants access to your account. **Treat it like a password** and
> never commit or share it (it's git-ignored by default).

---

## Use it with an AI assistant (MCP)

The MCP server (`apps/mcp/`) exposes four **read-only** tools, aggregated across all your
workspaces:

| Tool | Answers |
| --- | --- |
| `mizito_whoami` | who you are + your workspaces |
| `mizito_overview` | per-workspace counts: inbox, unread chats, task buckets |
| `mizito_my_tasks` | tasks assigned to you (title, project, deadline, progress) |
| `mizito_unread_messages` | conversations with unread messages |

Smoke-test it standalone first (it speaks MCP over stdio):

```bash
npm run mcp
```

### Claude Desktop

Add an entry under `mcpServers` in your Claude Desktop config, then restart Claude
Desktop. The config file is at:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Use the **absolute path** to `apps/mcp/index.mjs` in your clone, and make sure `node` is
on your PATH (or give its absolute path as `command`):

```json
{
  "mcpServers": {
    "mizito": {
      "command": "node",
      "args": ["/absolute/path/to/mizito-bridge/apps/mcp/index.mjs"]
    }
  }
}
```

On Windows, JSON needs escaped backslashes, e.g.
`"C:\\Users\\you\\mizito-bridge\\apps\\mcp\\index.mjs"`.

### Claude Code

```bash
# from anywhere; --scope user makes it available in every project
claude mcp add mizito --scope user -- node /absolute/path/to/mizito-bridge/apps/mcp/index.mjs
```

Then ask: *"What Mizito tasks do I have?"* or *"Any unread Mizito messages?"*

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
node apps/crawler/probe.mjs            # try candidate endpoints/payloads
node apps/crawler/capture-project.mjs # capture a project's calls by driving the UI
```

---

## Layout

```
core/          config + auth + API client + personal-feed layer (shared building blocks)
apps/crawler/  login / discover / crawl / files / db entry points
apps/viewer/   local data browser
apps/mcp/      read-only MCP server (Claude Desktop / Claude Code)
docs/          how Mizito works + reverse-engineering notes
auth/          saved session (git-ignored — never commit)
data/          crawl output (git-ignored)
db/            SQLite store (git-ignored)
```

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
- The token can expire/be revoked server-side; re-run `npm run login` when it does.
- File/content tokens expire quickly — download attachments soon after a crawl.
- Endpoints are reverse-engineered and **version-pinned**; a Mizito update can change
  them. Re-run the discovery tools to re-learn the API.

## License

MIT — see [`LICENSE`](LICENSE).
