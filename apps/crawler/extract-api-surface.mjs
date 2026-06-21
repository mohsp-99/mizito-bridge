// Extract the API surface from the Mizito SPA bundle.
//
//   npm run extract   (or: node scripts/extract-api-surface.mjs)
//
// The data endpoints are called as `apiHelper("<group>/<action>")` against the
// /api base, so the endpoint names exist as plain string literals in the bundle
// even though the full URLs are built at runtime. This downloads the bundle and
// lists every `group/action`-shaped literal, grouped, to data/_discovery/.
import path from 'node:path';
import { WEB_BASE, DATA_DIR } from '../../core/config.js';
import { ensureDir, writeJson, log } from '../../core/util.js';

const BUNDLE = `${WEB_BASE}/a_.js`;
const OUT = path.join(DATA_DIR, '_discovery', 'api-surface.json');

// group/action where group is a known API namespace. Keep this list broad.
const GROUPS = [
  'workspace', 'projects', 'project', 'tasks', 'task', 'dashboard', 'chat',
  'inbox', 'session', 'user', 'users', 'board', 'kanban', 'meeting', 'meetings',
  'calendar', 'comment', 'comments', 'attachment', 'file', 'content', 'label',
  'support', 'feedback', 'crm', 'report', 'notification', 'gantt', 'subtask',
];

async function main() {
  log.info(`Downloading bundle ${BUNDLE} ...`);
  const res = await fetch(BUNDLE);
  const text = await res.text();
  log.info(`Bundle is ${(text.length / 1e6).toFixed(1)} MB; scanning...`);

  const re = /["'`]([a-zA-Z][a-zA-Z0-9_]*\/[a-zA-Z][a-zA-Z0-9_]*)["'`]/g;
  const byGroup = {};
  let m;
  while ((m = re.exec(text))) {
    const ep = m[1];
    const group = ep.split('/')[0];
    if (!GROUPS.includes(group)) continue;
    (byGroup[group] ??= new Set()).add(ep);
  }

  const result = {};
  let total = 0;
  for (const g of Object.keys(byGroup).sort()) {
    result[g] = [...byGroup[g]].sort();
    total += result[g].length;
  }

  ensureDir(path.dirname(OUT));
  writeJson(OUT, result);
  log.ok(`Found ${total} endpoint-shaped literals across ${Object.keys(result).length} groups -> ${OUT}`);
  for (const g of Object.keys(result)) log.info(`  ${g}: ${result[g].length}`);
}

main().catch((err) => {
  log.err(err.stack || String(err));
  process.exit(1);
});
