// Ready-made token providers, so consumers don't reinvent session handling:
//
//   staticToken(token)          — a fixed token (throwaway scripts, tests)
//   diskSession({path?, credentials?})
//                               — reads auth/session.json; if credentials are
//                                 configured (option, env, or the gitignored
//                                 auth/credentials.json), an expired session
//                                 heals itself via headless re-login
//   passwordSession(credentials) — pure headless: logs in on demand, keeps the
//                                 token in memory only
//
// The transport calls getToken() per request and onAuthExpired() once after a
// 401/403 — see transport/http.ts.
import { CREDENTIALS_PATH } from '../config.js';
import { readJson, exists } from '../util.js';
import { MizitoApiError } from '../transport/errors.js';
import { createSession } from './login.js';
import { loadToken, saveSession } from './session.js';
import type { TokenProvider } from './types.js';
import type { Credentials } from '../types/index.js';

// Read login credentials from the environment first, then the gitignored
// auth/credentials.json. Returns null if none are configured.
export function loadCredentials(): Credentials | null {
  const username = process.env.MIZITO_USERNAME || process.env.MIZITO_USER || null;
  const password = process.env.MIZITO_PASSWORD || process.env.MIZITO_PASS || null;
  if (username && password) {
    return {
      username,
      password,
      loginCode: process.env.MIZITO_LOGIN_CODE || '',
      regId: process.env.MIZITO_REG_ID || null,
    };
  }
  if (exists(CREDENTIALS_PATH)) {
    const c = readJson<Partial<Credentials>>(CREDENTIALS_PATH, {});
    if (c.username && c.password) {
      return {
        username: c.username,
        password: c.password,
        loginCode: c.loginCode || '',
        regId: c.regId ?? null,
      };
    }
  }
  return null;
}

export function hasCredentials(): boolean {
  return loadCredentials() != null;
}

// Convenience: log in using the stored credentials and save the session.
// Returns null if none are configured (caller decides whether that's fatal);
// throws if a login attempt is made and fails.
export async function reauthenticate(): Promise<{ token: string; status: number | boolean; user: unknown } | null> {
  const creds = loadCredentials();
  if (!creds) return null;
  return createSession(creds);
}

/** A fixed token — for throwaway scripts, tests, and workspace-scoped clients. */
export function staticToken(token: string): TokenProvider {
  if (!token) throw new Error('staticToken: no token (run `mizito login` or `mizito relogin`).');
  return {
    getToken: () => token,
    onAuthExpired: () => null,
  };
}

export interface DiskSessionOptions {
  /** Path of the session file (default: <data root>/auth/session.json). */
  path?: string;
  /** Login credentials for self-healing; default: env or auth/credentials.json. */
  credentials?: Credentials | null;
}

/**
 * The default provider: token from auth/session.json (with the Playwright
 * storageState fallback); on expiry, re-login headless with the configured
 * credentials and rewrite the session file. This is what makes a stale session
 * heal itself instead of erroring.
 */
export function diskSession({ path, credentials }: DiskSessionOptions = {}): TokenProvider {
  const login = async (): Promise<string | null> => {
    const creds = credentials ?? loadCredentials();
    if (!creds) return null;
    const { token, user } = await createSession({ ...creds, save: false });
    saveSession({ token, user }, path);
    return token;
  };

  return {
    async getToken() {
      const token = loadToken(path);
      if (token) return token;
      // No saved session at all — try to mint one if credentials exist.
      const fresh = await login();
      if (fresh) return fresh;
      throw new MizitoApiError(
        'No Mizito session found. Run `mizito login` to sign in, or set ' +
          'MIZITO_USERNAME/MIZITO_PASSWORD (or auth/credentials.json) for automatic login.',
        { code: 'auth' },
      );
    },
    async onAuthExpired() {
      const creds = credentials ?? loadCredentials();
      if (!creds) return null;
      // stderr on purpose: this fires inside long-lived stdio servers too.
      console.error('[mizito] session expired — re-authenticating with stored credentials…');
      return login();
    },
  };
}

/**
 * Pure headless sessions: log in with the given credentials on first use and
 * keep the token in memory only (nothing touches the disk).
 */
export function passwordSession(credentials: Credentials): TokenProvider {
  if (!credentials?.username || !credentials?.password) {
    throw new Error('passwordSession: username and password are required.');
  }
  let cached: string | null = null;

  const login = async (): Promise<string> => {
    const { token } = await createSession({ ...credentials, save: false });
    cached = token;
    return token;
  };

  return {
    async getToken() {
      return cached ?? login();
    },
    async onAuthExpired() {
      return login();
    },
  };
}
