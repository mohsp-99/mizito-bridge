// Central configuration for the Mizito client library.
// Values were derived by inspecting the office.mizito.ir SPA bundle:
//   - the web app is served from office.mizito.ir (hash-routed SPA)
//   - it talks to Config.App.api_url === https://app.mizito.ir
//   - data calls hit `${api_url}/api/...` (only login uses /capi/)
//   - auth is a per-session token sent as the `x-token` request header,
//     stored by the SPA in localStorage/sessionStorage under `token`.

import path from 'node:path';

// Runtime data root. The library must not anchor data to its own install
// location (it may sit inside node_modules); the consumer's working directory
// — or an explicit MIZITO_DATA_DIR — decides where auth/, data/, db/,
// downloads/ live. Run tools from the repo root, or set MIZITO_DATA_DIR.
export const ROOT = path.resolve(process.env.MIZITO_DATA_DIR || process.cwd());

export const WEB_BASE = 'https://office.mizito.ir';
export const WEB_LOGIN_URL = `${WEB_BASE}/#/lg/login`;

export const API_BASE = 'https://app.mizito.ir';
// Data endpoints live under /api/...; only the login call uses /capi/.
export const API_PREFIX = '/api';
export const LOGIN_PREFIX = '/capi';

// Headless login endpoint (password -> session token). See auth/login.ts.
export const SESSION_CREATE_URL = `${API_BASE}${LOGIN_PREFIX}/session/create`;

// Attachments are served from this CDN path, addressed by a content token
// (JWT) and authenticated with the same x-token header as the API.
export const CDN_BASE = `${API_BASE}/cdn/`;

// File uploads go here as multipart/form-data (field `upload`), authenticated
// with the same x-token header. From the bundle: `Config.App.api_url +
// "/api/content/upload"`. See resources/content.ts.
export const UPLOAD_URL = `${API_BASE}${API_PREFIX}/content/upload`;

// Header the SPA uses to authenticate every data call.
export const TOKEN_HEADER = 'x-token';

// On-disk layout (defaults; all hang off ROOT above).
export const AUTH_DIR = path.join(ROOT, 'auth');
export const DATA_DIR = path.join(ROOT, 'data');
export const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'storageState.json');
export const SESSION_PATH = path.join(AUTH_DIR, 'session.json'); // { token, savedAt, user? }
// Optional stored credentials for headless / automatic re-login. Gitignored
// (the whole auth/ dir is). Env vars take precedence — see auth/providers.ts.
export const CREDENTIALS_PATH = path.join(AUTH_DIR, 'credentials.json'); // { username, password }

// Default workspace to crawl. Set the WORKSPACE env var (or pass a name on the
// CLI) to pick one; when empty, the crawler uses the account's active workspace.
export const TARGET_WORKSPACE = process.env.WORKSPACE || '';
