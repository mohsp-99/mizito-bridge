// On-disk session store (auth/session.json + the Playwright storageState
// fallback). This is the Node-runtime default the diskSession provider and the
// CLI tools share; the transport itself never touches the filesystem — it only
// sees a TokenProvider.
import { SESSION_PATH, STORAGE_STATE_PATH, WEB_BASE } from '../config.js';
import { readJson, writeJson, exists, log } from '../util.js';
import type { SessionInfo } from '../types/index.js';

interface StorageState {
  origins?: Array<{
    origin?: string;
    localStorage?: Array<{ name: string; value: string }>;
  }>;
}

// Pull the auth token out of a Playwright storageState object.
// The SPA stores it in localStorage (and sessionStorage) under `token`
// for the office.mizito.ir origin.
export function tokenFromStorageState(storageState: StorageState | null | undefined): string | null {
  const origins = storageState?.origins ?? [];
  for (const o of origins) {
    if (!o.origin || !o.origin.includes('mizito.ir')) continue;
    const hit = (o.localStorage ?? []).find((kv) => kv.name === 'token');
    if (hit?.value) return hit.value;
  }
  return null;
}

// Persist the distilled session (just what the tools need).
export function saveSession(
  { token, user }: { token: string; user?: unknown },
  sessionPath: string = SESSION_PATH,
): SessionInfo {
  const session: SessionInfo = { token, user: user ?? null, savedAt: new Date().toISOString() };
  writeJson(sessionPath, session);
  return session;
}

// Load the token, preferring the distilled session.json, falling back to
// re-reading it out of storageState.json.
export function loadToken(sessionPath: string = SESSION_PATH): string | null {
  if (exists(sessionPath)) {
    const s = readJson<Partial<SessionInfo>>(sessionPath, {});
    if (s.token) return s.token;
  }
  if (exists(STORAGE_STATE_PATH)) {
    const token = tokenFromStorageState(readJson<StorageState>(STORAGE_STATE_PATH, {}));
    if (token) return token;
  }
  return null;
}

export function requireToken(): string {
  const token = loadToken();
  if (!token) {
    log.err('No saved session. Run `npm run login` first.');
    process.exit(1);
  }
  return token;
}

export { WEB_BASE };
