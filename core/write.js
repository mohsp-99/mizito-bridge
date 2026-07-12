// Workspace-aware WRITE layer over the raw Mizito client.
//
// The read side (core/feed.js) answers "what do I have?"; this module is the
// mutating counterpart — create/define tasks, comment on them, move their
// progress, complete them, and send chat messages. Every operation:
//   - targets ONE workspace (the active one unless a name/id is given),
//   - resolves human-friendly names (project / board / member / task title) to
//     the ids the API needs, failing loudly rather than guessing, and
//   - returns a small, normalized confirmation of what actually changed.
//
// All endpoints here were verified live against a real workspace; see
// apps/crawler/write-probe.mjs.
import { resolveWorkspace } from './feed.js';
import { taskFromMessage, CHAT_PAGE_SIZE } from './mizito.js';

// --- small helpers -------------------------------------------------------
const norm = (s) => String(s ?? '').trim().toLowerCase();
const boardId = (b) => (typeof b === 'string' ? b : b?._id ?? null);
const boardTitle = (b) => (typeof b === 'string' ? '' : b?.title ?? '');
const fullName = (u) => `${u?.first_name ?? ''} ${u?.last_name ?? ''}`.trim();

async function loadProjects(mz) {
  const r = await mz.projects().catch(() => null);
  return r?.projects ?? [];
}
async function loadMembers(mz) {
  const r = await mz.members().catch(() => null);
  return r?.users ?? [];
}

// Match by exact id, then exact (normalized) title, then unique substring.
function findByName(items, ref, nameOf) {
  if (!ref) return null;
  const n = norm(ref);
  return (
    items.find((it) => it._id === ref) ||
    items.find((it) => norm(nameOf(it)) === n) ||
    items.find((it) => norm(nameOf(it)).includes(n)) ||
    null
  );
}

function findProject(projects, ref) {
  return findByName(
    projects.filter((p) => !p.deleted),
    ref,
    (p) => p.title,
  );
}

// Default to the project's first kanban board when none is named.
function findBoard(project, ref) {
  const boards = project?.kanban_boards ?? [];
  if (!ref) return boards[0] ?? null;
  const n = norm(ref);
  return (
    boards.find((b) => boardId(b) === ref) ||
    boards.find((b) => norm(boardTitle(b)) === n) ||
    boards.find((b) => norm(boardTitle(b)).includes(n)) ||
    null
  );
}

// Pick a single task out of a candidate list by id or title.
// Returns { task } | { none: true } | { ambiguous: [...] }.
function pickTask(list, { taskId, title }) {
  if (taskId) {
    const t = list.find((x) => x._id === taskId);
    return t ? { task: t } : { none: true };
  }
  const n = norm(title);
  const exact = list.filter((x) => norm(x.title) === n);
  const part = list.filter((x) => norm(x.title).includes(n));
  const hits = exact.length ? exact : part;
  if (hits.length === 1) return { task: hits[0] };
  if (hits.length === 0) return { none: true };
  return { ambiguous: hits };
}

function ambiguityError(title, hits) {
  return new Error(
    `"${title}" matches ${hits.length} tasks (${hits
      .slice(0, 5)
      .map((t) => `"${t.title}"`)
      .join(', ')}…). Pass task_id to disambiguate.`,
  );
}

// Completed/older tasks are NOT returned by `tasks/getAll` (it only lists open
// tasks). But every task is a message in its project's group chat, and that
// message object carries the task's `access_token`. So when the fast path misses,
// scan the project dialogs (newest messages first) and rebuild the task from its
// latest message. De-dupe by id keeping the newest (first-seen) version; exit
// early once an id match is found.
async function scanProjectsForTask(mz, { taskId, title }, { maxPagesPerDialog = 40 } = {}) {
  const projects = await loadProjects(mz);
  const dialogs = projects.filter((p) => !p.deleted && p.dialog).map((p) => p.dialog);
  const byId = new Map();
  for (const dialog of dialogs) {
    let offset = 0;
    for (let page = 0; page < maxPagesPerDialog; page++) {
      const msgs = await mz.history(dialog, offset).catch(() => []);
      if (!Array.isArray(msgs) || msgs.length === 0) break;
      for (const m of msgs) {
        const t = taskFromMessage(m);
        if (t && !byId.has(t._id)) byId.set(t._id, t); // newest first => keep first
      }
      if (taskId && byId.has(taskId)) return byId.get(taskId);
      offset += msgs.length;
      if (msgs.length < CHAT_PAGE_SIZE) break;
    }
  }
  const list = [...byId.values()].filter((t) => !t.deleted);
  const r = pickTask(list, { taskId, title });
  if (r.task) return r.task;
  if (r.ambiguous) throw ambiguityError(title, r.ambiguous);
  return null;
}

// Locate a full task object (with its access_token) by id or title. The write
// endpoints for comment/progress/complete are keyed by the task's access_token,
// which the id alone doesn't give us. Fast path: `tasks/getAll` (open tasks).
// Fallback: scan project chat histories (covers completed/older tasks too).
async function findTask(mz, { taskId, title }) {
  if (!taskId && !title) throw new Error('Provide task_id or task_title to identify the task.');

  const all = await mz.allTasks().catch(() => []);
  const open = (Array.isArray(all) ? all : []).filter((t) => !t.deleted);
  const fast = pickTask(open, { taskId, title });
  if (fast.task) return fast.task;
  if (fast.ambiguous) throw ambiguityError(title, fast.ambiguous);

  // Not among open tasks — look through the project group chats.
  const found = await scanProjectsForTask(mz, { taskId, title });
  if (found) return found;

  throw new Error(
    taskId
      ? `No task with id "${taskId}" in this workspace.`
      : `No task matches title "${title}" in this workspace.`,
  );
}

function projectTitleOf(projects, id) {
  return projects.find((p) => p._id === id)?.title ?? null;
}

// ---------------------------------------------------------------------------
// List projects (read helper) — so a caller can discover the project/board
// names to pass to createTask / sendMessage.
// ---------------------------------------------------------------------------
export async function listProjects(ctx, { workspace } = {}) {
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const projects = await loadProjects(mz);
  return {
    workspace: ws.title,
    count: projects.filter((p) => !p.deleted).length,
    projects: projects
      .filter((p) => !p.deleted)
      .map((p) => ({
        id: p._id,
        title: p.title,
        is_advanced: !!p.is_advanced,
        archived: !!p.archived,
        dialog: p.dialog ?? null,
        boards: (p.kanban_boards ?? []).map((b) => ({ id: boardId(b), title: boardTitle(b) })),
      })),
  };
}

// ---------------------------------------------------------------------------
// Create / define a task.
// ---------------------------------------------------------------------------
export async function createTask(
  ctx,
  {
    workspace,
    project,
    board,
    title,
    notes = '',
    assignees,
    deadline = null,
    deadlineStart = null,
    progress = 0,
    labels = [],
    postToChat = true,
  } = {},
) {
  if (!title || !String(title).trim()) throw new Error('title is required.');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });

  const projects = await loadProjects(mz);
  const proj = project ? findProject(projects, project) : null;
  if (project && !proj) {
    const names = projects
      .filter((p) => !p.deleted)
      .map((p) => `"${p.title}"`)
      .join(', ');
    throw new Error(`No project matches "${project}" in "${ws.title}". Available: ${names}.`);
  }
  const boardObj = proj ? findBoard(proj, board) : null;
  if (proj && board && !boardObj) {
    const names = (proj.kanban_boards ?? []).map((b) => `"${boardTitle(b)}"`).join(', ');
    throw new Error(`No board matches "${board}" in project "${proj.title}". Boards: ${names}.`);
  }

  // Assignees: default to me; otherwise resolve each name/id to a member id.
  let assigneeIds;
  const list = assignees == null ? [] : Array.isArray(assignees) ? assignees : [assignees];
  if (!list.length) {
    assigneeIds = [ctx.boot.uid];
  } else {
    const members = await loadMembers(mz);
    assigneeIds = list.map((ref) => {
      const u = findByName(members, ref, fullName) || findByName(members, ref, (m) => m.first_name);
      if (!u) throw new Error(`No member matches "${ref}" in "${ws.title}".`);
      return u._id;
    });
  }

  const payload = {
    title: String(title).trim(),
    notes: notes ?? '',
    assignee: assigneeIds,
    project: proj?._id ?? null,
    kanban_board: proj ? boardId(boardObj) : null,
    labels: labels ?? [],
    attachments: [],
    deleted: false,
    alarm_options: null,
    progress: progress ?? 0,
    deadline_start: deadlineStart ?? null,
    deadline: deadline ?? null,
    checklist: [],
    responsible: null,
    insert_to_chat_group: proj ? !!postToChat : false,
  };

  const res = await mz.addTask(payload);
  const task = Array.isArray(res) ? res[0] : res;
  if (!task || task.error) throw new Error(`Create failed: ${task?.error || JSON.stringify(res)}`);

  return {
    workspace: ws.title,
    created: true,
    task: {
      id: task._id,
      title: task.title,
      project: proj?.title ?? projectTitleOf(projects, task.project),
      board: boardObj ? boardTitle(boardObj) : null,
      assignees: assigneeIds.length,
      progress: task.progress ?? 0,
      deadline: task.deadline ?? task.alarm_at ?? null,
      dialog: task.dialog ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Edit an existing task.
//
// `tasks/save` takes the FULL task payload (same shape as tasks/add) plus
// task_id + token — sending a partial object would blank the omitted fields. So
// we load the task's current state and override only the fields being changed.
// Pass `deadline: null` to clear a deadline; omit a field to leave it as-is.
// ---------------------------------------------------------------------------
export async function editTask(
  ctx,
  { workspace, taskId, taskTitle, title, notes, deadline, deadlineStart, progress, board, assignees } = {},
) {
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const task = await findTask(mz, { taskId, title: taskTitle });

  // Resolve board / assignees only if the caller is changing them.
  let boardId_ = task.kanban_board ?? null;
  if (board !== undefined && task.project) {
    const projects = await loadProjects(mz);
    const proj = projects.find((p) => p._id === task.project);
    const b = proj ? findBoard(proj, board) : null;
    if (board && !b) throw new Error(`No board matches "${board}" in this task's project.`);
    boardId_ = b ? boardId(b) : null;
  }

  let assigneeIds = Array.isArray(task.assignee) ? task.assignee : task.assignee ? [task.assignee] : [];
  if (assignees !== undefined) {
    const members = await loadMembers(mz);
    const list = assignees == null ? [] : Array.isArray(assignees) ? assignees : [assignees];
    assigneeIds = list.map((ref) => {
      const u = findByName(members, ref, fullName) || findByName(members, ref, (m) => m.first_name);
      if (!u) throw new Error(`No member matches "${ref}" in "${ws.title}".`);
      return u._id;
    });
  }

  const payload = {
    task_id: task._id,
    token: task.access_token,
    title: title != null ? String(title) : task.title,
    notes: notes != null ? String(notes) : task.notes ?? '',
    assignee: assigneeIds,
    project: task.project ?? null,
    kanban_board: boardId_,
    labels: task.labels ?? [],
    attachments: task.attachments ?? [],
    deleted: false,
    alarm_options: task.alarm_options ?? null,
    progress: progress != null ? Number(progress) : task.progress ?? 0,
    deadline_start: deadlineStart !== undefined ? deadlineStart : task.deadline_start ?? null,
    deadline: deadline !== undefined ? deadline : task.deadline ?? task.alarm_at ?? null,
    checklist: task.checklist ?? [],
    responsible: task.responsible ?? null,
  };

  const res = await mz.saveTask(payload);
  const saved = Array.isArray(res) ? res[0] : res;
  if (!saved || saved.error) throw new Error(`Edit failed: ${saved?.error || JSON.stringify(res)}`);
  return {
    workspace: ws.title,
    task_id: saved._id ?? task._id,
    title: saved.title ?? payload.title,
    progress: saved.progress ?? payload.progress,
    deadline: saved.deadline ?? saved.alarm_at ?? payload.deadline ?? null,
    updated: true,
  };
}

// ---------------------------------------------------------------------------
// Comment on a task.
// ---------------------------------------------------------------------------
export async function commentOnTask(ctx, { workspace, taskId, taskTitle, comment } = {}) {
  if (!comment || !String(comment).trim()) throw new Error('comment is required.');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const task = await findTask(mz, { taskId, title: taskTitle });
  await mz.newTaskComment({ token: task.access_token, comment: String(comment) });
  return { workspace: ws.title, task_id: task._id, title: task.title, commented: true };
}

// ---------------------------------------------------------------------------
// Update a task's progress (0..100).
// ---------------------------------------------------------------------------
export async function setTaskProgress(ctx, { workspace, taskId, taskTitle, progress } = {}) {
  const p = Number(progress);
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('progress must be a number 0..100.');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const task = await findTask(mz, { taskId, title: taskTitle });
  const res = await mz.updateTaskProgress(task.access_token, p);
  if (res?.error) throw new Error(res.error);
  return {
    workspace: ws.title,
    task_id: task._id,
    title: res?.title ?? task.title,
    progress: res?.progress ?? p,
    completed: !!res?.completed,
  };
}

// ---------------------------------------------------------------------------
// Complete (or reopen) a task.
// ---------------------------------------------------------------------------
export async function setTaskCompleted(ctx, { workspace, taskId, taskTitle, completed = true } = {}) {
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const task = await findTask(mz, { taskId, title: taskTitle });
  const res = await mz.setTaskCompleted({
    token: task.access_token,
    completed: !!completed,
    project: task.project ?? null,
    ...(completed ? {} : { progress: 0 }),
  });
  if (res?.error) throw new Error(res.error);
  return {
    workspace: ws.title,
    task_id: task._id,
    title: res?.title ?? task.title,
    completed: res?.completed ?? !!completed,
  };
}

// ---------------------------------------------------------------------------
// Send a chat message — to a project's group chat (by name/id) or a dialog id.
// ---------------------------------------------------------------------------
export async function sendMessage(ctx, { workspace, project, dialog, text } = {}) {
  if (!text || !String(text).trim()) throw new Error('text is required.');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });

  let dlg = dialog || null;
  let where = dialog || null;
  if (!dlg) {
    if (!project) throw new Error('Provide a project (name/id) or a dialog id to send to.');
    const projects = await loadProjects(mz);
    const proj = findProject(projects, project);
    if (!proj) throw new Error(`No project matches "${project}" in "${ws.title}".`);
    if (!proj.dialog) throw new Error(`Project "${proj.title}" has no chat dialog.`);
    dlg = proj.dialog;
    where = proj.title;
  }

  const message = {
    _: 'message',
    dialog: dlg,
    out: true,
    message: String(text),
    media: null,
    from: ctx.boot.uid,
    date: Date.now(),
    reply_to: null,
    mention: [],
    seen_count: 1,
    randomId: Math.floor(Math.random() * 1e9),
    pending: true,
  };
  await mz.sendMessage(message);
  return { workspace: ws.title, dialog: dlg, sent_to: where, text: String(text), sent: true };
}
