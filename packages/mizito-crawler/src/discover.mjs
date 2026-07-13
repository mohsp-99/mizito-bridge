// API discovery.
//
//   npm run discover
//
// Re-opens a browser using the saved session and records every /capi request
// the SPA makes while you click around the target workspace (projects, tasks,
// members, chat, calendar...). It writes a catalogue of endpoint signatures
// plus a sample request payload and response shape for each — the raw material
// for building crawl.mjs.
//
// Browse the parts of the workspace you want crawled, then close the window
// (or wait for the idle timeout) and the catalogue is saved.
import path from 'node:path';
import { chromium } from 'playwright';
import { WEB_BASE, STORAGE_STATE_PATH, DATA_DIR, API_PREFIX } from '@mohsp-99/mizito';
import { exists, ensureDir, writeJson, log, sleep } from '@mohsp-99/mizito';

const OUT_DIR = path.join(DATA_DIR, '_discovery');
const IDLE_TIMEOUT_MS = 90 * 1000; // stop after this much inactivity

// Hash routes the SPA exposes (from the bundle). Visiting each one unattended
// triggers its data-loading /capi calls so we capture the bootstrap surface
// without needing manual clicks. You can still click around on top of this.
const AUTO_ROUTES = [
  '#/projects',
  '#/projects/monitor',
  '#/tasks',
  '#/monitoring/users',
  '#/monitoring/tasks',
  '#/project/monitor/tasks',
  '#/project/monitor/calendar',
];
const HEADLESS = process.env.HEADLESS === '1';
const AUTO = process.env.AUTO !== '0'; // auto-drive routes unless disabled

function endpointKey(url, method) {
  const u = new URL(url);
  return `${method} ${u.pathname}`;
}

function summarizeShape(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return [value.length ? summarizeShape(value[0], depth + 1) : 'any'];
  }
  if (typeof value === 'object') {
    if (depth > 2) return '{…}';
    const out = {};
    for (const k of Object.keys(value).slice(0, 40)) out[k] = summarizeShape(value[k], depth + 1);
    return out;
  }
  return typeof value;
}

async function main() {
  if (!exists(STORAGE_STATE_PATH)) {
    log.err('No saved session. Run `npm run login` first.');
    process.exit(1);
  }
  ensureDir(OUT_DIR);

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ storageState: STORAGE_STATE_PATH, locale: 'fa-IR' });
  const page = await context.newPage();

  const catalogue = new Map(); // key -> signature
  let lastActivity = Date.now();

  context.on('response', async (response) => {
    const req = response.request();
    const url = req.url();
    if (!url.includes('app.mizito.ir/') || !/\/c?api\//.test(url)) return;
    lastActivity = Date.now();

    const method = req.method();
    const key = endpointKey(url, method);

    let reqBody;
    try {
      reqBody = req.postDataJSON?.();
    } catch {
      reqBody = req.postData?.();
    }

    let resJson;
    try {
      const text = await response.text();
      resJson = text ? JSON.parse(text) : undefined;
    } catch {
      resJson = undefined;
    }

    const existing = catalogue.get(key);
    const entry = existing ?? {
      key,
      method,
      path: new URL(url).pathname,
      count: 0,
      httpStatus: response.status(),
      sampleRequest: reqBody,
      responseShape: resJson !== undefined ? summarizeShape(resJson) : undefined,
    };
    entry.count += 1;
    if (entry.sampleRequest === undefined && reqBody !== undefined) entry.sampleRequest = reqBody;
    if (entry.responseShape === undefined && resJson !== undefined) {
      entry.responseShape = summarizeShape(resJson);
    }
    catalogue.set(key, entry);
  });

  let closed = false;
  browser.on('disconnected', () => {
    closed = true;
  });

  log.info('Opening workspace and recording all /capi calls.');
  await page.goto(WEB_BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(3000); // let the bootstrap calls settle

  if (AUTO) {
    log.info('Auto-driving main routes to trigger their data calls...');
    for (const route of AUTO_ROUTES) {
      if (closed) break;
      try {
        await page.goto(WEB_BASE + '/' + route, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await sleep(2500);
        log.info(`  visited ${route}`);
      } catch (err) {
        log.warn(`  ${route}: ${err.message}`);
      }
    }
  }

  if (!HEADLESS) {
    log.info('Auto-drive done. Click through anything else you want captured.');
    log.info('Close the window (or stop interacting) to finish.');
  }

  // Run until the browser is closed or the page goes idle. Headless/unattended
  // runs settle quickly; interactive runs wait longer for you to keep clicking.
  const idleLimit = HEADLESS ? 6000 : IDLE_TIMEOUT_MS;
  while (!closed && Date.now() - lastActivity < idleLimit) {
    await sleep(1000);
  }

  const entries = [...catalogue.values()].sort((a, b) => a.key.localeCompare(b.key));
  writeJson(path.join(OUT_DIR, 'endpoints.json'), entries);
  log.ok(`Captured ${entries.length} distinct endpoints -> data/_discovery/endpoints.json`);
  for (const e of entries) log.info(`  ${e.key}  (x${e.count})`);

  if (!closed) await browser.close();
}

main().catch((err) => {
  log.err(err.stack || String(err));
  process.exit(1);
});
