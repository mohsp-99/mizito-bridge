// Token providers: staticToken, passwordSession (mocked login), and
// diskSession's read + self-heal-and-rewrite behavior against a temp dir.
//
// MIZITO_DATA_DIR is pointed at a scratch directory BEFORE the package is
// imported, so the config's default paths (and any storageState fallback)
// can never touch a real session on the developer's machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mizito-test-'));
process.env.MIZITO_DATA_DIR = scratch;
delete process.env.MIZITO_USERNAME;
delete process.env.MIZITO_PASSWORD;
delete process.env.MIZITO_USER;
delete process.env.MIZITO_PASS;

const { staticToken, diskSession, passwordSession, MizitoApiError, SESSION_CREATE_URL } =
  await import('@mohsp-99/mizito');

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

// Mock only the login endpoint; count the calls.
function mockLogin({ token = 'minted-token', status = 1 } = {}) {
  const calls = { count: 0, bodies: [] };
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), SESSION_CREATE_URL);
    calls.count++;
    calls.bodies.push(JSON.parse(init.body));
    return { status: 200, ok: true, text: async () => JSON.stringify({ status, token }) };
  };
  return calls;
}

test('staticToken: returns the token, never re-authenticates, rejects empty', async () => {
  const p = staticToken('abc');
  assert.equal(await p.getToken(), 'abc');
  assert.equal(await p.onAuthExpired(), null);
  assert.throws(() => staticToken(''));
});

test('diskSession: reads the token from the session file', async () => {
  const file = path.join(scratch, 'auth', 'session-read.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ token: 'from-disk' }));
  const p = diskSession({ path: file });
  assert.equal(await p.getToken(), 'from-disk');
});

test('diskSession: no session + no credentials → clear auth error', async () => {
  const p = diskSession({ path: path.join(scratch, 'auth', 'missing.json') });
  await assert.rejects(
    () => Promise.resolve(p.getToken()),
    (err) => err instanceof MizitoApiError && err.code === 'auth' && /mizito login/.test(err.message),
  );
});

test('diskSession: onAuthExpired logs in with credentials and rewrites the file', async () => {
  const file = path.join(scratch, 'auth', 'session-heal.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ token: 'stale' }));
  const calls = mockLogin({ token: 'healed-token' });

  const p = diskSession({ path: file, credentials: { username: '0912', password: 'pw' } });
  const fresh = await p.onAuthExpired();
  assert.equal(fresh, 'healed-token');
  assert.equal(calls.count, 1);
  // The password must go out hashed (md5|sha256), never in the clear.
  assert.match(calls.bodies[0].password, /^[0-9a-f]{32}\|[0-9a-f]{64}$/);
  // The session file was rewritten with the fresh token.
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, 'healed-token');
  // And getToken now serves it.
  assert.equal(await p.getToken(), 'healed-token');
});

test('diskSession: missing session + credentials → logs in on first getToken', async () => {
  const file = path.join(scratch, 'auth', 'session-first.json');
  const calls = mockLogin({ token: 'first-login' });
  const p = diskSession({ path: file, credentials: { username: '0912', password: 'pw' } });
  assert.equal(await p.getToken(), 'first-login');
  assert.equal(calls.count, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, 'first-login');
});

test('passwordSession: logs in once, caches in memory, re-logs on expiry, no disk', async () => {
  const calls = mockLogin({ token: 'mem-token' });
  const p = passwordSession({ username: '0912', password: 'pw' });
  assert.equal(await p.getToken(), 'mem-token');
  assert.equal(await p.getToken(), 'mem-token');
  assert.equal(calls.count, 1); // cached — one login for two getToken calls
  await p.onAuthExpired();
  assert.equal(calls.count, 2); // expiry forces a fresh login
  // Nothing was written under the scratch auth dir by passwordSession tests.
  const authDir = path.join(scratch, 'auth');
  const files = fs.existsSync(authDir) ? fs.readdirSync(authDir) : [];
  assert.ok(!files.includes('session.json'), 'passwordSession must not touch the default session file');
});
