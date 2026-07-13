// Transport behavior against a mocked fetch: URL building, envelope unwrap,
// the error-code taxonomy, transient retries, and the refresh-on-401 flow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttp, staticToken, MizitoApiError, codeForHttpStatus, API_BASE } from '@mohsp-99/mizito-core';

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

// A fetch mock fed by a queue of responses (or Error instances to throw).
function mockFetch(queue, seen = []) {
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    const next = queue.shift();
    if (!next) throw new Error('mockFetch: queue exhausted');
    if (next instanceof Error) throw next;
    const { status = 200, body = {} } = next;
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
  return seen;
}

const http = () => createHttp({ tokens: staticToken('tok-1'), pacingMs: 0 });

test('resolve: endpoint forms map to the /api base', () => {
  const { resolve } = http();
  assert.equal(resolve('session/whoami'), `${API_BASE}/api/session/whoami`);
  assert.equal(resolve('/tasks/getAll'), `${API_BASE}/api/tasks/getAll`);
  assert.equal(resolve('/api/tasks/getAll'), `${API_BASE}/api/tasks/getAll`);
  assert.equal(resolve('https://example.com/x'), 'https://example.com/x');
});

test('call: unwraps the {status:1,data} envelope and sends the token header', async () => {
  const seen = mockFetch([{ body: { status: 1, data: { hello: 'world' } } }]);
  const out = await http().call('some/endpoint', { a: 1 });
  assert.deepEqual(out, { hello: 'world' });
  assert.equal(seen[0].url, `${API_BASE}/api/some/endpoint`);
  assert.equal(seen[0].init.headers['x-token'], 'tok-1');
  assert.equal(JSON.parse(seen[0].init.body).a, 1);
});

test('call: envelope rejection throws code "api" with the envelope attached', async () => {
  mockFetch([{ body: { status: 0, msg: 'nope' } }]);
  await assert.rejects(
    () => http().call('bad/endpoint'),
    (err) => {
      assert.ok(err instanceof MizitoApiError);
      assert.equal(err.code, 'api');
      assert.equal(err.status, 0);
      assert.equal(err.endpoint, 'bad/endpoint');
      return true;
    },
  );
});

test('call: raw responses skip envelope unwrapping', async () => {
  mockFetch([{ body: { status: 0, token: 'scoped' } }]);
  const out = await http().call('workspace/switch', {}, { raw: true });
  assert.deepEqual(out, { status: 0, token: 'scoped' });
});

test('call: 401 asks the provider once, then retries with the fresh token', async () => {
  let healed = 0;
  const tokens = {
    getToken: () => (healed ? 'tok-fresh' : 'tok-stale'),
    onAuthExpired: () => {
      healed++;
      return 'tok-fresh';
    },
  };
  const seen = mockFetch([
    { status: 401, body: '<html>expired</html>' },
    { body: { status: 1, data: { ok: true } } },
  ]);
  const out = await createHttp({ tokens, pacingMs: 0 }).call('workspace/userId');
  assert.deepEqual(out, { ok: true });
  assert.equal(healed, 1);
  assert.equal(seen[0].init.headers['x-token'], 'tok-stale');
  assert.equal(seen[1].init.headers['x-token'], 'tok-fresh');
});

test('call: 401 with no re-auth available throws code "auth" without retrying', async () => {
  const seen = mockFetch([{ status: 401, body: '<html>expired</html>' }]);
  await assert.rejects(
    () => http().call('workspace/userId'),
    (err) => err instanceof MizitoApiError && err.code === 'auth' && err.httpStatus === 401,
  );
  assert.equal(seen.length, 1); // auth errors are not retried as transient
});

test('call: 401 heal happens at most once per call', async () => {
  let heals = 0;
  const tokens = { getToken: () => 'tok', onAuthExpired: () => { heals++; return 'tok'; } };
  mockFetch([
    { status: 401, body: 'x' },
    { status: 401, body: 'x' },
  ]);
  await assert.rejects(
    () => createHttp({ tokens, pacingMs: 0 }).call('e'),
    (err) => err instanceof MizitoApiError && err.code === 'auth',
  );
  assert.equal(heals, 1);
});

test('call: 429 is rate_limit and retried until it succeeds', async () => {
  mockFetch([
    { status: 429, body: {} },
    { body: { status: 1, data: 'fine' } },
  ]);
  const out = await http().call('paced/endpoint');
  assert.equal(out, 'fine');
});

test('call: 5xx is code "server"; network throw becomes code "network"', async () => {
  mockFetch([
    { status: 503, body: {} },
    { body: { status: 1, data: 1 } },
  ]);
  assert.equal(await http().call('flaky'), 1);

  mockFetch([
    new Error('socket hang up'),
    { body: { status: 1, data: 2 } },
  ]);
  assert.equal(await http().call('netflaky'), 2);
});

test('codeForHttpStatus mapping', () => {
  assert.equal(codeForHttpStatus(401), 'auth');
  assert.equal(codeForHttpStatus(403), 'auth');
  assert.equal(codeForHttpStatus(429), 'rate_limit');
  assert.equal(codeForHttpStatus(500), 'server');
  assert.equal(codeForHttpStatus(200), null);
});
