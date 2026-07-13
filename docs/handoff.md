# Mizito — Monorepo + TypeScript migration (implementation plan / handoff)

**Status:** planned, not started · **Date:** 2026-07-13 · **Owner:** mohsp-99

This document is the handoff for restructuring this repo from a single package into a
**workspaces monorepo** with a **TypeScript core library** plus two consumers (crawler, MCP
server). It is written so a fresh contributor (or a new Claude Code session) can execute it
without re-deriving the decisions. Read it top to bottom once before touching anything.

---

## 1. Context & goal

The repo began as a spike to crawl and present Mizito (`office.mizito.ir`) data, then grew an
MCP server for AI tools. Today it is one npm package (`@mohsp-99/mizito-bridge`) where
`core/` is a de-facto library and `apps/` are consumers — good instincts, informal boundary.

**Goal:** turn `core/` into a first-class **shared API library** that exposes Mizito's API
calls and progresses toward covering *all* of Mizito's features. The crawler and the MCP
server become thin consumers built on top of it. A developer should be able to `npm install`
the core and call the API directly (e.g. from a Claude Code script) **without hosting a
server or pulling in a browser**.

**Why now:** decoupling the API from its consumers is the change that makes everything later
(more features, more consumers, tests, publishing) tractable. The concrete pain today: the
core cannot be used standalone because the single package hard-depends on `playwright` (with
a Chromium `postinstall`) and the MCP SDK.

---

## 2. Decisions

**Locked (agreed with owner):**

| Decision | Choice | Reason |
| --- | --- | --- |
| Repo shape | **Workspaces monorepo** (3 packages) | Separates dependency sets; core stays browser/SDK-free |
| Package manager | **npm workspaces** | Already on npm; zero new tooling; fine on Windows |
| Core language | **TypeScript** (ship compiled JS + `.d.ts`) | The library's value *is* its API surface; types are the biggest leverage for a reverse-engineered API |
| Core client shape | **Resource namespaces** (`client.tasks.*`, `client.chat.*`, …) | Scales to "all of Mizito"; standard SDK convention |
| Token handling | **Injectable token provider** (`getToken` / `onAuthExpired`) | Core must not assume filesystem/env; this is what enables direct, un-hosted use |
| Pace | **Incremental**, 3 checkpoints, each leaves a working repo | Avoids a big-bang rewrite; always a fallback point |
| Build tool | **tsup** (esbuild) for core → ESM + `.d.ts` | One-line config; fast |
| Tests | **`node:test`** (built-in) | No framework needed |

**Open questions (decide before/at Increment 2):**

1. **Core package name** — recommended `@mohsp-99/mizito`; alternative: keep the
   `mizito-bridge` name for the meta/MCP package. *(Owner to confirm.)*
2. **TS-ify the consumers too**, or leave crawler/mcp as JS importing the typed core?
   Recommended: convert MCP to TS (it benefits from the types); leave crawler JS initially.
3. **zod response validation** in core now, or later? Recommended: later (Increment 3+),
   opt-in per endpoint, to avoid slowing the initial migration.
4. **Publishing** — which packages go public on npm? Recommended: `@mohsp-99/mizito` (core)
   and `@mohsp-99/mizito-mcp`; keep crawler private/unpublished unless there's demand.

---

## 3. Target architecture

```
mizito/                              # repo root — private, not published
├─ package.json                      # { "private": true, "workspaces": ["packages/*"] }
├─ tsconfig.base.json                # shared strict TS config
├─ docs/                             # API_NOTES.md, MIZITO_INTERNALS.md, handoff.md (stay here)
├─ auth/  data/  db/  downloads/     # runtime output — gitignored, at repo root (see §8)
└─ packages/
   ├─ mizito/                        # @mohsp-99/mizito — CORE library (TypeScript)
   │  ├─ src/
   │  │  ├─ index.ts                 # public surface (barrel)
   │  │  ├─ client.ts                # createClient({ tokens, pacing }) → resource namespaces
   │  │  ├─ config.ts                # base URLs, header names, endpoint constants
   │  │  ├─ transport/
   │  │  │  ├─ http.ts               # fetch wrapper: envelope unwrap, retries, pacing
   │  │  │  └─ errors.ts             # MizitoApiError + error codes
   │  │  ├─ auth/
   │  │  │  ├─ hash.ts               # md5|sha256 password hashing (verified)
   │  │  │  ├─ login.ts              # createSession (headless password login)
   │  │  │  ├─ providers.ts          # staticToken / diskSession / passwordSession
   │  │  │  └─ types.ts              # TokenProvider interface
   │  │  ├─ resources/               # thin 1:1 endpoint wrappers, grouped by resource
   │  │  │  ├─ tasks.ts   chat.ts   projects.ts
   │  │  │  ├─ letters.ts workspace.ts labels.ts dashboard.ts files.ts
   │  │  ├─ feeds/                   # normalized cross-workspace views (today's feed.js)
   │  │  │  └─ index.ts              # buildContext, myTasks, overview, unreadMessages
   │  │  └─ types/                   # Task, Message, Dialog, Letter, Workspace, envelopes
   │  ├─ tsup.config.ts
   │  ├─ tsconfig.json
   │  └─ package.json                # deps: none (fetch+crypto built-in). zod optional later.
   │
   ├─ mizito-crawler/                # @mohsp-99/mizito-crawler — depends on core
   │  ├─ src/
   │  │  ├─ browser-login.mjs        # playwright login (today's apps/crawler/login.mjs)
   │  │  ├─ crawl.mjs discover.mjs capture-project.mjs download-files.mjs
   │  │  ├─ load-db.mjs              # node:sqlite loader
   │  │  ├─ extract-api-surface.mjs  probe.mjs api.mjs projects.mjs write-probe.mjs
   │  │  └─ viewer/server.mjs        # local data browser (today's apps/viewer)
   │  └─ package.json                # deps: @mohsp-99/mizito (workspace), playwright
   │
   └─ mizito-mcp/                    # @mohsp-99/mizito-mcp — depends on core
      ├─ src/index.ts                # MCP server (today's apps/mcp/index.mjs)
      ├─ bin/mizito-mcp.mjs          # stdio entry
      └─ package.json                # deps: @mohsp-99/mizito (workspace), @modelcontextprotocol/sdk, zod
```

The root `bin/mizito.mjs` dispatcher stays at the root (or moves to the crawler package) as a
convenience CLI over the workspace scripts; it is not part of the published core.

---

## 4. Core library design

### 4.1 The client

```ts
import { createClient, diskSession } from "@mohsp-99/mizito";

const client = createClient({
  tokens: diskSession(),          // where the token comes from + how to refresh (see 4.2)
  pacingMs: 200,                  // optional politeness delay between calls
});

await client.tasks.add({ title: "Ship it", project });   // typed payload → Promise<Task>
await client.chat.send({ dialog, message });
const scoped = await client.workspaces.switch(id);        // client scoped to another workspace
```

- `createClient` mounts resource namespaces over the transport. Namespaces map 1:1 to
  today's methods in `core/mizito.js`, just grouped: `tasks`, `chat`, `projects`, `labels`,
  `workspaces`, `letters`, `dashboard`, `files`.
- `client.workspaces.switch(id)` returns a **new client** (or scoped token) — encapsulating
  today's `feed.js` `clientForWorkspace` / `tokenFromSwitch` logic. The user's active
  workspace is never changed (see `docs/MIZITO_INTERNALS.md` §4).

### 4.2 Token provider (the key decoupling)

Core never reads the filesystem or env directly. It receives a provider:

```ts
interface TokenProvider {
  getToken(): string | Promise<string>;                    // current session token
  onAuthExpired?(): string | null | Promise<string | null>; // mint a fresh one, or null if can't
}
```

The transport calls `getToken()` for the `x-token` header, and on a `401/403` calls
`onAuthExpired()` once; if it returns a new token, the request is retried, otherwise the
auth error propagates. Core ships three ready-made providers so consumers don't reinvent
them:

- `staticToken(token)` — a fixed token (throwaway scripts, tests).
- `diskSession({ path?, credentials? })` — reads `auth/session.json`; if `credentials`
  (or env `MIZITO_USERNAME`/`MIZITO_PASSWORD`) are present, `onAuthExpired` runs the headless
  login and rewrites the session file. **This replaces today's `feed.js` auto-relogin.**
- `passwordSession(credentials)` — pure headless: logs in on demand, keeps the token in
  memory (no disk).

> Migration note: today's `core/auth.js` (`loadToken`/`saveSession`) and `core/login.js`
> (`createSession`/`reauthenticate`) become the guts of `diskSession`/`passwordSession`.
> The verified hashing (`hashPassword`) moves to `auth/hash.ts` unchanged.

### 4.3 Error taxonomy

Replace the bare `MizitoApiError` with a `code` so consumers branch without sniffing HTTP
status:

```ts
type MizitoErrorCode = "auth" | "rate_limit" | "server" | "api" | "network" | "not_found";
class MizitoApiError extends Error {
  code: MizitoErrorCode; httpStatus?: number; status?: number; endpoint?: string; body?: unknown;
}
```

Map: `401/403 → auth` (already special-cased in `core/http.js` — **keep that fix**),
`429 → rate_limit`, `>=500 → server`, envelope `status !== 1 → api`, fetch throw `→ network`.

---

## 5. Current → target file mapping

| Today | Goes to | Notes |
| --- | --- | --- |
| `core/config.js` | `packages/mizito/src/config.ts` | Strip on-disk path constants (see §8); keep URL/header/endpoint constants |
| `core/http.js` | `packages/mizito/src/transport/http.ts` | Keep the 401/403 throw; add error `code` mapping |
| `core/auth.js` | `packages/mizito/src/auth/providers.ts` (`diskSession`) | Token read/save becomes a provider impl |
| `core/login.js` | `packages/mizito/src/auth/{login,hash,providers}.ts` | `hashPassword`→hash.ts; `createSession`→login.ts; `loadCredentials`→provider |
| `core/mizito.js` | `packages/mizito/src/resources/*.ts` | Split the flat object into per-resource modules |
| `core/write.js` | `packages/mizito/src/feeds/` or resources | Name-resolving helpers; keep as a domain layer over resources |
| `core/feed.js` | `packages/mizito/src/feeds/index.ts` | `buildContext` uses the injected provider, not disk/env |
| `core/letters.js` | `packages/mizito/src/feeds/letters.ts` | Normalized letter views |
| `core/conversations.js` | `packages/mizito/src/feeds/conversations.ts` | Normalized chat views |
| `core/files.js` | `packages/mizito/src/resources/files.ts` | CDN download helper |
| `core/util.js` | `packages/mizito/src/util.ts` (+ split) | `log` is Node-only; keep `stripHtml`/`slug` pure |
| `apps/crawler/login.mjs` | `packages/mizito-crawler/src/browser-login.mjs` | The only playwright consumer |
| `apps/crawler/*` | `packages/mizito-crawler/src/*` | Import `@mohsp-99/mizito` instead of `../../core/...` |
| `apps/viewer/*` | `packages/mizito-crawler/src/viewer/*` | Or its own package if it grows |
| `apps/mcp/index.mjs` | `packages/mizito-mcp/src/index.ts` | Import the typed core |
| `apps/crawler/relogin.mjs` | `packages/mizito-crawler/src/relogin.mjs` **or** core bin | Only needs core; a thin CLI |
| `bin/mizito.mjs` | root `bin/` (unchanged) | Dispatcher over workspace scripts |
| `index.js` | becomes `packages/mizito/src/index.ts` | Public barrel of the core |
| `docs/*` | unchanged | Keep the reverse-engineering notes at repo root |

---

## 6. Migration plan — three increments

Each increment is independently shippable and must leave the repo working. Commit at each
checkpoint. Use `git mv` so history follows the files.

### Increment 1 — Monorepo skeleton + mechanical relocation (still JS)

**Goal:** the structure is real and everything runs; **no logic changes**.

1. Root `package.json`: set `"private": true`, add `"workspaces": ["packages/*"]`, remove the
   `playwright` Chromium `postinstall` from here.
2. Create `packages/mizito`, `packages/mizito-crawler`, `packages/mizito-mcp`, each with a
   minimal `package.json` (name, type: module, main/exports). Core stays `.js` for now with
   an `index.js` barrel identical to today's root `index.js`.
3. `git mv core/* packages/mizito/` (keep filenames). Update the intra-core relative imports
   (they stay relative, so mostly unchanged).
4. `git mv apps/crawler/* packages/mizito-crawler/src/`, `apps/viewer/* → .../viewer/`,
   `apps/mcp/index.mjs → packages/mizito-mcp/src/`. Rewrite their imports from
   `../../core/x.js` to `@mohsp-99/mizito` (resolves via the workspace symlink).
5. Per-package deps: crawler gets `playwright` (+ its own Chromium `postinstall`) and
   `@mohsp-99/mizito`; mcp gets `@modelcontextprotocol/sdk`, `zod`, `@mohsp-99/mizito`; core
   gets none. Root keeps only dev tooling.
6. Fix on-disk path resolution (see §8) — this is the one non-mechanical change here.
7. `npm install` at root (links workspaces).

**Acceptance:** `npm run relogin` mints a token; `node packages/mizito-mcp/src/index.ts`
(the MCP server) starts and lists tools on stderr; a crawl writes to `data/`; the viewer
serves. No behavior changed.

### Increment 2 — TypeScript-ify the core

**Goal:** core is TS with the target public shape; consumers still work (now typed).

1. Add `tsconfig.base.json` (strict, `target: ES2022`, `module: NodeNext`/`ESNext`,
   `moduleResolution: Bundler` or `NodeNext`, `declaration: true`). Each package extends it.
2. Add `tsup.config.ts` to core (`entry: src/index.ts`, `format: ["esm"]`, `dts: true`,
   `clean: true`); `build`/`dev` scripts. Point core `package.json` `exports`/`types` at
   `dist/`.
3. Convert core `.js → .ts` file by file; add the `types/` (Task, Message, Dialog, Letter,
   Workspace, `{status,data,msg}` envelope). Start from the shapes documented in
   `docs/API_NOTES.md`.
4. Split `mizito.js` into `resources/*.ts` and mount them as namespaces in `client.ts`.
5. Introduce the `TokenProvider` interface + `staticToken`/`diskSession`/`passwordSession`;
   refactor `feeds/index.ts` `buildContext` to consume the provider instead of reading
   disk/env. Verify the auto-relogin still fires on a 401 via `diskSession.onAuthExpired`.
6. Add the error `code` taxonomy in `transport/errors.ts`.
7. Build core; update consumers to import the built package (types flow through).

**Acceptance:** `tsc --noEmit` clean; `tsup` emits `dist` + `.d.ts`; the MCP server and
crawler run against the built core; a bad/expired token still auto-heals when credentials
are configured; `@mohsp-99/mizito` used from a scratch script gives autocomplete.

### Increment 3 — Thin the consumers + tests

**Goal:** dependency hygiene and a safety net.

1. Confirm each heavy dep lives only in its package (core `dependencies` is empty or just
   `zod` if adopted). A plain `npm install @mohsp-99/mizito` pulls **no** Chromium/SDK.
2. Optionally convert `mizito-mcp` to TS.
3. Add `node:test` suites in core: `hash` (against known vectors — reuse the verification we
   already did), envelope unwrap, error-code mapping, token-provider refresh-on-401, resource
   URL building (dot→slash), `stripHtml`. Gate live integration tests behind an env flag +
   test account (extend today's `write-probe`).
4. CI: `npm -ws run build && npm -ws test` (add a workflow if desired).

**Acceptance:** `npm -ws test` green; installing core alone is browser/SDK-free; docs updated.

---

## 7. Tooling sketches

**Root `package.json`:**
```jsonc
{
  "private": true,
  "workspaces": ["packages/*"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "npm -ws --if-present run build",
    "test": "npm -ws --if-present run test",
    "mcp": "npm -w @mohsp-99/mizito-mcp run start",
    "relogin": "node packages/mizito-crawler/src/relogin.mjs"
  },
  "devDependencies": { "tsup": "^8", "typescript": "^5" }
}
```

**`tsconfig.base.json`:**
```jsonc
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "declaration": true, "sourceMap": true,
    "esModuleInterop": true, "skipLibCheck": true, "verbatimModuleSyntax": true
  }
}
```

**Core `package.json`:**
```jsonc
{
  "name": "@mohsp-99/mizito", "version": "0.1.0", "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": { "build": "tsup", "test": "node --test", "dev": "tsup --watch" },
  "dependencies": {}
}
```

---

## 8. Cross-cutting gotchas

- **On-disk paths must decouple from module location.** Today `core/config.js` computes
  `ROOT = path.resolve(__dirname, "..")` and hangs `auth/`, `data/`, `db/` off it. After the
  move, `__dirname` points inside `packages/mizito/…`, so those paths break. Fix: resolve
  runtime dirs from `process.cwd()` or an explicit `MIZITO_DATA_DIR`/config option — **not**
  from the module path. This also aligns with the injectable-provider goal (the library
  shouldn't own where your data lives; the consumer tells it).
- **MCP stdio purity.** `packages/mizito-mcp` must never write to stdout (JSON-RPC owns it) —
  diagnostics go to stderr. Core's `feeds` layer must not `console.log` either (today's
  `feed.js` correctly uses `console.error` for the re-auth notice — preserve that; `util.js`
  `log.info/ok` write to stdout, so keep them out of any code path the MCP server hits).
- **`node:sqlite` is experimental** — the DB loader runs with `--no-warnings` today; keep
  that flag in the crawler package's script.
- **Chromium download** belongs to the crawler package's `postinstall` only. Core installs
  must stay fast and browserless.
- **ESM everywhere.** The repo is `"type": "module"`; keep it. Under `NodeNext`, relative TS
  imports need explicit `.js` extensions in source — configure lint/editor accordingly, or
  use `moduleResolution: Bundler` with tsup.
- **Reverse-engineered = version-pinned.** Endpoints/shapes track app bundle `1.0.4-589`. Do
  not "clean up" endpoint strings or payloads during the move; relocate them verbatim.

---

## 9. What must be preserved (do not regress)

- **The verified password hashing** (`md5_hex(pw)|sha256_hex(pw)`, lowercase hex) and the
  headless-login flow — see `docs/MIZITO_INTERNALS.md` §2. Keep the test vectors.
- **The 401/403 typed-error fix** in `core/http.js` — the whole auto-relogin depends on it;
  without it an expired token silently returns junk.
- **Automatic re-login** behavior (currently in `feed.js` `buildContext`) — must survive the
  move into `diskSession.onAuthExpired`.
- **The reverse-engineering docs** (`API_NOTES.md`, `MIZITO_INTERNALS.md`) — the project's
  hard-won knowledge; update the code paths they reference but keep the facts.
- **`write-probe`** as the live end-to-end write test — carry it into the crawler package.
- Browser login as the fallback for first-time / OTP / SSO accounts.

---

## 10. Testing strategy

| Layer | How |
| --- | --- |
| Pure units (no network) | `node:test`: hashing, envelope unwrap, error-code mapping, URL building (dot→slash), `stripHtml`, token-provider refresh logic (mock transport) |
| Live reads | Behind `MIZITO_TEST=1` + a test session: bootstrap, `projects/getList`, a `chat/getHistory` page |
| Live writes | The existing `write-probe` flow (create → comment → progress → delete), carried over |
| Types | `tsc --noEmit` in CI; a `examples/` script that imports the built package |

---

## 11. Execution checklist

- [ ] Confirm core package name (`@mohsp-99/mizito`?)
- [ ] **Increment 1:** workspaces + relocation, paths fixed, all apps run (JS)
- [ ] Commit checkpoint 1
- [ ] **Increment 2:** core → TS, resource namespaces, token provider, error codes, tsup build
- [ ] Commit checkpoint 2
- [ ] **Increment 3:** dep hygiene, `node:test` suites, CI, docs refresh
- [ ] Commit checkpoint 3
- [ ] Decide publishing (which packages public) and cut versions

---

## Appendix — reference

- Reverse-engineering facts: [`docs/API_NOTES.md`](./API_NOTES.md)
- Platform internals & extraction method: [`docs/MIZITO_INTERNALS.md`](./MIZITO_INTERNALS.md)
- Current programmatic surface: `index.js` (becomes the core barrel)
- Current CLI: `bin/mizito.mjs` (`login`, `relogin`, `mcp`, `crawl`, `files`, `db`, `view`, …)
