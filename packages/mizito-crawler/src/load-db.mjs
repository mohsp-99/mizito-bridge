// Load crawled workspace JSON into a SQLite database (db/mizito.db).
//
//   npm run db                 # load every crawled workspace under data/
//   npm run db -- "Workspace Name"   # load one workspace (by its data/ folder name or title)
//
// Uses Node's built-in node:sqlite (no native dependency). Re-running is
// idempotent per workspace: existing rows for that workspace are deleted, then
// re-inserted from the latest crawl. This is the "simple" store to build on.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ROOT } from '@mohsp-99/mizito-core';
import { taskFromMessage } from '@mohsp-99/mizito-core';
import { extractFiles } from '@mohsp-99/mizito-core';
import { readJson, exists, ensureDir, log } from '@mohsp-99/mizito-core';

const DB_PATH = path.join(ROOT, 'db', 'mizito.db');
const SCHEMA_PATH = path.join(ROOT, 'db', 'schema.sql');
const bool = (v) => (v ? 1 : 0);

function workspaceDirs(filterName) {
  if (!exists(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .filter((name) => {
      if (!filterName) return true;
      return name === filterName || readJson(path.join(DATA_DIR, name, 'manifest.json'), {})?.workspace?.name === filterName;
    });
}

function loadWorkspace(db, dir, stmts) {
  const base = path.join(DATA_DIR, dir);
  const manifest = readJson(path.join(base, 'manifest.json'));
  const wsId = manifest.workspace.id;
  const wsName = manifest.workspace.name;
  log.info(`Loading "${wsName}" (${wsId})…`);

  // Idempotency: clear this workspace from every table first.
  db.prepare('DELETE FROM workspace WHERE id = ?').run(wsId);
  for (const t of ['member', 'project', 'board', 'label', 'task', 'task_assignee', 'task_label', 'comment', 'dialog', 'message', 'file']) {
    db.prepare(`DELETE FROM ${t} WHERE workspace_id = ?`).run(wsId);
  }

  const workspace = readJson(path.join(base, 'workspace.json'), {});
  const members = readJson(path.join(base, 'members.json'), { users: [] });
  const projects = readJson(path.join(base, 'projects.json'), { projects: [] });
  const labels = readJson(path.join(base, 'labels.json'), { labels: [] });
  const tasks = readJson(path.join(base, 'tasks.json'), []);
  const plan = workspace.planInfo || {};

  stmts.workspace.run(
    wsId, wsName, manifest.crawledAt ?? null,
    plan.used ?? null, plan.volume ?? null, plan.remain_days ?? null,
    manifest.counts?.members ?? null, manifest.counts?.projects ?? null,
    manifest.counts?.tasks ?? null, manifest.counts?.messages ?? null,
  );

  for (const u of members.users || []) {
    stmts.member.run(u._id, wsId, u.first_name ?? null, u.last_name ?? null, u.email ?? null, u.role ?? null, bool(u.deleted), bool(u.invited));
  }

  for (const p of projects.projects || []) {
    stmts.project.run(p._id, wsId, p.title ?? null, bool(p.is_advanced), bool(p.archived), p.owner ?? null, p.dialog ?? null);
    for (const b of p.kanban_boards || []) {
      stmts.board.run(b._id, wsId, p._id, b.title ?? null, b.color ?? null);
    }
  }

  for (const l of labels.labels || []) {
    stmts.label.run(l._id, wsId, l.title ?? null, l.color ?? null, l.type ?? null, bool(l.deleted));
  }

  for (const t of tasks) {
    const lc = t.last_comment || null;
    stmts.task.run(
      t._id, wsId, t._project ?? t.project ?? null, t.kanban_board ?? null,
      t.title ?? null, t.notes ?? null, t.owner ?? null, t.progress ?? null,
      bool(t.completed), t.completed_at ?? null, t.created_at ?? null, t.modified_at ?? null,
      bool(t.has_deadline), t.deadline ?? null, t.dialog ?? t._dialog ?? null, t.dialog_message ?? null,
      bool(t.has_comments), lc?.comment ?? null, lc?.comment_owner ?? null, lc?.comment_at ?? null,
      JSON.stringify(t),
    );
    for (const a of t.assignee || []) stmts.taskAssignee.run(wsId, t._id, a);
    for (const lid of t.labels || []) stmts.taskLabel.run(wsId, t._id, lid);
  }

  // full comment threads
  const commentThreads = readJson(path.join(base, 'comments.json'), []);
  for (const entry of commentThreads) {
    for (const cm of entry.comments || []) {
      stmts.comment.run(
        cm._id, wsId, entry.task_id, cm.comment_owner ?? null, cm.comment ?? null,
        cm.comment_at ?? null, cm.replied_comment_id ?? null, bool(cm.edited), bool(cm.deleted),
        (cm.attachments || []).length,
      );
    }
  }

  // dialogs + messages
  for (const di of manifest.dialogs || []) {
    stmts.dialog.run(di.id, wsId, di.title ?? null, di.kind ?? null, bool(di.isProjectGroup), di.project ?? null, di.messages ?? null, di.taskMessages ?? null);
    const chatFile = path.join(base, 'chats', `${di.id}.json`);
    if (!exists(chatFile)) continue;
    const chat = readJson(chatFile, { messages: [] });
    for (const m of chat.messages || []) {
      const task = taskFromMessage(m);
      const type = m._ === 'messageService' || m.action ? 'service' : (m.media?._ || (m.message ? 'text' : 'other'));
      const text = m.message ?? m.text ?? m.body ?? (m.media?.caption ?? null);
      stmts.message.run(m._id, wsId, di.id, m.from ?? null, m.date ?? null, type, text, task?._id ?? null);
    }
  }

  // files (single source of truth via the shared extractor); join in local paths
  // from a prior `npm run files` download, if present.
  const fileIndex = new Map();
  for (const r of readJson(path.join(base, 'files', 'index.json'), [])) fileIndex.set(r.id, r);
  for (const f of extractFiles(base)) {
    const local = fileIndex.get(f.id);
    const downloaded = local && (local.status === 'ok' || local.status === 'cached') ? 1 : 0;
    stmts.file.run(f.id, wsId, f.name, f.size, f.content_token, f.content_key, f.source_type, f.source_id, f.dialog_id, f.task_id, downloaded ? local.path : null, downloaded);
  }

  return manifest.counts;
}

function main() {
  const filter = process.argv[2] || null;
  const dirs = workspaceDirs(filter);
  if (!dirs.length) {
    log.err(filter ? `No crawled workspace matches "${filter}".` : 'No crawled workspaces under data/. Run `npm run crawl` first.');
    process.exit(1);
  }

  ensureDir(path.dirname(DB_PATH));
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

  const stmts = {
    workspace: db.prepare('INSERT INTO workspace VALUES (?,?,?,?,?,?,?,?,?,?)'),
    member: db.prepare('INSERT INTO member VALUES (?,?,?,?,?,?,?,?)'),
    project: db.prepare('INSERT INTO project VALUES (?,?,?,?,?,?,?)'),
    board: db.prepare('INSERT INTO board VALUES (?,?,?,?,?)'),
    label: db.prepare('INSERT INTO label VALUES (?,?,?,?,?,?)'),
    task: db.prepare('INSERT INTO task VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
    taskAssignee: db.prepare('INSERT INTO task_assignee VALUES (?,?,?)'),
    taskLabel: db.prepare('INSERT INTO task_label VALUES (?,?,?)'),
    comment: db.prepare('INSERT OR IGNORE INTO comment VALUES (?,?,?,?,?,?,?,?,?,?)'),
    dialog: db.prepare('INSERT INTO dialog VALUES (?,?,?,?,?,?,?,?)'),
    message: db.prepare('INSERT OR IGNORE INTO message VALUES (?,?,?,?,?,?,?,?)'),
    file: db.prepare('INSERT INTO file VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'),
  };

  let totals = { workspaces: 0, tasks: 0, messages: 0 };
  db.exec('BEGIN');
  try {
    for (const dir of dirs) {
      const c = loadWorkspace(db, dir, stmts);
      totals.workspaces++; totals.tasks += c?.tasks ?? 0; totals.messages += c?.messages ?? 0;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // report
  const q = (sql) => db.prepare(sql).get().n;
  log.ok(`Loaded ${totals.workspaces} workspace(s) -> ${path.relative(ROOT, DB_PATH)}`);
  for (const t of ['workspace', 'member', 'project', 'board', 'label', 'task', 'comment', 'dialog', 'message', 'file']) {
    log.info(`  ${t.padEnd(9)} ${q(`SELECT COUNT(*) n FROM ${t}`)}`);
  }
  db.close();
}

main();
