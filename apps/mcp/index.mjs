// Mizito MCP server (read-only).
//
// Exposes a Claude (Desktop/Code) client a few personal, read-only views of the
// signed-in Mizito account: who am I + my workspaces, a quick overview, the
// tasks awaiting me, and conversations with unread messages. Data is pulled live
// from Mizito's API using the session saved by `npm run login` (see core/auth.js)
// — nothing here writes or mutates anything.
//
// Transport is stdio: the JSON-RPC protocol owns stdout, so this file must NEVER
// write to stdout (use console.error / stderr for diagnostics only).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  buildContext,
  identity,
  overview,
  myTasks,
  unreadMessages,
} from '../../core/feed.js';

// Return a tool result carrying a JSON payload as pretty text. MCP clients show
// the text; the JSON keeps it machine-readable for Claude to reason over.
function json(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function failure(err) {
  const message = String(err?.message || err);
  return {
    isError: true,
    content: [{ type: 'text', text: `Mizito request failed: ${message}` }],
  };
}

// Every tool starts from a fresh context (a cheap `workspace/userId` bootstrap)
// so workspace tokens are always current — the server process is long-lived and
// cached tokens would eventually expire.
async function withContext(run) {
  try {
    const ctx = await buildContext();
    return json(await run(ctx));
  } catch (err) {
    return failure(err);
  }
}

const server = new McpServer({ name: 'mizito', version: '0.1.0' });

server.registerTool(
  'mizito_whoami',
  {
    title: 'Who am I (Mizito)',
    description:
      'Identify the signed-in Mizito user and list their workspaces (id, title, ' +
      'which one is active). Use this to discover workspace names to pass to the ' +
      'other tools, or to confirm the session is valid.',
    inputSchema: {},
  },
  () => withContext((ctx) => identity(ctx)),
);

server.registerTool(
  'mizito_overview',
  {
    title: 'Mizito overview',
    description:
      'A quick, cheap summary across all of my Mizito workspaces: per workspace, ' +
      'the inbox count, number of chats with unread messages, and task counts ' +
      '(due today, overdue, scheduled, and undated). Good first call to answer ' +
      '"what needs my attention?" before drilling into tasks or messages.',
    inputSchema: {},
  },
  () => withContext((ctx) => overview(ctx)),
);

server.registerTool(
  'mizito_my_tasks',
  {
    title: 'My Mizito tasks',
    description:
      'List the tasks assigned to / awaiting me across my Mizito workspaces, ' +
      'newest deadlines first. Each task includes title, workspace, project ' +
      '(when known), progress, deadline, and whether it has attachments. By ' +
      'default only open (not completed) tasks are returned.',
    inputSchema: {
      workspace: z
        .string()
        .optional()
        .describe('Limit to a single workspace by exact title or id. Omit for all workspaces.'),
      include_completed: z
        .boolean()
        .optional()
        .describe('Include completed tasks too (default false).'),
    },
  },
  (args) =>
    withContext((ctx) =>
      myTasks(ctx, { workspace: args?.workspace, includeCompleted: args?.include_completed ?? false }),
    ),
);

server.registerTool(
  'mizito_unread_messages',
  {
    title: 'Unread Mizito messages',
    description:
      'List conversations (direct messages, groups, and project chats) that have ' +
      'unread messages, across my Mizito workspaces, most recent first. Each item ' +
      'includes the conversation title, workspace, unread count, and the time of ' +
      'the last message. Use this to answer "what new messages do I have?".',
    inputSchema: {
      workspace: z
        .string()
        .optional()
        .describe('Limit to a single workspace by exact title or id. Omit for all workspaces.'),
    },
  },
  (args) => withContext((ctx) => unreadMessages(ctx, { workspace: args?.workspace })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[mizito-mcp] ready (stdio) — tools: whoami, overview, my_tasks, unread_messages');
