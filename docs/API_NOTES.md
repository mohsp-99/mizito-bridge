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
  - Body: `{ username, password, loginCode, regId }`. `username` = phone; `loginCode` = SMS/OTP
    (empty for password-only); `regId` = push-device id (**`null` is accepted**).
  - `password` is **not** sent in plaintext: the SPA sends
    `md5(password) + "|" + sha256(password)` (from `i.createHash(a)+"|"+r.convertToSHA256(a)`),
    *unless* the tenant uses dedicated AD/SSO, in which case the raw password is sent. Both
    hashes are **lowercase hex** and **verified byte-for-byte** equal to Node's
    `crypto.createHash('md5'|'sha256').digest('hex')` (test-vector checked against the extracted
    bundle functions), so no browser/library is needed to reproduce them.
  - Response body carries `status` + `token` at the top level. **Success = `status` 1 or 5**
    (token present); `status 0` = wrong username/password; `status 7` = OTP required.
  - Two implementations: the **browser login** (`packages/mizito-crawler/src/login.mjs`,
    credentials stay with the user; needed for OTP/SSO) and the **headless login**
    (`packages/mizito-core/src/auth/login.ts` / `packages/mizito-crawler/src/relogin.mjs` —
    `npm run relogin`, replays this call for on-demand token minting and automatic re-login).
- **Every other call** authenticates with the header `x-token: <token>`
  (seen as `headers:{"x-token":d.getToken()}`). An **expired/invalid token → HTTP 401** with an
  HTML error page; the transport (`packages/mizito-core/src/transport/http.ts`) raises a typed
  `MizitoApiError{code:'auth'}` for it and gives the token provider one `onAuthExpired()`
  retry — the `diskSession` provider (`packages/mizito-core/src/auth/providers.ts`) uses that to
  re-login automatically when credentials are configured.
- SSO login: `GET /capi/sso/login`. Uploads: `POST /api/content/upload`.

## Response envelope

Calls return JSON shaped like:

```json
{ "status": 1, "data": <payload>, "msg": "" }
```

`status === 1` (or `true`) means success. The transport in
`packages/mizito-core/src/transport/http.ts` unwraps `.data` automatically and throws
`MizitoApiError` otherwise.

## Endpoints

Most data endpoints are built dynamically in the bundle, so they can't be scraped
statically. They are discovered at runtime by `packages/mizito-crawler/src/discover.mjs`, which records
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
`sw.data?.token || sw.token` (handled by `tokenFromSwitch` in
`packages/mizito-core/src/resources/workspaces.ts`).

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
`packages/mizito-crawler/src/write-probe.mjs` (`npm run test:write`). Wrapped in
`packages/mizito-core/src/resources/*.ts` (raw) and `packages/mizito-core/src/feeds/write.ts`
(name-resolving, normalized); surfaced as MCP tools in `packages/mizito-mcp/src/index.ts`.

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

The full API surface is **230 `invokeApi` literals across 14 modules** (extracted from
the bundle — see the inventory appendix at the end of this file). Roughly half is now
wrapped in the core; the rest is either deliberately out of scope (meetings, monitor
charts, CRM, support, session lifecycle) or needs a live-capture pass for its payload
shape (the 16 gantt endpoints). The endpoints filled in the 2026-07 round — task/chat/
project/label/dashboard/inbox gaps, workspace member admin, the **notes** module, and
**uploads** (`content/upload`) — were wrapped from their exact bundle call-site payloads
but, apart from the previously-verified task/chat writes, are **not yet exercised live**.

## Letters / correspondence (the "inbox" module)

Mizito's `inbox/*` group is **not** chat — it's a formal, threaded correspondence
module (the دبیرخانه/مکاتبات feature: letters with recipients, read receipts, and
optional secretariat registration with in/out numbers). **Verified live (reads).**

Letters are grouped into **threads**; nearly every op is keyed by `{thread}`. The
mailbox is chosen by `mode`.

| Endpoint | Payload | Returns |
| --- | --- | --- |
| `inbox/getInbox` | `{mode, offset, ...extra}` — `mode` = `inbox`\|`outbox`\|`archive` | **array** of letter rows: `{_id, thread, msg_id, subject, from, send_date, unread, attachments_count, labels:[id], dialogs, secretariat, short_content(HTML), raw_content, count, receivers?(outbox)}`. Page size ~50. |
| `inbox/getHistory` | `{thread}` | the letter: `{_id, thread, subject, from, to:[{user,unread,seen_date,archived}], receivers, send_date, content(HTML), is_seen, bookmarked, labels, dialogs, attachments, messages:[…replies]}`. Single-message threads have an empty `messages`. |
| `inbox/getMessageLabels` | `{thread}` | array of label objects `{_id,title,color,type,deleted}`. |
| `inbox/badge` | `{}` | `{ inbox_count }` (already used by the overview). |

Write endpoints (**recovered from the bundle; NOT yet exercised live** — unlike the
task/chat writes). All `POST`, act on the active/scoped workspace.

| Endpoint | Payload | Notes |
| --- | --- | --- |
| `inbox/send` | compose model `{to:[uid], subject, content(HTML), attachments:[], tasks_insert_to_chat_groups:[], labels:[]}`; add `{thread}` to reply within a thread | The SPA rejects an empty `to`. In the UI `to` is an array of user objects mapped to ids before sending. `attachments` entries are the **bare** `{_:'messageMediaDocument', document}` wrapper (see Files/attachments) — **not** the task `{_id, media}` shape. **Verified live 2026-07-20** (send with attachment → read back → download). The response does **not** carry `thread` or `_id`, so `sendLetter` returns `thread: null` — find the new thread via `inbox/getInbox {mode:'outbox'}` (newest first). `feeds/letters.ts` rejects a bare `false`/`{error}` but cannot confirm more than "not refused". |
| `inbox/seen` | `{thread}` | Mark a letter thread read. |
| `inbox/archive` / `inbox/archive/sender` | `{thread}` | Archive; the `.sender` variant is for **sent** (outbox) letters. (In the bundle the literal is `inbox.archive.sender`; dots map to slashes in the URL — see below.) |
| `inbox/unArchive` / `inbox/unArchive/sender` | `{thread}` | Unarchive (received / sent). |
| `inbox/toggleBookmark` | `{thread}` | Bookmark toggle. |
| `inbox/registerInLetter` / `inbox/registerOutLetter` | `{thread, letterOptions}` | Formal secretariat registration (نامه‌ی وارده/صادره). Not wired up. |
| `inbox/changeMessageLabels` | `{thread, labels:[id]}` | Not wired up. |
| `inbox/changeMessageDialogs` | `{thread, dialogs:[id]}` | Link a letter to chat dialogs. Not wired up. |
| `inbox/getSeenDetails` | `{thread, msgId}` | Per-recipient seen details. Not wired up. |
| `inbox/deleteMessage` | `{thread}` | Not wired up. |

**URL construction (dots → slashes).** The SPA builds every data URL as
`api_url + "/api/" + endpoint.replaceAll(".", "/")`. So a two-dot literal like
`inbox.archive.sender` becomes `POST /api/inbox/archive/sender`.

Wrapped in `packages/mizito-core/src/resources/letters.ts` (raw: `getInbox`, `getHistory`,
`getMessageLabels`, `send`, `seen`, `archive`, `unarchive`, `toggleBookmark`) and
`packages/mizito-core/src/feeds/letters.ts` (name-resolving, normalized: `listLetters`,
`readLetter`, `sendLetter`, `replyLetter`, `markLetterRead`, `archiveLetter`); surfaced
as the `mizito_letters` / `mizito_read_letter` / `mizito_send_letter` /
`mizito_reply_letter` / `mizito_mark_letter_read` / `mizito_archive_letter` MCP tools.

## Conversations (chat) — extra endpoints

Beyond the confirmed `chat/getDialogs` / `getFullChat` / `getHistory` / `getMessages`
/ `send` / `removeSentMessage` above, the read side uses:

| Endpoint | Payload | Returns / notes |
| --- | --- | --- |
| `chat/getChatView` | `{dialog}` | Combined dialog view: `{_id, is_group, is_project_group, project_entity, photo, unread_count, messages_count, members, group_admins, pinned_messages, title, …}`. **Verified live.** |
| `chat/search` | `{mode, offset, search_str?, bookmarked?}` — `mode` = `all` or a dialog id | **array** of matching messages. **Verified live** (empty result on an empty query). |
| `chat/createDialog` | `{user}` (a member id) | **WRITE.** Opens (or returns the existing) direct-message dialog with a user; returns the dialog. Recovered from the bundle. |
| `chat/seen` | `{dialog, seen_count}` | **WRITE.** Mark a dialog seen up to `seen_count`. Recovered from the bundle. |

**Message kinds** seen in `chat/getHistory` (used by the conversation normalizer):
`message` (plain text, `.message`), `messageMediaTask` / `messageMediaMentionInTask`
(`.media.task`), `messageMediaPhoto` (`.media.photo.photo_{small,medium,large}` each
with a CDN `content` token), `messageMediaDocument` (`.media.document`), and
`messageService` (group events).

Wrapped in `packages/mizito-core/src/resources/chat.ts` (`getChatView`, `search`,
`createDialog`, `seen`) and `packages/mizito-core/src/feeds/conversations.ts` (`listConversations`, `readConversation`,
`messageUser`); surfaced as `mizito_conversations` / `mizito_read_conversation`, and
`mizito_send_message` gained a `user` target (direct message) that opens the DM via
`chat/createDialog`.

## Files / attachments

Attachments appear as `messageMediaDocument` objects (on task messages, task
`attachments`, comment `attachments`, and letters). Each `document` has `name`, `size`,
`content_key`, and a `content` JWT (payload: `{content:<fileId>, auth:{workspace},
timestamp}`).

### Two attachment shapes — tasks vs letters (**verified live**)

The wrapper is the same; how deep it sits is **not**, and the API is strict about it:

| Module | Read from | `attachments[]` entry |
| --- | --- | --- |
| Tasks / comments | `tasks/getAll`, `tasks/getComments` | `{_id:<server>, media:{_:'messageMediaDocument', document:{…}}}` |
| Letters | `inbox/getHistory` (thread **and** reply level) | `{_:'messageMediaDocument', document:{…}}` — **no `media` layer** |

Posting the wrong shape fails **silently**: `tasks/newComment` answers a bare `false`
outside the `{status,data}` envelope and stores nothing. Letters were long assumed to
share the task shape; they do not.

`feeds/write.ts` normalizes both: `documentOf()` peels `media`/`document` layers off
whatever it is given, then `asAttachmentEntry()` (tasks) / `asMediaWrapper()` (letters)
rebuild the target shape. This also makes an attachment re-used across modules — read off
a task, sent on a letter — come out right.

Download (**verified**, GET): `https://app.mizito.ir/cdn/<content-token>`.

- If the token is **workspace-scoped** (`auth.workspace` set), the request **must**
  carry that workspace's session token in `x-token`; without it the CDN returns a
  ~15-byte `invalid` stub (HTTP 200). Tokens with `auth.workspace: null` are public.
- Verified end-to-end: a fetched PDF returns `200 application/pdf` with a byte count
  matching the document's `size` and a valid `%PDF-` signature; `npm run files`
  downloads a workspace's attachments with the scoped `x-token`.
- The content tokens **expire** (they embed a timestamp), so run `npm run files` soon
  after a crawl; re-crawl to refresh tokens if downloads start returning the stub.

### Uploads (the write-half of attachments)

**`POST /api/content/upload`** — multipart/form-data, `x-token` header, **not** a dotted
`invokeApi` call. From the bundle (`Config.App.api_url + "/api/content/upload"`, sent via
`$.ajax` with `processData:false, contentType:false`) the FormData fields are:

| Field | Value |
| --- | --- |
| `upload` | the file bytes (required); the part's filename is the sent name |
| `maxWidthHeight` | optional — cap the longest image side (server-side resize) |
| `sendAsFile` | `"true"` to keep a file/document, `"false"` to treat an image as an inline photo |

The response (**verified live 2026-07-20**) is the `messageMediaDocument` **wrapper**, not
the bare document — earlier notes here and in `content.ts` had this wrong:

```jsonc
{ "_": "messageMediaDocument",
  "document": { "_id": "...", "name": "quote_sheet_v1_EXAMPLE.pdf",
                "size": 264575, "content": "<jwt>", "content_key": "..." } }
```

So it drops into a **letter**'s `attachments: []` as-is, and needs one more `media` layer
for a **task**. A fresh upload's `content` JWT is user-scoped (`auth:{user}`); once
attached it is re-issued workspace-scoped (`auth:{workspace}`).

Wrapped in `resources/content.ts` (`upload`, `getDownloadLink`, `getCroppedPhoto`); the
feed layer (`feeds/write.ts`) adds `uploadFile()` and an `attachments`/`files` option on
`createTask` / `commentOnTask` / `sendLetter` / `replyLetter` that uploads and threads the
document in one call. Prefer those over hand-assembling either shape — `documentOf()`
accepts any of them and rebuilds whichever the target module needs.

**End-to-end verified** (`sendLetter` with `files:`, 2026-07-20): upload → letter →
`inbox/getHistory` read-back → CDN download returned the identical 264,575-byte PDF
(sha256 match).

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

## Appendix — full endpoint inventory (bundle `1.0.4-589`)

Every `invokeApi("group.action", …)` literal in the SPA bundle, by module: **230
endpoints across 14 modules**. Extract them yourself with
`grep -oE 'invokeApi\("[a-z_]+\.[a-zA-Z_.]+"' a_.js` (fetch the bundle from
`office.mizito.ir/a_.js?v=<version>`). The core currently wraps **123** of them
(`resources/*.ts` — verify with `grep -rhoE "'[a-z]+/[a-zA-Z/]+'" packages/mizito-core/src/resources`).

| Module | Total | Wrapped | Notes on what's left |
| --- | --- | --- | --- |
| `tasks` | 28 | 22 | left: `get`, `ganttGetTaskInfo`, `print` (HTML), `createShareLink` done; `setKanbanWeightSort`, `removeTask*` variants covered |
| `chat` | 37 | 27 | left: `fixDialogs`, `convert*`, `removeMentionMessage`, `removeSentMessageAdmin`, `removeTaskSnoozeMessage`, `getDialogUnDoneTasksCount` (niche/admin) |
| `projects` | 40 | 16 | left: **all 16 gantt** endpoints (need live capture), `import*`, `getListAdmin*`, `setAdvancedFeatures`, `getProjectFiles` |
| `inbox` | 22 | 18 | left: `wait`, plus the two `*.sender` archive variants are folded into `archive`/`unarchive` |
| `labels` | 7 | 5 | left: `len`, `sendUsage` (telemetry) |
| `dashboard` | 11 | 7 | left: `whatsNew`/`setWhatsNewSeen`/`demoGuide`/`notifySeen` (UI chrome) |
| `workspace` | 22 | 9 | left: role/permission/plan admin (`changeRole`, `updateUserPermission`, `getPlans` done), `add`/`delete`/`changeOwner` (destructive account ops) |
| `notes` | 9 | 9 | **complete** |
| `content` | 3 | 3 | **complete** (upload + 2 download-link helpers) |
| `session` | 10 | 0 | out of scope: `register`, `forgot*`, `logout`, `deleteAccount*` (auth lifecycle) |
| `meeting` | 7 | 0 | out of scope: video/audio meetings — needs live capture |
| `monitor` | 15 | 0 | out of scope: analytics/attendance charts — needs live capture |
| `support` | 14 | 0 | out of scope: in-app support tickets |
| `crm` | ~5 | 0 | out of scope: customers module |

"Out of scope" = intentionally not wrapped this round; "needs live capture" = the payload
shape isn't inferable from the bundle call site alone (drive the UI with
`npm run discover` to record it). Everything wrapped in the 2026-07 round that wasn't
already verified is typed from the exact bundle call-site payload but **not yet exercised
live** — treat first real calls as unverified.
