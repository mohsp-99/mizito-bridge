// Deterministic capture of the per-project endpoints: open the app, click into
// the target project (and a board/task), and record the exact /api requests +
// payloads the SPA fires. Writes full request/response pairs so we can read off
// the real task-loading endpoint and its payload shape.
//
//   node scripts/capture-project.mjs            (headed, you can click too)
//   HEADLESS=1 node scripts/capture-project.mjs (unattended)
import path from 'node:path';
import { chromium } from 'playwright';
import { WEB_BASE, STORAGE_STATE_PATH, DATA_DIR } from '@mohsp-99/mizito';
import { ensureDir, writeJson, log, sleep } from '@mohsp-99/mizito';

const HEADLESS = process.env.HEADLESS === '1';
const PROJECT_TITLE = process.env.PROJECT_TITLE || 'تحقیق و ‌طراحی';
const OUT = path.join(DATA_DIR, '_discovery', 'project-capture.json');

const calls = [];
function record(label, req, resJson, status) {
  let body;
  try { body = req.postDataJSON?.(); } catch { body = req.postData?.(); }
  calls.push({
    label,
    method: req.method(),
    path: new URL(req.url()).pathname,
    request: body,
    httpStatus: status,
    responseSample: sample(resJson),
  });
}
function sample(v, depth = 0) {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice(0, 1).map((x) => sample(x, depth + 1));
  if (depth > 3) return '{…}';
  const o = {};
  for (const k of Object.keys(v).slice(0, 30)) o[k] = sample(v[k], depth + 1);
  return o;
}

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ storageState: STORAGE_STATE_PATH, locale: 'fa-IR' });
const page = await ctx.newPage();

ctx.on('response', async (response) => {
  const req = response.request();
  const url = req.url();
  if (!url.includes('app.mizito.ir/') || !/\/c?api\//.test(url)) return;
  let json;
  try { json = JSON.parse(await response.text()); } catch { json = undefined; }
  record('passive', req, json, response.status());
});

log.info('Loading app...');
await page.goto(WEB_BASE, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await sleep(3000);

// Go to the projects list (correct SPA route discovered from the DOM).
log.info('Navigating to #/ws/projects/all ...');
await page.goto(WEB_BASE + '/#/ws/projects/all', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await sleep(3500);

// Click the project by its title.
log.info(`Opening project "${PROJECT_TITLE}"...`);
const markBefore = calls.length;
try {
  const el = page.getByText(PROJECT_TITLE, { exact: false }).first();
  await el.click({ timeout: 8000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(4000);
  log.ok(`Clicked project. URL=${page.url()}`);
  for (let i = markBefore; i < calls.length; i++) calls[i].label = 'after-project-click';
} catch (err) {
  log.warn(`Could not click project automatically: ${err.message}`);
}

// Try opening the first task card to capture task-detail endpoints.
const markCard = calls.length;
try {
  const card = page.locator('[class*="task"],[class*="card"],[class*="kanban"] [class*="title"]').first();
  await card.click({ timeout: 5000 });
  await sleep(3000);
  log.ok('Clicked a card.');
  for (let i = markCard; i < calls.length; i++) calls[i].label = 'after-card-click';
} catch (err) {
  log.warn(`No card click: ${err.message}`);
}

if (!HEADLESS) {
  log.info('Browser left open 40s — click into tasks/boards to capture more.');
  await sleep(40000);
}

ensureDir(path.dirname(OUT));
writeJson(OUT, calls);
log.ok(`Captured ${calls.length} /api calls -> ${OUT}`);
const uniq = [...new Set(calls.map((c) => `${c.method} ${c.path}`))].sort();
for (const u of uniq) log.info(`  ${u}`);
await browser.close();
