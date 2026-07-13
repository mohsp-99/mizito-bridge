// URL + payload construction for the newly-wrapped endpoints. Confirms each
// wrapper hits the right /api path with the exact payload keys recovered from
// the bundle (dot->slash, token/id naming, etc.). Fetch is mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, staticToken, API_BASE } from '@mohsp-99/mizito-core';

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

function capture(responder = () => ({ status: 1, data: {} })) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ path: String(url).replace(`${API_BASE}/api/`, ''), body: init.body ? JSON.parse(init.body) : null });
    return { status: 200, ok: true, text: async () => JSON.stringify(responder()) };
  };
  return seen;
}

const client = () => createClient({ tokens: staticToken('t'), pacingMs: 0 });

test('tasks: new endpoints use access_token/id naming verbatim', async () => {
  const seen = capture();
  const c = client();
  await c.tasks.snooze('atk', 'p1', '2026-08-01T00:00:00Z');
  await c.tasks.updateDeadline('atk', 'p1', null);
  await c.tasks.toggleBookmark('atk', true);
  await c.tasks.setChecklistCheckedValue('atk', 'cl1', true);
  await c.tasks.removeFromBoard('atk', 'p1');
  await c.tasks.checkToken('t1', 'atk');
  await c.tasks.editComment('atk', 'c1', 'edited');

  assert.deepEqual(seen[0], { path: 'tasks/snooze', body: { token: 'atk', project: 'p1', alarm_at: '2026-08-01T00:00:00Z' } });
  assert.deepEqual(seen[1].body, { token: 'atk', project: 'p1', deadline: null });
  assert.deepEqual(seen[2].body, { token: 'atk', bookmarked: true });
  assert.deepEqual(seen[3].body, { token: 'atk', checklistId: 'cl1', checked: true });
  assert.deepEqual(seen[4].body, { token: 'atk', project_id: 'p1' });
  assert.deepEqual(seen[5].body, { tid: 't1', token: 'atk' });
  assert.deepEqual(seen[6].body, { token: 'atk', commentId: 'c1', newComment: 'edited' });
});

test('chat: message + group-admin endpoints', async () => {
  const seen = capture();
  const c = client();
  await c.chat.getMessages(['m1', 'm2'], 'd1');
  await c.chat.updateSentMessage('d1', 'm1', 'fixed');
  await c.chat.pinDialog('d1');
  await c.chat.addPinMessage('d1', 'm1');
  await c.chat.setAdmin('d1', 'u1', true);
  await c.chat.updateTitle('d1', 'New title');

  assert.deepEqual(seen[0], { path: 'chat/getMessages', body: { mids: ['m1', 'm2'], dialog: 'd1' } });
  assert.deepEqual(seen[1].body, { dialog: 'd1', mid: 'm1', newMessage: 'fixed' });
  assert.deepEqual(seen[2].body, { dialog: 'd1' });
  assert.deepEqual(seen[3].body, { dialog: 'd1', message: 'm1' });
  assert.deepEqual(seen[4].body, { dialog: 'd1', user: 'u1', isAdmin: true });
  assert.deepEqual(seen[5].body, { dialog: 'd1', title: 'New title' });
});

test('projects: add/save/board CRUD payload keys', async () => {
  const seen = capture();
  const c = client();
  await c.projects.add({ title: 'P', color: 'blue', members: ['u1'] });
  await c.projects.full('p1');
  await c.projects.archive('p1');
  await c.projects.addKanbanBoard('p1', { title: 'Todo' });
  await c.projects.setKanbanBoardOrder({ projectId: 'p1', boardId: 'b1', oldPosition: 0, newPosition: 2 });

  assert.deepEqual(seen[0], { path: 'projects/add', body: { title: 'P', color: 'blue', members: ['u1'] } });
  assert.deepEqual(seen[1].body, { project_id: 'p1' });
  assert.deepEqual(seen[2].body, { project_id: 'p1' });
  assert.deepEqual(seen[3].body, { projectId: 'p1', kanbanBoard: { title: 'Todo' } });
  assert.deepEqual(seen[4].body, { projectId: 'p1', boardId: 'b1', oldPosition: 0, newPosition: 2 });
});

test('labels + dashboard + workspace admin', async () => {
  const seen = capture();
  const c = client();
  await c.labels.add('Urgent', 'red', 'task');
  await c.labels.delete('l1', 'task');
  await c.dashboard.getAllBadges();
  await c.dashboard.acceptInviteRequest('w2');
  await c.workspaces.inviteMember('Ali', '0912', false);

  assert.deepEqual(seen[0], { path: 'labels/add', body: { title: 'Urgent', color: 'red', type: 'task' } });
  assert.deepEqual(seen[1].body, { label_id: 'l1', label_type: 'task' });
  assert.deepEqual(seen[2].body, { only_badges: true });
  assert.deepEqual(seen[3].body, { workspace: 'w2' });
  assert.deepEqual(seen[4].body, { name: 'Ali', email_phone: '0912', is_guest: false });
});

test('letters: secretariat + deleteMessage key by mid, not thread', async () => {
  const seen = capture();
  const c = client();
  await c.letters.registerInLetter('th1', { number: '123' });
  await c.letters.changeMessageLabels('th1', ['l1']);
  await c.letters.getSeenDetails('th1', 'msg1');
  await c.letters.deleteMessage('mid1', true);

  assert.deepEqual(seen[0], { path: 'inbox/registerInLetter', body: { thread: 'th1', letterOptions: { number: '123' } } });
  assert.deepEqual(seen[1].body, { thread: 'th1', labels: ['l1'] });
  assert.deepEqual(seen[2].body, { thread: 'th1', msgId: 'msg1' });
  assert.deepEqual(seen[3].body, { mid: 'mid1', isDeleteThread: true }); // NOT thread
});

test('notes: create/update pass the note object; mutators key by note_id (pin by noteId)', async () => {
  const seen = capture();
  const c = client();
  await c.notes.getAll();
  await c.notes.create({ title: 'N', note: 'body', checklist: [], labels: [] });
  await c.notes.deleteNote('n1');
  await c.notes.setChecklistValue('n1', 2, true);
  await c.notes.updatePinState('n1', true);

  assert.deepEqual(seen[0], { path: 'notes/getAll', body: {} });
  assert.deepEqual(seen[1].body, { title: 'N', note: 'body', checklist: [], labels: [] });
  assert.deepEqual(seen[2].body, { note_id: 'n1', deleted: true });
  assert.deepEqual(seen[3].body, { note_id: 'n1', check_index: 2, checked: true });
  assert.deepEqual(seen[4].body, { pinned: true, noteId: 'n1' }); // camelCase noteId, verbatim
});
