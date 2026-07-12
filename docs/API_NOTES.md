# Mizito API — reverse-engineering notes

Captured by inspecting the `office.mizito.ir` SPA bundle (`/a_.js`, version `1.0.4-589`).
These are the facts the crawler is built on.

## Hosts

| Purpose | URL |
| --- | --- |
| Web app (SPA, hash-routed) | `https://office.mizito.ir` |
| API (`Config.App.api_url`) | `https://app.mizito.ir` |
| API prefix | `/capi` (also some `/api/...` for uploads/CRM) |

## Auth

- **Login**: `POST https://app.mizito.ir/capi/session/create`
  - Body: `{ username, password, loginCode, regId }`
  - `password` is **not** sent in plaintext: the SPA sends
    `md5(password) + "|" + sha256(password)` (from `i.createHash(a)+"|"+r.convertToSHA256(a)`),
    *unless* the tenant uses dedicated AD/SSO, in which case the raw password is sent.
  - Response is the standard envelope; on success the token is stored in
    `localStorage.token` and `sessionStorage.token`.
  - Because of the hashing, we log in via a real browser instead of replaying this
    call — see `apps/crawler/login.mjs`.
- **Every other call** authenticates with the header `x-token: <token>`
  (seen as `headers:{"x-token":d.getToken()}`).
- SSO login: `GET /capi/sso/login`. Uploads: `POST /api/content/upload`.

## Response envelope

Calls return JSON shaped like:

```json
{ "status": 1, "data": <payload>, "msg": "" }
```

`status === 1` (or `true`) means success. The API client in `core/http.js` unwraps
`.data` automatically and throws `MizitoApiError` otherwise.

## Endpoints

Most data endpoints are built dynamically in the bundle, so they can't be scraped
statically. They are discovered at runtime by `apps/crawler/discover.mjs`, which records
the live `/capi` traffic while browsing the workspace. See
`data/_discovery/endpoints.json` after running `npm run discover`.

**Endpoint literals use dot notation.** In the bundle the SPA calls
`invokeApi("group.action", payload)` — e.g. `invokeApi("tasks.newComment", …)`. The dot
maps to a slash in the URL: `tasks.newComment` → `POST /api/tasks/newComment`. So the full
API surface *is* greppable in the (gunzipped) bundle as `invokeApi("…")` literals — that is
how the write endpoints below were recovered (the earlier `group/action` slash scan missed
them). `npm run extract` lists the `group/action` shaped literals; grepping the bundle for
`invokeApi\("[a-z]+\.[a-z]+"` lists the rest.

Hash-route hints seen in the SPA (UI sections that imply data endpoints):
`/projects`, `/projects/monitor`, `/project/monitor/tasks`,
`/project/monitor/calendar`, `/tasks`, `/monitoring/users`, `/monitoring/tasks`,
`/workspace_switching`, `/import_project`.

## Confirmed endpoints (from live capture)

All `POST`. The workspace is selected server-side per session (the active `wid`).
Calls act on the active workspace; to read another, `workspace/switch` first (it
mints a scoped token without changing your active workspace — see below).

| Endpoint | Payload | Returns |
| --- | --- | --- |
| `workspace/userId` | `{}` | `{ uid, wid, workspaces:[{_id,title,active}], ... }` |
| `workspace/name` | `{}` | workspace name (string) |
| `workspace/planInfo` | `{}` | `{ used, volume, remain_days }` |
| `workspace/getUsers` | `{}` | `{ users:[...], user_status:[...] }` (workspace members) |
| `projects/getList` | `{}` | `{ projects:[{_id,title,kanban_boards,dialog,...}], project_status }` |
| `projects/allSummary` | `{}` | `{ summaries:[{project,total_tasks,boards,dialog,...}] }` |
| `labels/getAll` | `{type:'task'}` | `{ labels:[...], label_status }` |
| `dashboard/getAllSummary` | `{}` | per-workspace task/inbox/chat counts |
| `dashboard/getAllWorkspacesUsers` | `{}` | users grouped by workspace |
| `chat/getDialogs` | `{}` | `{ dialogs:[...], pin_dialogs }` (DMs / non-project chats) |
| `chat/getFullChat` | `{dialog}` | full chat/group object (members, photo, project_entity...) |
| `chat/getHistory` | `{dialog, offset}` | **array** of messages, page size **15** |
| `chat/getMessages` | `{mids:[...], dialog}` | array of specific messages |
| `monitor/project` | `{projectId, ...}` | project monitoring (needs extra params; not used) |

### Personal "feed" endpoints (used by the read-only MCP server)

Verified live. These return data scoped to the session's **active** workspace, so the
MCP server reads other workspaces by `workspace/switch` first (see below).

| Endpoint | Payload | Returns |
| --- | --- | --- |
| `tasks/upcoming` | `{outbox:false, from_dashboard:true, from:null, filter:null}` | **array** of the tasks awaiting *me* (full task objects: `title, notes, project, progress, completed, alarm_at, has_deadline, has_attachments, dialog, access_token, ...`). `outbox:true` instead = tasks I assigned out. Filters by relevance, **not** a full task dump. |
| `tasks/badge` | `{}` | `{ today, count, total_count }` (my task counts) |
| `inbox/badge` | `{}` | `{ inbox_count }` |
| `dashboard/getAllSummary` | `{}` | **array**, one row per workspace: `{workspace_id, workspace_title, inbox, chat, task:{today,overdue,with_time,no_time}, meetings}`. The one cheap cross-workspace overview. |
| `dashboard/getPending` | `{}` | array of pending items (empty when nothing pending) |
| `dashboard/checkWhatsNew` | `{}` | `{ count, message }` |

`tasks/getAll {}` exists too but returns the **whole** workspace's tasks (1330 in one
test) — not personal; avoid for "my tasks".

**`workspace/switch` token shape varies.** It usually returns the standard
`{status, data:{token}}` envelope, but sometimes `{token}` directly — extract with
`sw.data?.token || sw.token` (handled in `core/feed.js`).

### The key insight: tasks are chat messages

Advanced projects are **chat groups** (`is_project_group: true`,
`project_entity: <projectId>`, addressed by the project's `dialog` id). A task is a
message whose `media._ === "messageMediaTask"`, carrying the full task under
`media.task` (`_id, title, notes, owner, assignee, board, labels, dates, ...`).

So crawling a project's tasks = paging `chat/getHistory {dialog, offset}` (offset += 15
each page until a short/empty page) and collecting `media.task` from task messages.
Dialogs to crawl = every project's `dialog` (from `projects/getList`) plus everything
in `chat/getDialogs`.

## Task comment threads

`last_comment` on a task is only the latest comment. The full thread is:

- `POST /api/tasks/getComments` with body `{ token: <task.access_token> }` — note it is
  keyed by the task's `access_token` **JWT**, not its id (which is why probing with
  `{task:id}` 404'd). Returns an **array** of comments:
  `{ _id, comment, comment_owner, comment_at, attachments, mention, replied_comment_id,
  edited, deleted }`.

The crawler fetches this for every task with `has_comments` and writes `comments.json`
(`[{task_id, count, comments:[...]}]`).

## Write endpoints (verified live)

All `POST`, act on the session's **active/scoped** workspace (switch first for another).
Every one of these was exercised end-to-end against a real workspace and cleaned up — see
`apps/crawler/write-probe.mjs` (`npm run test:write`). Wrapped in `core/mizito.js` (raw) and
`core/write.js` (name-resolving, normalized); surfaced as MCP tools in `apps/mcp/index.mjs`.

| Endpoint | Payload | Returns / notes |
| --- | --- | --- |
| `tasks/add` | `{title, notes, assignee:[uid], project, kanban_board, labels:[], attachments:[], deleted:false, alarm_options:null, progress:0, deadline_start, deadline, checklist:[], responsible, insert_to_chat_group}` | The created **task object** (`_id, access_token, dialog, …`). For an advanced project, `insert_to_chat_group:true` also posts the task message into the project group chat. `project`/`kanban_board` may be `null` for a personal task. |
| `tasks/save` | same shape **plus** `{task_id, token}` (token = `access_token`) | Updated task object. Used to edit an existing task. |
| `tasks/newComment` | `{token: access_token, comment, attachments:[], mention:[], reply_id:null}` | `true`. Keyed by the task `access_token` JWT (same as `getComments`). |
| `tasks/updateProgress` | `{token: access_token, progress}` (0–100) | Updated task object. `progress:100` completes it. |
| `tasks/setCompleted` | `{token, completed, project, progress?, undone_user_id?}` | Updated task object. `project` is **required**. Completing sets `progress:100`; reopening (`completed:false`) takes the target `progress` and optional `undone_user_id`. |
| `tasks/removeTask` | `{token: access_token}` | `{message}` on success. **Gotcha:** rejects a *completed* task with an HTML "Bad Request" — reopen (`setCompleted{completed:false}`) first, then delete. |
| `chat/send` | `{_:"message", dialog, out:true, message, media:null, from:uid, date:Date.now(), reply_to:null, mention:[], seen_count:1, randomId}` | `true` — **no message id echoed back**. To delete a just-sent message, find its `mid` via `chat/getHistory` then `chat/removeSentMessage`. |
| `chat/removeSentMessage` | `{dialog, mid}` | `true`. Deletes a message you sent. |

The full recovered API surface (≈200 `invokeApi` literals across `tasks/chat/projects/
workspace/inbox/labels/notes/meeting/…`) is much larger than what is wired up; only the
task + chat write surface above is implemented. Other notable unimplemented writes seen in
the bundle: `tasks/snooze`, `tasks/setChecklistCheckedValue`, `tasks/toggleBookmark`,
`tasks/removeFromBoard`, `tasks/setKanbanWeight`, `projects/add`, `projects/addKanbanBoard`,
`labels/add`, `chat/createDialog`, `chat/updateSentMessage`, `inbox/send`.

## Files / attachments

Attachments appear as `messageMediaDocument` objects (on task messages, task
`attachments`, and comment `attachments`). Each `document` has `name`, `size`,
`content_key`, and a `content` JWT (payload: `{content:<fileId>, auth:{workspace},
timestamp}`).

Download (**verified**, GET): `https://app.mizito.ir/cdn/<content-token>`.

- If the token is **workspace-scoped** (`auth.workspace` set), the request **must**
  carry that workspace's session token in `x-token`; without it the CDN returns a
  ~15-byte `invalid` stub (HTTP 200). Tokens with `auth.workspace: null` are public.
- Verified end-to-end: a fetched PDF returns `200 application/pdf` with a byte count
  matching the document's `size` and a valid `%PDF-` signature; `npm run files`
  downloads a workspace's attachments with the scoped `x-token`.
- The content tokens **expire** (they embed a timestamp), so run `npm run files` soon
  after a crawl; re-crawl to refresh tokens if downloads start returning the stub.
- Upload (not used) is `POST /api/content/upload`.

## No reactions

Mizito chat has no message reactions — the bundle has zero `reaction` literals and no
message object carries a reactions field. (Listed here so it isn't re-investigated.)

## Real-time events (the "webhook" question)

Mizito has **no public webhooks or integration API** (it's a closed SaaS). But the web
app keeps a **socket.io** real-time connection (bundle uses the socket.io client at path
`/socket.io`, `websocket` transport; it raises in-app events like `newMessage` and
`task_updated` when packets arrive). Two ways to get events "outside" and record them:

1. **Socket bridge** — connect to Mizito's socket.io endpoint as an authenticated client
   (same session token) and persist the events it pushes (new messages, task changes).
   Closest thing to webhooks; needs the handshake (namespace + auth param) captured once.
2. **Polling** — on a schedule, hit cheap endpoints (`tasks/badge`, `inbox/badge`,
   `dashboard/getPending`, `chat/getDialogs` unread counts) and diff against the last
   crawl to detect and log changes. Not instant, but simple and robust.

Neither is built yet — this section records feasibility for a future `watch` step.
