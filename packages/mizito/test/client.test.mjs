// The namespaced client and the createMizito back-compat facade.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, createMizito, staticToken, taskFromMessage, CHAT_PAGE_SIZE, API_BASE } from '@mohsp-99/mizito';

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

function captureFetch(responder) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const body = responder(String(url), seen.at(-1).body);
    return { status: 200, ok: true, text: async () => JSON.stringify(body) };
  };
  return seen;
}

test('client namespaces hit the confirmed endpoints', async () => {
  const seen = captureFetch(() => ({ status: 1, data: [] }));
  const c = createClient({ tokens: staticToken('t'), pacingMs: 0 });
  await c.tasks.getAll();
  await c.chat.getHistory('dlg-1', 30);
  await c.projects.getList();
  await c.workspaces.bootstrap();
  await c.letters.getInbox('outbox', 5);
  assert.deepEqual(
    seen.map((s) => s.url.replace(`${API_BASE}/api/`, '')),
    ['tasks/getAll', 'chat/getHistory', 'projects/getList', 'workspace/userId', 'inbox/getInbox'],
  );
  assert.deepEqual(seen[1].body, { dialog: 'dlg-1', offset: 30 });
  assert.deepEqual(seen[4].body, { mode: 'outbox', offset: 5 });
});

test('workspaces.switch returns a NEW client scoped by the switch token', async () => {
  captureFetch((url, body) => {
    if (url.endsWith('workspace/switch')) {
      assert.equal(body.workspace_id, 'ws-2');
      return { status: 0, token: 'scoped-token' }; // raw, non-envelope shape
    }
    return { status: 1, data: { uid: 'me' } };
  });
  const c = createClient({ tokens: staticToken('base'), pacingMs: 0 });
  const scoped = await c.workspaces.switch('ws-2');
  assert.notEqual(scoped, c);
  assert.equal(await scoped.currentToken(), 'scoped-token');
  assert.equal(await c.currentToken(), 'base'); // the base client is untouched
});

test('createMizito facade keeps the flat pre-TS surface working', async () => {
  const seen = captureFetch(() => ({ status: 1, data: { dialogs: [] } }));
  const mz = createMizito({ token: 't', pacingMs: 0 });
  // The methods the crawler scripts actually use:
  for (const m of ['bootstrap', 'switchWorkspace', 'workspaceName', 'planInfo', 'members', 'projects', 'projectSummaries', 'taskLabels', 'taskComments', 'dialogs', 'fullChat', 'fullHistory', 'dashboardSummary', 'workspacesUsers', 'allTasks', 'history']) {
    assert.equal(typeof mz[m], 'function', `createMizito().${m} missing`);
  }
  assert.equal(typeof mz.client.call, 'function');
  await mz.dialogs();
  assert.ok(seen[0].url.endsWith('chat/getDialogs'));
});

test('taskFromMessage extracts tasks from messageMediaTask messages only', () => {
  const task = { _id: 't1', title: 'x' };
  assert.deepEqual(taskFromMessage({ media: { _: 'messageMediaTask', task } }), task);
  assert.equal(taskFromMessage({ media: { _: 'messageMediaPhoto' } }), null);
  assert.equal(taskFromMessage({ message: 'plain' }), null);
  assert.equal(taskFromMessage(null), null);
});

test('CHAT_PAGE_SIZE stays pinned to the observed page size', () => {
  assert.equal(CHAT_PAGE_SIZE, 15);
});
