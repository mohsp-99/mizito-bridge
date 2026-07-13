# @mohsp-99/mizito

Typed client library for the [Mizito](https://office.mizito.ir) API — tasks, chat,
letters (correspondence), projects, workspaces. Mizito is a closed SaaS with no public
API; this library reproduces the web app's own calls (reverse-engineered, version-pinned)
so you can read **and write** your account from any Node ≥ 20 script. **No browser, no
server, zero dependencies** — just `fetch` and `crypto`.

> **Unofficial.** Not affiliated with Mizito. Endpoints track app bundle `1.0.4-589`; a
> Mizito update can change them. Use it on your own account and respect Mizito's terms.

## Install

```bash
npm install @mohsp-99/mizito
```

## Sign in

The library authenticates with Mizito's session token, obtained by replaying the app's
own password login (the password is sent exactly as the web app sends it:
`md5(pw)|sha256(pw)`, verified byte-for-byte against Mizito's bundle).

The simplest setup — environment variables:

```bash
export MIZITO_USERNAME=09xxxxxxxxx      # your phone number
export MIZITO_PASSWORD='your-password'
```

With those set, the default provider logs in on first use, saves the session to
`<data root>/auth/session.json`, and **re-logs-in automatically** whenever the token
expires (Mizito sessions last a few days). The *data root* is the current working
directory, or `MIZITO_DATA_DIR` when set.

> `MIZITO_PASSWORD` and `auth/` contents are password-equivalent secrets — never commit
> them. Password-only accounts work headless; OTP/SSO accounts need a browser login (see
> the [mizito-bridge repo](https://github.com/mohsp-99/mizito-bridge)) to mint the session.

## Use it

### The client — typed resource namespaces

```ts
import { createClient } from '@mohsp-99/mizito';

const client = createClient();                    // token via the default diskSession()
const tasks = await client.tasks.getAll();        // every task in the active workspace
const { dialogs } = await client.chat.getDialogs();
const letters = await client.letters.getInbox('inbox');

// Read another workspace without touching your active one:
const scoped = await client.workspaces.switch(workspaceId);
await scoped.tasks.getAll();
```

Namespaces map 1:1 to confirmed endpoints: `tasks`, `chat`, `projects`, `labels`,
`workspaces`, `letters`, `dashboard`, `files` (CDN attachment download).

### Feeds — cross-workspace reads and name-resolving writes

```ts
import { buildContext, overview, myTasks, unreadMessages, createTask, sendMessage } from '@mohsp-99/mizito';

const ctx = await buildContext();                 // identity + workspaces, self-healing
console.log(await overview(ctx));                 // per-workspace counters
console.log(await myTasks(ctx));                  // my open tasks, all workspaces

// Writes resolve human names (project / board / member / task title) to ids and fail
// loudly on ambiguity — these MUTATE your account:
await createTask(ctx, { project: 'Ops', title: 'Ship it', deadline: null });
await sendMessage(ctx, { project: 'Ops', text: 'Shipped ✅' });
```

### Token providers — bring your own session handling

The transport never reads disk or env itself; it asks an injected provider:

```ts
import { createClient, staticToken, diskSession, passwordSession } from '@mohsp-99/mizito';

createClient({ token: 'raw-session-token' });                       // fixed token
createClient({ tokens: diskSession({ path: '/srv/mizito/session.json' }) });
createClient({ tokens: passwordSession({ username: '09…', password: '…' }) }); // memory-only

// Or implement TokenProvider yourself:
//   { getToken(): string | Promise<string>, onAuthExpired?(): string | null | Promise<...> }
// On a 401/403 the transport calls onAuthExpired() once and retries with the fresh token.
```

### Errors

Every failure is a `MizitoApiError` with a `code` you can branch on:
`auth` (expired/invalid session) · `rate_limit` · `server` · `api` (the `{status,data,msg}`
envelope rejected the call) · `network` · `not_found`.

## Related packages

- [`@mohsp-99/mizito-mcp`](https://www.npmjs.com/package/@mohsp-99/mizito-mcp) — MCP
  server exposing these reads/writes to Claude Desktop / Claude Code.
- [mizito-bridge repo](https://github.com/mohsp-99/mizito-bridge) — the monorepo, incl.
  the browser login, workspace crawler, SQLite loader, and data viewer, plus the
  reverse-engineering notes (`docs/API_NOTES.md`, `docs/MIZITO_INTERNALS.md`).

## License

MIT
