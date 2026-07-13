// Crawl a Mizito workspace by name and save it as JSON under data/<workspace>/.
//
//   npm run crawl                 # the account's currently-active workspace
//   npm run crawl -- "Workspace Name"
//   WORKSPACE="Workspace Name" npm run crawl
//
// Looks the workspace up by name, switches to it (Mizito mints a token scoped to
// that workspace — your session is unaffected), then pulls workspace metadata,
// members, projects, labels, dashboards, and every dialog's full message history,
// and extracts the tasks embedded in project chat groups into a normalized
// tasks.json. Works for any workspace on the account, active or not.
import path from 'node:path';
import { createMizito, taskFromMessage } from '@mohsp-99/mizito';
import { requireToken } from '@mohsp-99/mizito';
import { TARGET_WORKSPACE, DATA_DIR } from '@mohsp-99/mizito';
import { writeJson, ensureDir, slug, log } from '@mohsp-99/mizito';

// Workspace name: CLI arg wins, then $WORKSPACE, then the configured default.
// When none is given, crawl the account's currently-active workspace.
const WORKSPACE_NAME = process.argv[2] || TARGET_WORKSPACE;

// Match by exact title, falling back to whitespace/ZWNJ-normalized comparison.
// With no name, fall back to the active workspace.
const norm = (s) => String(s).replace(/[‌\s]+/g, ' ').trim();
function findWorkspace(workspaces, name) {
  if (!name) return workspaces.find((w) => w.active) || workspaces[0];
  return (
    workspaces.find((w) => w.title === name) ||
    workspaces.find((w) => norm(w.title) === norm(name))
  );
}

async function safe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    log.warn(`${label} failed: ${err.message}`);
    return { _error: err.message };
  }
}

async function main() {
  const startedAt = new Date();
  log.info(`Starting crawl${WORKSPACE_NAME ? ` for workspace "${WORKSPACE_NAME}"` : ' (active workspace)'}…`);

  // 1) Bootstrap with the saved session, locate the target workspace by name.
  const base = createMizito({ token: requireToken() });
  const baseBoot = await base.bootstrap();
  const workspaces = baseBoot.workspaces ?? [];
  const target = findWorkspace(workspaces, WORKSPACE_NAME);
  if (!target) {
    log.err(`Workspace "${WORKSPACE_NAME}" not found on this account. Available:`);
    for (const w of workspaces) log.err(`   - ${w.title}`);
    process.exit(1);
  }

  // 2) Switch to it — returns a token scoped to that workspace. Crawl with it.
  // (The switch response shape varies: sometimes {token}, sometimes {data:{token}}.)
  const sw = await base.switchWorkspace(target._id);
  const scopedToken = sw?.token || sw?.data?.token;
  if (!scopedToken) {
    log.err(`Could not switch to workspace "${target.title}" (${target._id}).`);
    process.exit(1);
  }
  const mz = createMizito({ token: scopedToken });
  const bootstrap = await mz.bootstrap();

  const wsName = await safe('workspace/name', () => mz.workspaceName());
  const outDir = path.join(DATA_DIR, slug(target.title));
  ensureDir(outDir);
  log.ok(`Workspace "${target.title}" (${target._id}) selected. Output -> ${outDir}`);

  // 2) Workspace-level data.
  log.info('Fetching workspace metadata, members, projects, labels, dashboards…');
  const [members, projects, summaries, labels, dashboard, workspacesUsers, dialogsResp, planInfo] =
    await Promise.all([
      safe('members', () => mz.members()),
      safe('projects', () => mz.projects()),
      safe('projectSummaries', () => mz.projectSummaries()),
      safe('labels', () => mz.taskLabels()),
      safe('dashboardSummary', () => mz.dashboardSummary()),
      safe('workspacesUsers', () => mz.workspacesUsers()),
      safe('dialogs', () => mz.dialogs()),
      safe('planInfo', () => mz.planInfo()),
    ]);

  writeJson(path.join(outDir, 'workspace.json'), {
    target,
    name: typeof wsName === 'string' ? wsName : wsName,
    bootstrap,
    planInfo,
  });
  writeJson(path.join(outDir, 'members.json'), members);
  writeJson(path.join(outDir, 'projects.json'), projects);
  writeJson(path.join(outDir, 'project-summaries.json'), summaries);
  writeJson(path.join(outDir, 'labels.json'), labels);
  writeJson(path.join(outDir, 'dashboard.json'), { summary: dashboard, workspacesUsers });
  writeJson(path.join(outDir, 'dialogs.json'), dialogsResp);

  const projectList = projects?.projects ?? [];
  log.ok(`${projectList.length} project(s), ${members?.users?.length ?? 0} member(s).`);

  // 3) Build the set of dialogs to crawl: each project's group + listed dialogs.
  const dialogMap = new Map(); // id -> { id, kind, project }
  for (const p of projectList) {
    if (p.dialog) dialogMap.set(p.dialog, { id: p.dialog, kind: 'project', project: p._id, title: p.title });
  }
  for (const d of dialogsResp?.dialogs ?? []) {
    if (d._id && !dialogMap.has(d._id)) dialogMap.set(d._id, { id: d._id, kind: 'dialog', project: null });
  }
  log.info(`Crawling ${dialogMap.size} dialog(s) (full message history)…`);

  // 4) For each dialog: full chat info + paginated history.
  const chatsDir = ensureDir(path.join(outDir, 'chats'));
  const allTasks = new Map(); // taskId -> { task, project, dialog, messageDate, messageId }
  const dialogIndex = [];

  for (const meta of dialogMap.values()) {
    const info = await safe(`fullChat ${meta.id}`, () => mz.fullChat(meta.id));
    const messages = await safe(`history ${meta.id}`, () =>
      mz.fullHistory(meta.id, {
        onPage: ({ total }) => process.stdout.write(`\r   ${meta.title ?? meta.id}: ${total} messages…   `),
      }),
    );
    process.stdout.write('\n');
    const msgArray = Array.isArray(messages) ? messages : [];

    // Extract tasks from this dialog's messages.
    let taskCount = 0;
    for (const m of msgArray) {
      const task = taskFromMessage(m);
      if (!task?._id) continue;
      taskCount++;
      const prev = allTasks.get(task._id);
      // keep the newest message version of a task (messages can repeat on edits)
      if (!prev || new Date(m.date) >= new Date(prev.messageDate)) {
        allTasks.set(task._id, {
          task,
          project: meta.project ?? info?.project_entity ?? null,
          dialog: meta.id,
          messageId: m._id,
          messageDate: m.date,
        });
      }
    }

    writeJson(path.join(chatsDir, `${meta.id}.json`), {
      meta,
      info,
      messageCount: msgArray.length,
      taskMessageCount: taskCount,
      messages: msgArray,
    });
    dialogIndex.push({
      id: meta.id,
      kind: meta.kind,
      project: meta.project,
      title: info?.title ?? meta.title ?? null,
      isProjectGroup: info?.is_project_group ?? false,
      messages: msgArray.length,
      taskMessages: taskCount,
    });
    log.ok(`${info?.title ?? meta.id}: ${msgArray.length} messages, ${taskCount} task message(s).`);
  }

  // 5) Normalized tasks.json (deduped by task id).
  const tasks = [...allTasks.values()].map((t) => ({
    ...t.task,
    _project: t.project,
    _dialog: t.dialog,
    _messageId: t.messageId,
    _messageDate: t.messageDate,
  }));
  writeJson(path.join(outDir, 'tasks.json'), tasks);

  // 5b) Full comment threads for every task that has comments.
  const commented = tasks.filter((t) => t.has_comments && t.access_token);
  const comments = [];
  let totalComments = 0;
  if (commented.length) {
    log.info(`Fetching comment threads for ${commented.length} task(s)…`);
    for (const t of commented) {
      const thread = await safe(`comments ${t._id}`, () => mz.taskComments(t.access_token));
      const list = Array.isArray(thread) ? thread : [];
      totalComments += list.length;
      comments.push({ task_id: t._id, project: t._project ?? null, count: list.length, comments: list });
      process.stdout.write(`\r   ${comments.length}/${commented.length} threads, ${totalComments} comments…   `);
    }
    process.stdout.write('\n');
  }
  writeJson(path.join(outDir, 'comments.json'), comments);
  log.ok(`${totalComments} comment(s) across ${commented.length} task(s).`);

  // 6) Manifest for the viewer / future reference.
  const manifest = {
    workspace: { name: target.title, id: target._id },
    crawledAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    counts: {
      projects: projectList.length,
      members: members?.users?.length ?? 0,
      dialogs: dialogIndex.length,
      tasks: tasks.length,
      messages: dialogIndex.reduce((a, d) => a + d.messages, 0),
      comments: totalComments,
    },
    dialogs: dialogIndex,
    files: {
      workspace: 'workspace.json',
      members: 'members.json',
      projects: 'projects.json',
      projectSummaries: 'project-summaries.json',
      labels: 'labels.json',
      dashboard: 'dashboard.json',
      dialogs: 'dialogs.json',
      tasks: 'tasks.json',
      comments: 'comments.json',
      chats: 'chats/<dialogId>.json',
    },
  };
  writeJson(path.join(outDir, 'manifest.json'), manifest);

  log.ok('Crawl complete.');
  log.info(`  projects: ${manifest.counts.projects}`);
  log.info(`  members:  ${manifest.counts.members}`);
  log.info(`  dialogs:  ${manifest.counts.dialogs}`);
  log.info(`  messages: ${manifest.counts.messages}`);
  log.info(`  tasks:    ${manifest.counts.tasks}`);
  log.info(`  comments: ${manifest.counts.comments}`);
  log.info(`  -> ${outDir}`);
}

main().catch((err) => {
  log.err(err.stack || String(err));
  process.exit(1);
});
