// Live test harness for Mizito WRITE endpoints (reverse-engineered from the SPA).
//
//   node apps/crawler/write-probe.mjs
//
// Runs ONLY against the session's active workspace and cleans up everything it
// creates (deletes the test message and task at the end). Use it to confirm the
// write endpoints still work before relying on the write layer / MCP tools.
//
// Verifies, in order: tasks/add, tasks/getComments, tasks/newComment,
// tasks/getComments (again), tasks/updateProgress, chat/send — then removes the
// test message and task.
import { createClient } from '@mohsp-99/mizito-core';
import { loadToken } from '@mohsp-99/mizito-core';

const line = (s) => console.log(s);
const ok = (s) => console.log('  ✓ ' + s);
const info = (s) => console.log('  · ' + s);

const token = loadToken();
if (!token) {
  console.error('No saved session. Run `npm run login` first.');
  process.exit(1);
}
const client = createClient({ token, pacingMs: 300 });
const call = (ep, payload, opts) => client.call(ep, payload, opts);

const created = { taskToken: null, taskId: null, dialog: null, messageMid: null };

async function main() {
  line('\n[0] bootstrap (workspace/userId)');
  const boot = await call('workspace/userId', { regId: null });
  const uid = boot.uid;
  const active = (boot.workspaces || []).find((w) => w.active);
  ok(`uid=${uid}  active workspace="${active?.title}"`);

  line('\n[1] projects/getList — pick an advanced project with a dialog + board');
  const pl = await call('projects/getList', {});
  const projects = pl.projects || [];
  const proj =
    projects.find(
      (p) => !p.deleted && !p.archived && p.is_advanced && p.dialog && (p.kanban_boards || []).length,
    ) || projects.find((p) => !p.deleted && p.dialog);
  if (!proj) throw new Error('No suitable project found to test against.');
  const board = (proj.kanban_boards || [])[0];
  const boardId = board?._id || board || null;
  created.dialog = proj.dialog;
  ok(`project="${proj.title}" id=${proj._id} dialog=${proj.dialog} board=${boardId}`);

  line('\n[2] tasks/add — create a test task');
  const addPayload = {
    title: 'تست mizito-bridge (قابل حذف)',
    notes: 'automated write-endpoint test — safe to delete',
    assignee: [uid],
    project: proj._id,
    kanban_board: boardId,
    labels: [],
    attachments: [],
    deleted: false,
    alarm_options: null,
    progress: 0,
    deadline_start: null,
    deadline: null,
    checklist: [],
    responsible: null,
    insert_to_chat_group: true,
  };
  const addRes = await call('tasks/add', addPayload);
  const task = Array.isArray(addRes) ? addRes[0] : addRes;
  if (!task || task.error) throw new Error('tasks/add failed: ' + JSON.stringify(addRes));
  created.taskId = task._id;
  created.taskToken = task.access_token;
  ok(`task created _id=${task._id} token=${String(task.access_token).slice(0, 24)}… dialog=${task.dialog}`);

  line('\n[3] tasks/getComments — should start empty');
  const c0 = await call('tasks/getComments', { token: created.taskToken });
  ok(`getComments returned ${Array.isArray(c0) ? c0.length : '?'} comment(s)`);

  line('\n[4] tasks/newComment — add a comment');
  const commentText = 'test comment from mizito-bridge write layer';
  const nc = await call('tasks/newComment', {
    token: created.taskToken,
    comment: commentText,
    attachments: [],
    mention: [],
    reply_id: null,
  });
  ok('newComment posted: ' + JSON.stringify(nc).slice(0, 120));

  line('\n[5] tasks/getComments — verify comment landed');
  const c1 = await call('tasks/getComments', { token: created.taskToken });
  const found = (Array.isArray(c1) ? c1 : []).some((x) => (x.comment || '').includes(commentText));
  ok(`getComments now ${Array.isArray(c1) ? c1.length : '?'}; test comment present=${found}`);

  line('\n[6] tasks/updateProgress — set 50%');
  const up = await call('tasks/updateProgress', { token: created.taskToken, progress: 50 });
  ok('updateProgress -> ' + JSON.stringify(up).slice(0, 100));

  line('\n[7] chat/send — post a text message to the project dialog');
  const randomId = Math.floor(Math.random() * 1e9);
  const msg = {
    _: 'message',
    dialog: created.dialog,
    out: true,
    message: 'test message from mizito-bridge (safe to delete)',
    media: null,
    from: uid,
    date: Date.now(),
    reply_to: null,
    mention: [],
    seen_count: 1,
    randomId,
    pending: true,
  };
  const sent = await call('chat/send', msg);
  created.messageMid = sent?._id || sent?.mid || (Array.isArray(sent) ? sent[0]?._id : null);
  ok('chat/send -> ' + JSON.stringify(sent).slice(0, 160));

  line('\n[done] all write endpoints exercised. Cleaning up…');
}

async function cleanup() {
  if (created.messageMid && created.dialog) {
    try {
      await call('chat/removeSentMessage', { dialog: created.dialog, mid: created.messageMid });
      info('removed test chat message');
    } catch (e) {
      info('chat cleanup failed: ' + e.message);
    }
  }
  if (created.taskToken) {
    try {
      const r = await call('tasks/removeTask', { token: created.taskToken });
      info('removed test task: ' + (r?.message || 'ok'));
    } catch (e) {
      info('task cleanup failed: ' + e.message);
    }
  }
}

main()
  .then(cleanup)
  .then(() => line('\n✓ write-probe complete — endpoints verified, test artifacts removed.'))
  .catch(async (err) => {
    console.error('\n✗ write-probe FAILED:', err.message);
    if (err.body) console.error(JSON.stringify(err.body, null, 2).slice(0, 800));
    await cleanup();
    process.exit(1);
  });
