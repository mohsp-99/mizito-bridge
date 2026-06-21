// Endpoint probe: try a list of candidate endpoint+payload combos and report
// which ones the API accepts. Handy for discovering endpoints whose names the
// bundle builds dynamically.
//
//   node scripts/probe.mjs
import { createClient, MizitoApiError } from '../../core/http.js';
import { requireToken } from '../../core/auth.js';

const PROJECT_ID = process.env.PROJECT_ID || '675185f20050a49165b09579';
const BOARD_ID = process.env.BOARD_ID || '6751ab2aab9f991d709a3efc';

// [endpoint, payload]
const CANDIDATES = [
  ['tasks/getList', { project: PROJECT_ID }],
  ['tasks/getList', { projectId: PROJECT_ID }],
  ['tasks/getList', { pid: PROJECT_ID }],
  ['tasks/list', { project: PROJECT_ID }],
  ['tasks/get', { project: PROJECT_ID }],
  ['tasks/project', { project: PROJECT_ID }],
  ['tasks/project', { id: PROJECT_ID }],
  ['tasks/proj', { project: PROJECT_ID }],
  ['tasks/load', { project: PROJECT_ID }],
  ['tasks/all', { project: PROJECT_ID }],
  ['tasks/tasks', { project: PROJECT_ID }],
  ['projects/get', { id: PROJECT_ID }],
  ['projects/get', { project: PROJECT_ID }],
  ['projects/getOne', { id: PROJECT_ID }],
  ['projects/load', { id: PROJECT_ID }],
  ['projects/open', { id: PROJECT_ID }],
  ['projects/getTasks', { id: PROJECT_ID }],
  ['projects/getTasks', { project: PROJECT_ID }],
  ['board/getTasks', { board: BOARD_ID }],
  ['board/get', { id: BOARD_ID }],
  ['kanban/getTasks', { board: BOARD_ID }],
  ['kanban/get', { project: PROJECT_ID }],
  ['tasks/getByBoard', { board: BOARD_ID }],
  ['tasks/kanban', { project: PROJECT_ID }],
];

const client = createClient({ token: requireToken(), pacingMs: 120 });

function describe(data) {
  if (data == null) return 'null';
  if (Array.isArray(data)) return `array[${data.length}]`;
  if (typeof data === 'object') return `object{${Object.keys(data).slice(0, 8).join(',')}}`;
  return typeof data;
}

for (const [ep, payload] of CANDIDATES) {
  try {
    const data = await client.call(ep, payload, { raw: true });
    const status = data && typeof data === 'object' ? data.status : undefined;
    const ok = status === 1 || status === true;
    const inner = ok ? (data.data !== undefined ? data.data : data) : data;
    const tag = ok ? 'OK ' : `st=${status ?? '?'} `;
    console.log(`${ok ? '✓' : '·'} ${tag.padEnd(7)} ${ep.padEnd(22)} ${JSON.stringify(payload).padEnd(30)} -> ${describe(inner)}${data?.msg ? ' msg=' + data.msg : ''}`);
  } catch (err) {
    const code = err instanceof MizitoApiError ? err.httpStatus : err.message;
    console.log(`✗ HTTP    ${ep.padEnd(22)} ${JSON.stringify(payload).padEnd(30)} -> ${code}`);
  }
}
