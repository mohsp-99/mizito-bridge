#!/usr/bin/env node
// mizito-bridge CLI dispatcher.
//
// A single entry point (`mizito <command>`) over the app scripts, so the package
// works via `npx @mohsp-99/mizito-bridge <command>` or a global install.
//
//   mizito login          sign in via a real browser (saves the session)
//   mizito mcp            run the MCP server over stdio (for Claude Desktop/Code)
//   mizito projects       list projects/boards in the active workspace
//   mizito crawl [ws]     crawl a workspace snapshot to data/
//   mizito files [ws]     download a crawled workspace's attachments
//   mizito db [ws]        load crawled JSON into SQLite
//   mizito view           browse crawled data at http://localhost:4173
//   mizito api <ep> [json]  call any endpoint with the saved session
//   mizito discover       record live /api traffic (maintenance)
//   mizito extract        list endpoint literals from the JS bundle (maintenance)
//   mizito write-probe    live-test the write endpoints (creates + deletes test data)
//   mizito help           show this help
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// command -> script, relative to the package root.
const COMMANDS = {
  login: 'apps/crawler/login.mjs',
  mcp: 'apps/mcp/index.mjs',
  projects: 'apps/crawler/projects.mjs',
  crawl: 'apps/crawler/crawl.mjs',
  files: 'apps/crawler/download-files.mjs',
  db: 'apps/crawler/load-db.mjs',
  view: 'apps/viewer/server.mjs',
  api: 'apps/crawler/api.mjs',
  discover: 'apps/crawler/discover.mjs',
  extract: 'apps/crawler/extract-api-surface.mjs',
  'write-probe': 'apps/crawler/write-probe.mjs',
};

// db is loaded with --no-warnings (uses the experimental node:sqlite).
const NODE_FLAGS = { db: ['--no-warnings'] };

function help() {
  const lines = [
    'mizito-bridge — bridge your Mizito workspace to AI assistants and local tooling',
    '',
    'Usage: mizito <command> [args]',
    '',
    'Commands:',
    '  login          sign in via a real browser (saves the session)',
    '  mcp            run the MCP server over stdio (Claude Desktop / Claude Code)',
    '  projects       list projects & boards in the active workspace',
    '  crawl [ws]     crawl a workspace snapshot to data/',
    '  files [ws]     download a crawled workspace\'s attachments',
    '  db [ws]        load crawled JSON into SQLite',
    '  view           browse crawled data at http://localhost:4173',
    '  api <ep> [json]  call any endpoint with the saved session',
    '  discover       record live /api traffic (maintenance)',
    '  extract        list endpoint literals from the JS bundle (maintenance)',
    '  write-probe    live-test the write endpoints (creates + deletes test data)',
    '  help           show this help',
  ];
  console.log(lines.join('\n'));
}

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  help();
  process.exit(0);
}

const script = COMMANDS[cmd];
if (!script) {
  console.error(`Unknown command: ${cmd}\n`);
  help();
  process.exit(1);
}

const args = [...(NODE_FLAGS[cmd] ?? []), path.join(ROOT, script), ...rest];
const child = spawn(process.execPath, args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error(`Failed to run "${cmd}":`, err.message);
  process.exit(1);
});
