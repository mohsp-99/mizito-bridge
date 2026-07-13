# @mohsp-99/mizito-mcp

[MCP](https://modelcontextprotocol.io) server for [Mizito](https://office.mizito.ir):
lets an AI client (Claude Desktop / Claude Code) both **read** your Mizito account —
tasks, unread messages, conversations, formal letters — **and act on it**: create/edit/
comment/progress/complete tasks, send chat messages, send and reply to letters.

Built on [`@mohsp-99/mizito-core`](https://www.npmjs.com/package/@mohsp-99/mizito-core), the typed
(unofficial) Mizito client. No browser required.

> **Writes to your account.** MCP clients prompt before each tool call, so you allow or
> decline per action. **Unofficial** — not affiliated with Mizito; use on your own
> account and respect Mizito's terms.

## Setup

The server needs a Mizito session. Simplest: give it your credentials via env vars — it
logs in headless on first use and re-logs-in automatically when the session expires
(password-only accounts; OTP/SSO accounts should mint a session with the browser login
from the [mizito-bridge repo](https://github.com/mohsp-99/mizito-bridge) instead).

`MIZITO_DATA_DIR` is where the session and downloads live (defaults to the server
process's working directory — set it explicitly).

### Claude Desktop

Add under `mcpServers` in `claude_desktop_config.json`
(**Windows:** `%APPDATA%\Claude\`, **macOS:** `~/Library/Application Support/Claude/`),
then restart Claude Desktop:

```json
{
  "mcpServers": {
    "mizito": {
      "command": "npx",
      "args": ["-y", "@mohsp-99/mizito-mcp"],
      "env": {
        "MIZITO_USERNAME": "09xxxxxxxxx",
        "MIZITO_PASSWORD": "your-password",
        "MIZITO_DATA_DIR": "/somewhere/private/mizito"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add mizito --scope user \
  --env MIZITO_USERNAME=09xxxxxxxxx \
  --env MIZITO_PASSWORD='your-password' \
  --env MIZITO_DATA_DIR=/somewhere/private/mizito \
  -- npx -y @mohsp-99/mizito-mcp
```

Then ask: *"What Mizito tasks do I have?"*, *"Any unread Mizito messages?"*, *"Create a
Mizito task 'Draft the report' in the Ops project"*. The client asks before each write.

> Your password and the saved session are secrets; the config file and
> `MIZITO_DATA_DIR/auth/` must stay private. If you already have a session file (e.g.
> from the repo's browser login), you can omit the credentials and just point
> `MIZITO_DATA_DIR` at the directory containing `auth/session.json`.

## Tools

**Read** — `mizito_whoami`, `mizito_overview`, `mizito_my_tasks`,
`mizito_unread_messages`, `mizito_projects`, `mizito_task_comments`,
`mizito_download_file`, `mizito_conversations`, `mizito_read_conversation`,
`mizito_letters`, `mizito_read_letter`.

**Write** (mutating, prompted per call) — `mizito_create_task`, `mizito_edit_task`,
`mizito_comment_task`, `mizito_update_task_progress`, `mizito_complete_task`,
`mizito_send_message`, `mizito_send_letter`, `mizito_reply_letter`,
`mizito_mark_letter_read`, `mizito_archive_letter`.

Read tools aggregate across all your workspaces; write tools target one workspace (the
active one unless you name another) and resolve projects/boards/members/tasks by name,
failing loudly on ambiguity.

## License

MIT
