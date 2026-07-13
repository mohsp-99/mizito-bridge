// Headless login: turn a phone number + password into a session token by
// replaying the SPA's own `POST /capi/session/create` call — no browser.
//
// Why this exists: Mizito session tokens expire every few days, and the
// browser-driven login (mizito-crawler's login script) needs a human at a
// Chromium window each time. With credentials on hand we can mint a fresh
// token on-demand, so tools self-heal when the saved session goes stale.
//
// SECURITY: automating login means holding a password-equivalent secret. Prefer
// the MIZITO_USERNAME / MIZITO_PASSWORD environment variables; the on-disk
// fallback (auth/credentials.json) lives in the gitignored auth/ dir. Never
// commit either.
import { SESSION_CREATE_URL, WEB_BASE } from '../config.js';
import { hashPassword } from './hash.js';
import { saveSession } from './session.js';
import type { Credentials } from '../types/index.js';

export interface CreateSessionOptions extends Credentials {
  /** Persist the token to auth/session.json (like the browser login). Default true. */
  save?: boolean;
}

export interface CreateSessionResult {
  token: string;
  status: number | boolean;
  user: unknown;
}

interface LoginResponse {
  status?: number | boolean;
  token?: string;
  user?: unknown;
  msg?: string;
  message?: string;
  data?: { token?: string; user?: unknown };
}

// Human-readable hint for a non-success login envelope. status codes observed:
//   0 -> wrong username/password, 7 -> a one-time code (OTP) is required.
function describeLoginFailure(json: LoginResponse | undefined): string {
  switch (json?.status) {
    case 0:
      return 'wrong username or password';
    case 7:
      return 'this login requires a one-time code (OTP); pass loginCode';
    default:
      return json?.msg || json?.message || '';
  }
}

// Log in with a username (phone) + password and return { token, status, user }.
// On success the token is saved to auth/session.json (like the browser login),
// unless `save: false`. `loginCode` is the SMS/OTP code — empty for a
// password-only account. `regId` is a push-registration id; null is accepted
// (the API treats it as "no push device").
export async function createSession({
  username,
  password,
  loginCode = '',
  regId = null,
  save = true,
}: CreateSessionOptions): Promise<CreateSessionResult> {
  if (!username || !password) {
    throw new Error('createSession: username and password are required.');
  }

  const res = await fetch(SESSION_CREATE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json;charset=UTF-8',
      accept: 'application/json, text/javascript, */*; q=0.01',
      origin: WEB_BASE,
      referer: `${WEB_BASE}/`,
    },
    body: JSON.stringify({ username, password: hashPassword(password), loginCode, regId }),
  });

  const text = await res.text();
  let json: LoginResponse;
  try {
    json = text ? (JSON.parse(text) as LoginResponse) : {};
  } catch {
    throw new Error(`Login failed: non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  // The SPA accepts status 1 or 5 (both carry a token); everything else is a
  // failed login. The token is at the top level of the response body.
  const ok = json.status === 1 || json.status === 5 || json.status === true;
  const token = json.token || json.data?.token || null;
  if (!ok || !token) {
    const hint = describeLoginFailure(json);
    throw new Error(`Mizito login failed (status ${json.status ?? '?'})${hint ? `: ${hint}` : ''}.`);
  }

  const user = json.user ?? json.data?.user ?? null;
  if (save) saveSession({ token, user });
  return { token, status: json.status ?? 1, user };
}
