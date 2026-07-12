// Workspace-aware "personal feed" layer over the raw Mizito client.
//
// Mizito scopes most data calls to the session's *active* workspace, but a user
// belongs to several workspaces and their tasks/messages are spread across them.
// `workspace/switch` mints a NEW token scoped to a given workspace without
// changing the user's active workspace (see docs/MIZITO_INTERNALS.md §4), so we
// can read every workspace read-only by switching per call.
//
// This module turns that into a few high-level, normalized reads that any tool
// (the MCP server today, more later) can use: identity, overview, my tasks, and
// unread messages — across all workspaces or one.
import { createMizito } from './mizito.js';
import { loadToken } from './auth.js';

// The `workspace/switch` response shape varies (sometimes `{token}`, sometimes
// the standard `{data:{token}}` envelope). Pull the token out of either.
function tokenFromSwitch(sw) {
  if (!sw) return null;
  if (typeof sw === 'string') return sw;
  return sw.data?.token || sw.token || null;
}

// Bootstrap: identity + the account's workspaces. Throws a clear error if there
// is no saved session.
export async function buildContext(token = loadToken()) {
  if (!token) {
    throw new Error('No Mizito session found. Run `npm run login` to sign in first.');
  }
  const root = createMizito({ token });
  const boot = await root.bootstrap();
  return { token, root, boot };
}

// A Mizito client scoped to one workspace descriptor `{_id, title, active}`.
// Uses the base session token for the active workspace; switches for the rest.
async function clientForWorkspace(root, baseToken, ws) {
  if (ws.active) return createMizito({ token: baseToken });
  const sw = await root.switchWorkspace(ws._id);
  const token = tokenFromSwitch(sw);
  if (!token) throw new Error(`Could not switch into workspace "${ws.title}".`);
  return createMizito({ token });
}

// Resolve a single target workspace for a WRITE (default: the active one).
// Returns a workspace-scoped client plus the workspace descriptor, so callers
// know exactly where the mutation landed. Throws if a name/id was given but no
// workspace matches (writes must not silently hit the wrong workspace).
export async function resolveWorkspace(ctx, { workspace } = {}) {
  const all = ctx.boot.workspaces ?? [];
  let ws;
  if (!workspace) {
    ws = all.find((w) => w.active) ?? all[0];
  } else {
    const needle = String(workspace).trim().toLowerCase();
    ws = all.find((w) => w._id === workspace || (w.title ?? '').trim().toLowerCase() === needle);
    if (!ws) {
      const names = all.map((w) => `"${w.title}"`).join(', ');
      throw new Error(`No workspace matches "${workspace}". Available: ${names}.`);
    }
  }
  if (!ws) throw new Error('No workspaces available on this account.');
  const mz = await clientForWorkspace(ctx.root, ctx.token, ws);
  return { mz, ws: { id: ws._id, title: ws.title, active: !!ws.active } };
}

// Pick which workspaces to read: all, or just the one matching id/title.
function selectWorkspaces(boot, { workspace } = {}) {
  const all = boot.workspaces ?? [];
  if (!workspace) return all;
  const needle = String(workspace).trim().toLowerCase();
  const hit = all.filter(
    (w) => w._id === workspace || (w.title ?? '').trim().toLowerCase() === needle,
  );
  return hit.length ? hit : all;
}

// Run `fn(mz, ws)` for each selected workspace, tolerating per-workspace failure
// (one bad workspace shouldn't blank the whole result). Returns per-workspace
// `{ workspace, ok, value?, error? }`.
async function forEachWorkspace(ctx, opts, fn) {
  const targets = selectWorkspaces(ctx.boot, opts);
  const out = [];
  for (const ws of targets) {
    const workspace = { id: ws._id, title: ws.title, active: !!ws.active };
    try {
      const mz = await clientForWorkspace(ctx.root, ctx.token, ws);
      out.push({ workspace, ok: true, value: await fn(mz, ws) });
    } catch (err) {
      out.push({ workspace, ok: false, error: String(err.message || err) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Identity / workspaces
// ---------------------------------------------------------------------------
export function identity(ctx) {
  const b = ctx.boot;
  return {
    uid: b.uid,
    phone: b.phone,
    client_version: b.client_version,
    workspaces: (b.workspaces ?? []).map((w) => ({
      id: w._id,
      title: w.title,
      active: !!w.active,
    })),
  };
}

// ---------------------------------------------------------------------------
// Overview — one cheap call, aggregated across all workspaces.
// ---------------------------------------------------------------------------
export async function overview(ctx) {
  const summary = await ctx.root.dashboardSummary();
  const rows = Array.isArray(summary) ? summary : summary?.summary ?? [];
  return rows.map((s) => ({
    workspace: s.workspace_title,
    workspaceId: s.workspace_id,
    inbox: s.inbox ?? 0,
    unread_chats: s.chat ?? 0,
    tasks: {
      today: s.task?.today ?? 0,
      overdue: s.task?.overdue ?? 0,
      with_time: s.task?.with_time ?? 0,
      no_time: s.task?.no_time ?? 0,
    },
    meetings: Array.isArray(s.meetings) ? s.meetings.length : 0,
  }));
}

// ---------------------------------------------------------------------------
// My tasks — the personal task feed per workspace, normalized.
// ---------------------------------------------------------------------------
function normalizeTask(t, projectTitles, ws, role) {
  return {
    id: t._id,
    title: t.title,
    role, // 'assignee' or 'responsible' — why this is "my" task
    notes: t.notes ? String(t.notes).slice(0, 500) : '',
    workspace: ws.title,
    project: projectTitles.get(t.project) ?? null,
    progress: t.progress ?? 0,
    completed: !!t.completed,
    has_deadline: !!t.has_deadline,
    deadline: t.alarm_at ?? null,
    has_attachments: !!t.has_attachments,
    labels: Array.isArray(t.labels) ? t.labels.length : 0,
    modified_at: t.modified_at ?? null,
    dialog: t.dialog ?? null,
  };
}

// Does a task role field (assignee[] or responsible) reference me?
function references(field, uid) {
  if (field === uid) return true;
  const arr = Array.isArray(field) ? field : [field];
  return arr.some((x) => x && (x === uid || x._id === uid || x.user === uid || x.uid === uid));
}

export async function myTasks(ctx, { workspace, includeCompleted = false } = {}) {
  const uid = ctx.boot.uid;
  const per = await forEachWorkspace(ctx, { workspace }, async (mz, ws) => {
    const [tasks, projects] = await Promise.all([
      mz.allTasks().catch(() => []),
      mz.projects().catch(() => null),
    ]);
    const titles = new Map();
    for (const p of projects?.projects ?? []) titles.set(p._id, p.title);
    // "My task" = I'm an assignee, or I'm the single responsible person.
    // (tasks/getAll returns the whole workspace; we filter to my assignments.)
    const list = [];
    for (const t of Array.isArray(tasks) ? tasks : []) {
      if (t.deleted) continue;
      if (!includeCompleted && t.completed) continue;
      const role = references(t.assignee, uid)
        ? 'assignee'
        : references(t.responsible, uid)
          ? 'responsible'
          : null;
      if (!role) continue;
      list.push(normalizeTask(t, titles, ws, role));
    }
    return list;
  });

  const tasks = per.flatMap((r) => (r.ok ? r.value : []));
  // Open tasks with a deadline first (soonest first), then the rest by recency.
  tasks.sort((a, b) => {
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return String(b.modified_at).localeCompare(String(a.modified_at));
  });
  const errors = per.filter((r) => !r.ok).map((r) => ({ workspace: r.workspace.title, error: r.error }));
  return { count: tasks.length, tasks, errors };
}

// ---------------------------------------------------------------------------
// Unread messages — dialogs with unread messages per workspace.
// ---------------------------------------------------------------------------
export async function unreadMessages(ctx, { workspace } = {}) {
  const per = await forEachWorkspace(ctx, { workspace }, async (mz, ws) => {
    const res = await mz.dialogs();
    const dialogs = res?.dialogs ?? [];
    return dialogs
      .filter((d) => (d.unread_count ?? 0) > 0 || (d.history_unread_count ?? 0) > 0)
      .map((d) => ({
        dialog: d._id,
        title: d.title || (d.is_group ? '(group)' : '(direct message)'),
        workspace: ws.title,
        is_group: !!d.is_group,
        is_project: !!d.is_project_group,
        unread_count: d.unread_count ?? 0,
        history_unread_count: d.history_unread_count ?? 0,
        last_message_date: d.last_message_date ?? null,
      }));
  });

  const conversations = per.flatMap((r) => (r.ok ? r.value : []));
  conversations.sort((a, b) =>
    String(b.last_message_date).localeCompare(String(a.last_message_date)),
  );
  const total_unread = conversations.reduce(
    (n, c) => n + (c.unread_count || c.history_unread_count || 0),
    0,
  );
  const errors = per.filter((r) => !r.ok).map((r) => ({ workspace: r.workspace.title, error: r.error }));
  return { conversations: conversations.length, total_unread, items: conversations, errors };
}
