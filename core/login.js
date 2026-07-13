// Headless login: turn a phone number + password into a session token by
// replaying the SPA's own `POST /capi/session/create` call — no browser.
//
// Why this exists: Mizito session tokens expire every few days, and the
// browser-driven login (apps/crawler/login.mjs) needs a human at a Chromium
// window each time. With credentials on hand we can mint a fresh token
// on-demand, so tools self-heal when the saved session goes stale.
//
// How the password is sent (recovered from the app bundle, v1.0.4-589):
//   password field = md5(password) + "|" + sha256(password)   (both lowercase hex)
// from the bundle's `i.createHash(a)+"|"+r.convertToSHA256(a)`. Those two hashes
// are the `gdi2290.md5-service` `createHash` and the `sha256` factory's
// `convertToSHA256`; both were verified byte-for-byte equal to Node's
// crypto hex digests across several test vectors. AD/SSO tenants send the raw
// password instead — not supported here (use the browser login for those).
//
// SECURITY: automating login means holding a password-equivalent secret. Prefer
// the MIZITO_USERNAME / MIZITO_PASSWORD environment variables; the on-disk
// fallback (auth/credentials.json) lives in the gitignored auth/ dir. Never
// commit either.
import crypto from 'node:crypto';
import {
  SESSION_CREATE_URL,
  CREDENTIALS_PATH,
  WEB_BASE,
} from './config.js';
import { saveSession } from './auth.js';
import { readJson, exists } from './util.js';

// The exact client-side hash the SPA sends for a normal (non-AD/SSO) login.
export function hashPassword(password) {
  const md5 = crypto.createHash('md5').update(password, 'utf8').digest('hex');
  const sha256 = crypto.createHash('sha256').update(password, 'utf8').digest('hex');
  return `${md5}|${sha256}`;
}

// Human-readable hint for a non-success login envelope. status codes observed:
//   0 -> wrong username/password, 7 -> a one-time code (OTP) is required.
function describeLoginFailure(json) {
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
} = {}) {
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
  let json;
  try {
    json = text ? JSON.parse(text) : {};
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
  return { token, status: json.status, user };
}

// Read login credentials from the environment first, then the gitignored
// auth/credentials.json. Returns null if none are configured.
export function loadCredentials() {
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
    const c = readJson(CREDENTIALS_PATH, {});
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

export function hasCredentials() {
  return loadCredentials() != null;
}

// Convenience: log in using the stored credentials. Returns null if none are
// configured (caller decides whether that's fatal); throws if a login attempt
// is made and fails.
export async function reauthenticate() {
  const creds = loadCredentials();
  if (!creds) return null;
  return createSession(creds);
}
