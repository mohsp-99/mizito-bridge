// Workspace-aware WRITE layer over the Mizito client.
//
// The read side (feeds/index.ts) answers "what do I have?"; this module is the
// mutating counterpart — create/define tasks, comment on them, move their
// progress, complete them, and send chat messages. Every operation:
//   - targets ONE workspace (the active one unless a name/id is given),
//   - resolves human-friendly names (project / board / member / task title) to
//     the ids the API needs, failing loudly rather than guessing, and
//   - returns a small, normalized confirmation of what actually changed.
//
// All endpoints here were verified live against a real workspace; see
// mizito-crawler's write-probe script.
import fs from 'node:fs';
import path from 'node:path';
import { resolveWorkspace } from './index.js';
import type { MizitoContext } from './index.js';
import type { MizitoClient } from '../client.js';
import { taskFromMessage, CHAT_PAGE_SIZE } from '../resources/chat.js';
import { ROOT } from '../config.js';
import { ensureDir, slug } from '../util.js';
import type { UploadInput } from '../resources/content.js';
import type { Attachment, KanbanBoard, Member, Project, Task, UploadedDocument } from '../types/index.js';

// --- attachments (the write-half of files) -------------------------------
// A file to upload as part of a write. `data` is the bytes (Blob/File,
// Uint8Array, or ArrayBuffer); the rest mirror content.upload's options.
export interface FileUpload {
  data: UploadInput;
  filename?: string;
  maxWidthHeight?: number;
  sendAsFile?: boolean;
}

/** One entry of a write's `attachments` array — the media wrapper the API wants. */
export interface AttachmentEntry {
  /** Server-assigned on read; omit when posting. */
  _id?: string;
  media: UploadedDocument;
  [key: string]: unknown;
}

// Options shared by writes that can carry attachments.
export interface AttachmentOptions {
  /**
   * Already-uploaded documents (from uploadFile / client.content.upload), or
   * attachment entries read back off an existing task. Either shape is
   * accepted; both are normalized to `{ media: document }` before sending.
   */
  attachments?: (UploadedDocument | AttachmentEntry)[];
  /** Files to upload (into the write's workspace) and attach in one call. */
  files?: FileUpload[];
}

// `content/upload` returns the media wrapper
// `{_: 'messageMediaDocument', document: {...}}`, but a write's `attachments`
// array wants that wrapper nested one level deeper, under `media` — verified
// live against existing task attachments:
//
//   attachments: [ { _id: <server-assigned>, media: { _: 'messageMediaDocument',
//                    document: { _id, name, size, content, content_key } } } ]
//
// Posting the bare upload result instead makes `tasks/newComment` return `false`
// and silently store nothing, which is exactly what happened before this fix.
function asAttachmentEntry(doc: UploadedDocument | AttachmentEntry): AttachmentEntry {
  // Already an attachment entry (or a re-used one read back off a task).
  if (doc && typeof doc === 'object' && 'media' in doc) return doc as AttachmentEntry;
  return { media: doc as UploadedDocument };
}

// Upload each `files` entry via the given (workspace-scoped) client and return
// the full attachment list (pre-uploaded documents first, then the new ones).
async function collectAttachments(
  mz: MizitoClient,
  { attachments = [], files = [] }: AttachmentOptions,
): Promise<AttachmentEntry[]> {
  const uploaded: AttachmentEntry[] = [];
  for (const f of files) {
    const doc = await mz.content.upload(f.data, {
      filename: f.filename,
      maxWidthHeight: f.maxWidthHeight,
      sendAsFile: f.sendAsFile,
    });
    uploaded.push(asAttachmentEntry(doc));
  }
  return [...attachments.map(asAttachmentEntry), ...uploaded];
}

// These endpoints answer with a bare `true`/`false` JSON body rather than the
// usual {status,data} envelope, so the transport passes it straight through and
// a refusal reads as an ordinary result. Callers must check it: a write that
// reports success it never confirmed is worse than one that throws.
function assertWriteAccepted(res: unknown, what: string): void {
  if (res === false || res === null || res === undefined) {
    throw new Error(
      `${what} was refused by Mizito (the API returned ${JSON.stringify(res)}). ` +
        'Nothing was saved.',
    );
  }
}

// Upload a file into a specific workspace and return the created document, so a
// caller can attach it to a later write. The workspace scoping matters: content
// tokens are workspace-scoped (see downloadAttachment).
export async function uploadFile(
  ctx: MizitoContext,
  {
    workspace,
    data,
    filename,
    maxWidthHeight,
    sendAsFile,
  }: { workspace?: string; data: UploadInput; filename?: string; maxWidthHeight?: number; sendAsFile?: boolean },
): Promise<{ workspace: string; document: UploadedDocument }> {
  if (data == null) throw new Error('data (the file bytes) is required.');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const document = await mz.content.upload(data, { filename, maxWidthHeight, sendAsFile });
  return { workspace: ws.title, document };
}

// --- small helpers -------------------------------------------------------
// A few of these (norm, fullName, findByName, loadMembers, loadProjects,
// attachmentOf) are shared with the letters/conversations layers, so they are
// exported. They stay here (rather than a separate module) to keep the verified
// write code self-contained; the other modules import them from here.
export const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();
const boardId = (b: KanbanBoard | string | null | undefined): string | null =>
  typeof b === 'string' ? b : b?._id ?? null;
const boardTitle = (b: KanbanBoard | string | null | undefined): string =>
  typeof b === 'string' ? '' : b?.title ?? '';
export const fullName = (u: Member | null | undefined): string =>
  `${u?.first_name ?? ''} ${u?.last_name ?? ''}`.trim();

// Normalize a Mizito document attachment node (on comments / task messages) to
// { id, name, size, content_token, content_key }. The `content_token` is the JWT
// used to download the file from the CDN. Handles the couple of shapes it appears
// in (`{media:{document}}`, `{document}`, or a bare document object).
export function attachmentOf(a: unknown): Attachment | null {
  const node = a as
    | { media?: { document?: Record<string, unknown> }; document?: Record<string, unknown>; _id?: string; content?: unknown }
    | null
    | undefined;
  const d = (node?.media?.document || node?.document || (node?._id && node?.content ? node : null)) as
    | { _id?: string; name?: string; size?: number | null; content?: string | null; content_key?: string | null }
    | null;
  if (!d?._id) return null;
  return {
    id: d._id,
    name: d.name || d._id,
    size: d.size ?? null,
    content_token: d.content || null,
    content_key: d.content_key || null,
  };
}

// Filesystem-safe filename that keeps the extension readable.
function safeName(name: unknown, fallback: string): string {
  const s = String(name || fallback || 'file').replace(/[\\/:*?"<>| -]+/g, '_').trim();
  return s || String(fallback || 'file');
}

export async function loadProjects(mz: MizitoClient): Promise<Project[]> {
  const r = await mz.projects.getList().catch(() => null);
  return r?.projects ?? [];
}
export async function loadMembers(mz: MizitoClient): Promise<Member[]> {
  const r = await mz.workspaces.getUsers().catch(() => null);
  return r?.users ?? [];
}

// Match by exact id, then exact (normalized) title, then unique substring.
export function findByName<T extends { _id: string }>(
  items: T[],
  ref: string | null | undefined,
  nameOf: (item: T) => string | undefined,
): T | null {
  if (!ref) return null;
  const n = norm(ref);
  return (
    items.find((it) => it._id === ref) ||
    items.find((it) => norm(nameOf(it)) === n) ||
    items.find((it) => norm(nameOf(it)).includes(n)) ||
    null
  );
}

function findProject(projects: Project[], ref: string): Project | null {
  return findByName(
    projects.filter((p) => !p.deleted),
    ref,
    (p) => p.title,
  );
}

// Default to the project's first kanban board when none is named.
function findBoard(project: Project | null, ref: string | undefined | null): KanbanBoard | string | null {
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
function pickTask(
  list: Task[],
  { taskId, title }: { taskId?: string; title?: string },
): { task?: Task; none?: boolean; ambiguous?: Task[] } {
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

function ambiguityError(title: string | undefined, hits: Task[]): Error {
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
async function scanProjectsForTask(
  mz: MizitoClient,
  { taskId, title }: { taskId?: string; title?: string },
  { maxPagesPerDialog = 40 }: { maxPagesPerDialog?: number } = {},
): Promise<Task | null> {
  const projects = await loadProjects(mz);
  const dialogs = projects.filter((p) => !p.deleted && p.dialog).map((p) => p.dialog as string);
  const byId = new Map<string, Task>();
  for (const dialog of dialogs) {
    let offset = 0;
    for (let page = 0; page < maxPagesPerDialog; page++) {
      const msgs = await mz.chat.getHistory(dialog, offset).catch(() => []);
      if (!Array.isArray(msgs) || msgs.length === 0) break;
      for (const m of msgs) {
        const t = taskFromMessage(m);
        if (t && !byId.has(t._id)) byId.set(t._id, t); // newest first => keep first
      }
      if (taskId && byId.has(taskId)) return byId.get(taskId) ?? null;
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
async function findTask(mz: MizitoClient, { taskId, title }: { taskId?: string; title?: string }): Promise<Task> {
  if (!taskId && !title) throw new Error('Provide task_id or task_title to identify the task.');

  const all = await mz.tasks.getAll().catch(() => [] as Task[]);
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

function projectTitleOf(projects: Project[], id: unknown): string | null {
  return projects.find((p) => p._id === id)?.title ?? null;
}

// ---------------------------------------------------------------------------
// List projects (read helper) — so a caller can discover the project/board
// names to pass to createTask / sendMessage.
// ---------------------------------------------------------------------------
export async function listProjects(ctx: MizitoContext, { workspace }: { workspace?: string } = {}) {
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
export interface CreateTaskInput extends AttachmentOptions {
  workspace?: string;
  project?: string;
  board?: string;
  title: string;
  notes?: string;
  assignees?: string | string[] | null;
  deadline?: string | null;
  deadlineStart?: string | null;
  progress?: number;
  labels?: unknown[];
  postToChat?: boolean;
}

export async function createTask(
  ctx: MizitoContext,
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
    attachments = [],
    files = [],
  }: CreateTaskInput,
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
  let assigneeIds: string[];
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

  const attachmentDocs = await collectAttachments(mz, { attachments, files });

  const payload = {
    title: String(title).trim(),
    notes: notes ?? '',
    assignee: assigneeIds,
    project: proj?._id ?? null,
    kanban_board: proj ? boardId(boardObj) : null,
    labels: labels ?? [],
    attachments: attachmentDocs,
    deleted: false,
    alarm_options: null,
    progress: progress ?? 0,
    deadline_start: deadlineStart ?? null,
    deadline: deadline ?? null,
    checklist: [],
    responsible: null,
    insert_to_chat_group: proj ? !!postToChat : false,
  };

  const res = await mz.tasks.add(payload);
  const task = (Array.isArray(res) ? res[0] : res) as Task | undefined;
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
export interface EditTaskInput {
  workspace?: string;
  taskId?: string;
  taskTitle?: string;
  title?: string;
  notes?: string;
  deadline?: string | null;
  deadlineStart?: string | null;
  progress?: number;
  board?: string | null;
  assignees?: string | string[] | null;
}

export async function editTask(
  ctx: MizitoContext,
  { workspace, taskId, taskTitle, title, notes, deadline, deadlineStart, progress, board, assignees }: EditTaskInput = {},
) {
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const task = await findTask(mz, { taskId, title: taskTitle });

  // Resolve board / assignees only if the caller is changing them.
  let boardId_: string | null = task.kanban_board ?? null;
  if (board !== undefined && task.project) {
    const projects = await loadProjects(mz);
    const proj = projects.find((p) => p._id === task.project) ?? null;
    const b = proj ? findBoard(proj, board) : null;
    if (board && !b) throw new Error(`No board matches "${board}" in this task's project.`);
    boardId_ = b ? boardId(b) : null;
  }

  let assigneeIds: TaskRoleRefIds = Array.isArray(task.assignee)
    ? (task.assignee as TaskRoleRefIds)
    : task.assignee
      ? ([task.assignee] as TaskRoleRefIds)
      : [];
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

  const res = await mz.tasks.save(payload);
  const saved = (Array.isArray(res) ? res[0] : res) as Task | undefined;
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

type TaskRoleRefIds = Array<unknown>;

// ---------------------------------------------------------------------------
// Comment on a task.
// ---------------------------------------------------------------------------
export async function commentOnTask(
  ctx: MizitoContext,
  {
    workspace,
    taskId,
    taskTitle,
    comment,
    attachments = [],
    files = [],
  }: { workspace?: string; taskId?: string; taskTitle?: string; comment: string } & AttachmentOptions,
) {
  // A comment may be attachments-only, so allow empty text when files are given.
  const hasText = !!(comment && String(comment).trim());
  if (!hasText && !attachments.length && !files.length) {
    throw new Error('comment text or at least one attachment is required.');
  }
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const task = await findTask(mz, { taskId, title: taskTitle });
  const attachmentDocs = await collectAttachments(mz, { attachments, files });
  const res = await mz.tasks.newComment({
    token: task.access_token as string,
    comment: hasText ? String(comment) : '',
    attachments: attachmentDocs,
  });
  assertWriteAccepted(res, `Commenting on "${task.title}"`);
  return {
    workspace: ws.title,
    task_id: task._id,
    title: task.title,
    commented: true,
    attachments: attachmentDocs.length,
  };
}

// ---------------------------------------------------------------------------
// Update a task's progress (0..100).
// ---------------------------------------------------------------------------
export async function setTaskProgress(
  ctx: MizitoContext,
  { workspace, taskId, taskTitle, progress }: { workspace?: string; taskId?: string; taskTitle?: string; progress: number },
) {
  const p = Number(progress);
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error('progress must be a number 0..100.');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const task = await findTask(mz, { taskId, title: taskTitle });
  const res = await mz.tasks.updateProgress(task.access_token as string, p);
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
export async function setTaskCompleted(
  ctx: MizitoContext,
  { workspace, taskId, taskTitle, completed = true }: { workspace?: string; taskId?: string; taskTitle?: string; completed?: boolean } = {},
) {
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const task = await findTask(mz, { taskId, title: taskTitle });
  const res = await mz.tasks.setCompleted({
    token: task.access_token as string,
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
export async function sendMessage(
  ctx: MizitoContext,
  { workspace, project, dialog, text }: { workspace?: string; project?: string; dialog?: string; text: string },
) {
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
  await mz.chat.send(message);
  return { workspace: ws.title, dialog: dlg, sent_to: where, text: String(text), sent: true };
}

// ---------------------------------------------------------------------------
// Read a task's comment thread (with attachment metadata).
//
// A read, but it lives here because it needs the same task resolver as the write
// ops (`tasks/getComments` is keyed by the task's access_token). Each comment's
// attachments carry a `content_token` you can pass to downloadAttachment().
// ---------------------------------------------------------------------------
export async function getTaskComments(
  ctx: MizitoContext,
  { workspace, taskId, taskTitle }: { workspace?: string; taskId?: string; taskTitle?: string } = {},
) {
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const task = await findTask(mz, { taskId, title: taskTitle });
  const [comments, members] = await Promise.all([
    mz.tasks.getComments(task.access_token as string).catch(() => []),
    loadMembers(mz).catch(() => []),
  ]);
  const nameById = new Map(members.map((m) => [m._id, fullName(m)]));

  const list = (Array.isArray(comments) ? comments : [])
    .filter((c) => !c.deleted)
    .map((c) => ({
      id: c._id,
      author: (c.comment_owner && nameById.get(c.comment_owner)) || c.comment_owner || null,
      text: c.comment || '',
      date: c.comment_at || null,
      edited: !!c.edited,
      attachments: (c.attachments || []).map(attachmentOf).filter((x): x is Attachment => x != null),
    }));

  const attachmentCount = list.reduce((n, c) => n + c.attachments.length, 0);
  return {
    workspace: ws.title,
    task_id: task._id,
    title: task.title,
    count: list.length,
    attachment_count: attachmentCount,
    comments: list,
  };
}

// ---------------------------------------------------------------------------
// Download an attachment by its CDN content token.
//
// The CDN fetch itself lives in resources/files.ts (it needs the owning
// workspace's session token in x-token — workspace-scoped tokens otherwise
// return a tiny "invalid" stub). Saves to downloads/<workspace>/ under the
// data root and returns the path; for small files, optionally returns the
// bytes inline as base64. Content tokens expire, so re-read the comment to
// refresh one if a download fails.
// ---------------------------------------------------------------------------
export async function downloadAttachment(
  ctx: MizitoContext,
  {
    workspace,
    contentToken,
    name,
    dir,
    maxInlineBytes = 0,
  }: { workspace?: string; contentToken: string; name?: string; dir?: string; maxInlineBytes?: number },
) {
  if (!contentToken || !String(contentToken).trim()) throw new Error('contentToken is required.');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });

  const buf = await mz.files.download(contentToken);

  const outDir = dir || path.join(ROOT, 'downloads', slug(ws.title));
  ensureDir(outDir);
  let dest = path.join(outDir, safeName(name, 'attachment'));
  // avoid clobbering an existing different file
  if (fs.existsSync(dest) && fs.statSync(dest).size !== buf.length) {
    const ext = path.extname(dest);
    dest = dest.slice(0, dest.length - ext.length) + `_${buf.length}` + ext;
  }
  fs.writeFileSync(dest, buf);

  const result: {
    workspace: string;
    name: string;
    path: string;
    size: number;
    saved: boolean;
    base64?: string;
  } = {
    workspace: ws.title,
    name: name || path.basename(dest),
    path: dest,
    size: buf.length,
    saved: true,
  };
  if (maxInlineBytes && buf.length <= maxInlineBytes) {
    result.base64 = buf.toString('base64');
  }
  return result;
}
