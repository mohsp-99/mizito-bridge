// Central configuration for the Mizito crawler.
// Values were derived by inspecting the office.mizito.ir SPA bundle:
//   - the web app is served from office.mizito.ir (hash-routed SPA)
//   - it talks to Config.App.api_url === https://app.mizito.ir
//   - all data calls hit `${api_url}/capi/...`
//   - auth is a per-session token sent as the `x-token` request header,
//     stored by the SPA in localStorage/sessionStorage under `token`.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

export const WEB_BASE = 'https://office.mizito.ir';
export const WEB_LOGIN_URL = `${WEB_BASE}/#/lg/login`;

export const API_BASE = 'https://app.mizito.ir';
// Data endpoints live under /api/...; only the login call uses /capi/.
export const API_PREFIX = '/api';
export const LOGIN_PREFIX = '/capi';

// Header the SPA uses to authenticate every /capi call.
export const TOKEN_HEADER = 'x-token';

// On-disk layout.
export const AUTH_DIR = path.join(ROOT, 'auth');
export const DATA_DIR = path.join(ROOT, 'data');
export const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'storageState.json');
export const SESSION_PATH = path.join(AUTH_DIR, 'session.json'); // { token, savedAt, user? }

// Default workspace to crawl. Set the WORKSPACE env var (or pass a name on the
// CLI) to pick one; when empty, the crawler uses the account's active workspace.
export const TARGET_WORKSPACE = process.env.WORKSPACE || '';
