// Download the file attachments referenced by a crawl.
//
//   npm run files                 # download files for every crawled workspace
//   npm run files -- "Workspace Name"   # one workspace (by data/ folder name or title)
//   MAX_MB=20 npm run files       # skip files larger than 20 MB
//
// Files are served from https://app.mizito.ir/cdn/<content-token>. The content
// token is workspace-scoped, so the request needs that workspace's session token
// in the x-token header (otherwise the CDN returns a tiny "invalid" stub). We get
// a scoped token by switching to the workspace, exactly like the crawler.
// Downloads are idempotent: a file already on disk with the right size is skipped
// (safe to re-run / resume). Note the content tokens expire, so run this soon
// after a crawl — re-crawl if downloads start failing with auth errors.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '@mohsp-99/mizito';
import { extractFiles } from '@mohsp-99/mizito';
import { createMizito } from '@mohsp-99/mizito';
import { requireToken } from '@mohsp-99/mizito';
import { readJson, ensureDir, writeJson, exists, slug, log } from '@mohsp-99/mizito';

const CDN = 'https://app.mizito.ir/cdn/';
const CONCURRENCY = 4;
const MAX_BYTES = process.env.MAX_MB ? Number(process.env.MAX_MB) * 1024 * 1024 : Infinity;
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity; // cap file count

function workspaceDirs(filterName) {
  if (!exists(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .filter((name) => !filterName || name === filterName ||
      readJson(path.join(DATA_DIR, name, 'manifest.json'), {})?.workspace?.name === filterName);
}

// Where a file lands: files/tasks/<taskId>/<name> or files/chats/<dialogId>/<name>.
function targetPath(base, f) {
  const bucket = f.task_id ? path.join('tasks', f.task_id) : (f.dialog_id ? path.join('chats', f.dialog_id) : 'misc');
  let name = slug(f.name).replace(/_/g, ' ').trim() || f.id;
  // keep the extension readable; prefix nothing unless a collision occurs
  return path.join(base, 'files', bucket, name);
}

async function downloadOne(f, base, token) {
  const dest = targetPath(base, f);
  if (!f.content_token) return { ...f, status: 'no-token' };
  if (f.size != null && f.size > MAX_BYTES) return { ...f, dest, status: 'skip-large' };
  if (exists(dest) && (f.size == null || fs.statSync(dest).size === f.size)) return { ...f, dest, status: 'cached' };

  ensureDir(path.dirname(dest));
  const res = await fetch(CDN + f.content_token, { headers: { 'x-token': token } });
  if (!res.ok) return { ...f, dest, status: `http-${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer());
  const ok = f.size == null || buf.length === f.size;
  if (!ok) return { ...f, dest, bytes: buf.length, status: 'size-mismatch' };
  fs.writeFileSync(dest, buf);
  return { ...f, dest, bytes: buf.length, status: 'ok' };
}

// Minimal promise pool.
async function pool(items, worker, n) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx).catch((err) => ({ ...items[idx], status: 'error', error: err.message }));
    }
  });
  await Promise.all(runners);
  return results;
}

async function downloadWorkspace(dir, mizitoBase) {
  const base = path.join(DATA_DIR, dir);
  const manifest = readJson(path.join(base, 'manifest.json'), {});
  let files = extractFiles(base);
  if (Number.isFinite(LIMIT)) files = files.slice(0, LIMIT);
  const totalBytes = files.reduce((a, f) => a + (f.size || 0), 0);
  log.info(`"${manifest.workspace?.name ?? dir}": ${files.length} file(s)${Number.isFinite(LIMIT) ? ' (LIMIT)' : ''}, ${(totalBytes / 1048576).toFixed(1)} MB.`);

  // Scoped token for this workspace's CDN files.
  const sw = await mizitoBase.switchWorkspace(manifest.workspace.id);
  const token = sw?.token;
  if (!token) { log.err(`Could not get a token for "${manifest.workspace?.name ?? dir}".`); return []; }

  let done = 0;
  const results = await pool(files, async (f) => {
    const r = await downloadOne(f, base, token);
    done++;
    process.stdout.write(`\r   ${done}/${files.length}  (${r.status})  ${String(f.name).slice(0, 40)}            `);
    return r;
  }, CONCURRENCY);
  process.stdout.write('\n');

  const by = (s) => results.filter((r) => r.status === s).length;
  const downloaded = (s) => s === 'ok' || s === 'cached';
  const index = results.map((r) => ({
    id: r.id, name: r.name, size: r.size, status: r.status,
    // forward-slash relative path so it works as a URL in the viewer
    path: r.dest && downloaded(r.status) ? path.relative(base, r.dest).split(path.sep).join('/') : null,
    source_type: r.source_type, task_id: r.task_id, dialog_id: r.dialog_id,
  }));
  writeJson(path.join(base, 'files', 'index.json'), index);

  log.ok(`${manifest.workspace?.name ?? dir}: downloaded ${by('ok')}, cached ${by('cached')}, ` +
    `skipped-large ${by('skip-large')}, failed ${results.length - by('ok') - by('cached') - by('skip-large')}.`);
  return results;
}

async function main() {
  const filter = process.argv[2] || null;
  const dirs = workspaceDirs(filter);
  if (!dirs.length) {
    log.err(filter ? `No crawled workspace matches "${filter}".` : 'No crawled workspaces. Run `npm run crawl` first.');
    process.exit(1);
  }
  const mizitoBase = createMizito({ token: requireToken() });
  for (const dir of dirs) await downloadWorkspace(dir, mizitoBase);
  log.info('Files are under data/<workspace>/files/ (index.json maps them to tasks/dialogs).');
}

main().catch((err) => {
  log.err(err.stack || String(err));
  process.exit(1);
});
