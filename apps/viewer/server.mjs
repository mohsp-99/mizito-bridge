// Tiny dependency-free viewer server for crawled Mizito data.
//
//   npm run view   ->   http://localhost:4173
//
// Serves viewer/index.html and exposes the crawled JSON under data/ via a small
// read-only API. No build step, no dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../../core/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4173;

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-cache' });
  res.end(body);
}
function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj));
}

// List crawled workspaces (data/ subdirs that have a manifest, skipping _ ones).
function listWorkspaces() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => {
      const manifestPath = path.join(DATA_DIR, d.name, 'manifest.json');
      let manifest = null;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch {}
      return { dir: d.name, manifest };
    })
    .filter((w) => w.manifest);
}

// Safely resolve a file inside data/<ws>/ (prevents path traversal).
function resolveDataFile(ws, rel) {
  const base = path.resolve(DATA_DIR, ws);
  const target = path.resolve(base, rel);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = decodeURIComponent(url.pathname);

  try {
    if (p === '/' || p === '/index.html') {
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'index.html')), 'text/html; charset=utf-8');
    }
    if (p === '/api/workspaces') {
      return sendJson(res, 200, listWorkspaces());
    }
    // /api/ws/<dir>/<file...>
    const m = p.match(/^\/api\/ws\/([^/]+)\/(.+)$/);
    if (m) {
      const file = resolveDataFile(m[1], m[2]);
      if (!file || !fs.existsSync(file)) return sendJson(res, 404, { error: 'not found' });
      return send(res, 200, fs.readFileSync(file));
    }
    return sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    return sendJson(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  const list = listWorkspaces();
  console.log(`\n  Mizito data viewer running:  http://localhost:${PORT}\n`);
  if (list.length) {
    console.log('  Crawled workspaces:');
    for (const w of list) {
      const c = w.manifest.counts || {};
      console.log(`   - ${w.manifest.workspace?.name ?? w.dir}  (tasks ${c.tasks ?? '?'}, members ${c.members ?? '?'}, dialogs ${c.dialogs ?? '?'})`);
    }
  } else {
    console.log('  No crawled data yet — run `npm run crawl` first.');
  }
  console.log('\n  Press Ctrl+C to stop.\n');
});
