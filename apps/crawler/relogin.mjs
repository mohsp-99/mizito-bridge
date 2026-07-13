// Headless (password) login — mint a fresh session token without a browser.
//
//   npm run relogin
//   mizito relogin [--code <otp>]
//
// Reads credentials from the environment (MIZITO_USERNAME / MIZITO_PASSWORD) or,
// failing that, the gitignored auth/credentials.json ({ "username", "password" }).
// Saves the new token to auth/session.json — the same place the browser login
// and the API client use. Use this to sign in the first time on a headless box,
// or to refresh an expired session on demand.
//
// If your account ever asks for a one-time code, pass it with `--code 123456`.
import { createSession, loadCredentials } from '../../core/login.js';
import { SESSION_PATH } from '../../core/config.js';
import { log } from '../../core/util.js';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const creds = loadCredentials();
  if (!creds) {
    log.err(
      'No credentials found. Set MIZITO_USERNAME and MIZITO_PASSWORD, or create ' +
        'auth/credentials.json with {"username":"09…","password":"…"}.',
    );
    process.exit(1);
  }

  const loginCode = argValue('--code');
  const { token, status } = await createSession({
    ...creds,
    ...(loginCode ? { loginCode } : {}),
  });

  log.ok(`Logged in (status ${status}). Session saved -> ${SESSION_PATH}`);
  log.info(`token: ${token.slice(0, 24)}…`);
}

main().catch((err) => {
  log.err(err.message || String(err));
  process.exit(1);
});
