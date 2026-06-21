// Session/token handling shared by all scripts.
import { SESSION_PATH, STORAGE_STATE_PATH, WEB_BASE } from './config.js';
import { readJson, writeJson, exists, log } from './util.js';

// Pull the auth token out of a Playwright storageState object.
// The SPA stores it in localStorage (and sessionStorage) under `token`
// for the office.mizito.ir origin.
export function tokenFromStorageState(storageState) {
  const origins = storageState?.origins ?? [];
  for (const o of origins) {
    if (!o.origin || !o.origin.includes('mizito.ir')) continue;
    const hit = (o.localStorage ?? []).find((kv) => kv.name === 'token');
    if (hit?.value) return hit.value;
  }
  return null;
}

// Persist the distilled session (just what the crawler needs).
export function saveSession({ token, user }) {
  const session = { token, user: user ?? null, savedAt: new Date().toISOString() };
  writeJson(SESSION_PATH, session);
  return session;
}

// Load the token, preferring the distilled session.json, falling back to
// re-reading it out of storageState.json.
export function loadToken() {
  if (exists(SESSION_PATH)) {
    const s = readJson(SESSION_PATH, {});
    if (s.token) return s.token;
  }
  if (exists(STORAGE_STATE_PATH)) {
    const token = tokenFromStorageState(readJson(STORAGE_STATE_PATH, {}));
    if (token) return token;
  }
  return null;
}

export function requireToken() {
  const token = loadToken();
  if (!token) {
    log.err('No saved session. Run `npm run login` first.');
    process.exit(1);
  }
  return token;
}

export { WEB_BASE };
