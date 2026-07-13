// Mizito MCP server.
//
// Exposes a Claude (Desktop/Code) client the signed-in Mizito account:
//   - personal read views (who am I + my workspaces, a quick overview, the tasks
//     awaiting me, conversations with unread messages, projects/boards),
//   - TASK reads/writes (comments, create/edit/comment/progress/complete),
//   - LETTERS / correspondence (list + read a letter thread; send, reply,
//     mark-read, archive), and
//   - CONVERSATIONS / chat (list conversations, read a thread, send a message —
//     to a project chat, a dialog, or a member directly).
// Data is pulled live from Mizito's API using the session saved by `npm run
// login` (see core/auth.js).
//
// The write tools mutate your real Mizito account; MCP clients prompt before
// each call, so a user can allow or decline per action (or say up front they
// don't want writes). Every write is verified live — see
// apps/crawler/write-probe.mjs.
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
} from '@mohsp-99/mizito';
import {
  listProjects,
  getTaskComments,
  downloadAttachment,
  createTask,
  editTask,
  commentOnTask,
  setTaskProgress,
  setTaskCompleted,
  sendMessage,
} from '@mohsp-99/mizito';
import {
  listLetters,
  readLetter,
  sendLetter,
  replyLetter,
  markLetterRead,
  archiveLetter,
} from '@mohsp-99/mizito';
import {
  listConversations,
  readConversation,
  messageUser,
} from '@mohsp-99/mizito';

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

server.registerTool(
  'mizito_projects',
  {
    title: 'Mizito projects & boards',
    description:
      'List the projects in a Mizito workspace, each with its kanban boards and ' +
      'chat dialog id. Use this to discover the exact project and board names to ' +
      'pass to mizito_create_task or mizito_send_message. Defaults to the active ' +
      'workspace; pass `workspace` to target another.',
    inputSchema: {
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id. Omit for the active workspace.'),
    },
  },
  (args) => withContext((ctx) => listProjects(ctx, { workspace: args?.workspace })),
);

server.registerTool(
  'mizito_task_comments',
  {
    title: 'Read a Mizito task\'s comments',
    description:
      'Read the full comment thread of a task, including each comment\'s author, text, ' +
      'time, and any file attachments. Identify the task by task_id (preferred) or ' +
      'task_title. Each attachment includes its name, size, and a `content_token` — pass ' +
      'that token to mizito_download_file to fetch the file.',
    inputSchema: {
      task_id: z.string().optional().describe('The task id (from mizito_my_tasks).'),
      task_title: z.string().optional().describe('The task title, if you do not have the id.'),
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id. Omit for the active workspace.'),
    },
  },
  (args) =>
    withContext((ctx) =>
      getTaskComments(ctx, {
        workspace: args?.workspace,
        taskId: args?.task_id,
        taskTitle: args?.task_title,
      }),
    ),
);

server.registerTool(
  'mizito_download_file',
  {
    title: 'Download a Mizito attachment',
    description:
      'Download a file attachment by its content_token (get one from mizito_task_comments). ' +
      'Saves the file under downloads/<workspace>/ and returns its local path and size. For ' +
      'small files, set inline=true to also get the bytes back as base64. Pass the same ' +
      'workspace the task belongs to (attachment tokens are workspace-scoped).',
    inputSchema: {
      content_token: z.string().describe('The attachment content token (JWT) from mizito_task_comments.'),
      name: z.string().optional().describe('Filename to save as (defaults from the attachment).'),
      inline: z
        .boolean()
        .optional()
        .describe('Also return the file bytes as base64 (only for files ≤ ~1 MB). Default false.'),
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id — must be the task\'s workspace. Omit for the active one.'),
    },
  },
  (args) =>
    withContext((ctx) =>
      downloadAttachment(ctx, {
        workspace: args?.workspace,
        contentToken: args?.content_token,
        name: args?.name,
        maxInlineBytes: args?.inline ? 1024 * 1024 : 0,
      }),
    ),
);

// --- conversations (chat) reads --------------------------------------------

server.registerTool(
  'mizito_conversations',
  {
    title: 'List Mizito conversations',
    description:
      'List the conversations (direct messages, team groups, and project chats) in a ' +
      'Mizito workspace, most recent first. Each item has the conversation title, kind ' +
      '(direct/group/project), unread count, message count, and last-message time. Set ' +
      'unread_only to see just those with unread messages. Defaults to the active ' +
      'workspace. Use the returned dialog id with mizito_read_conversation.',
    inputSchema: {
      unread_only: z.boolean().optional().describe('Only conversations with unread messages (default false).'),
      limit: z.number().int().min(1).max(200).optional().describe('Max conversations to return (default 50).'),
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id. Omit for the active workspace.'),
    },
  },
  (args) =>
    withContext((ctx) =>
      listConversations(ctx, {
        workspace: args?.workspace,
        unreadOnly: args?.unread_only ?? false,
        limit: args?.limit ?? 50,
      }),
    ),
);

server.registerTool(
  'mizito_read_conversation',
  {
    title: 'Read a Mizito conversation',
    description:
      "Read a conversation's recent messages, oldest first. Identify it by dialog id " +
      '(from mizito_conversations), by project name/id (its group chat), or by a member ' +
      'name/id (an existing direct message). Each message reports its author, whether it ' +
      'is mine, time, and kind (text, task, task_mention, photo, document, or service).',
    inputSchema: {
      dialog: z.string().optional().describe('Dialog id (from mizito_conversations or mizito_projects).'),
      project: z.string().optional().describe('Project name/id — reads its group chat.'),
      user: z.string().optional().describe('Member name/id — reads your direct message with them.'),
      limit: z.number().int().min(1).max(200).optional().describe('Max messages to return (default 30).'),
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id. Omit for the active workspace.'),
    },
  },
  (args) =>
    withContext((ctx) =>
      readConversation(ctx, {
        workspace: args?.workspace,
        dialog: args?.dialog,
        project: args?.project,
        user: args?.user,
        limit: args?.limit ?? 30,
      }),
    ),
);

// --- letters / correspondence reads ----------------------------------------

server.registerTool(
  'mizito_letters',
  {
    title: 'List Mizito letters',
    description:
      "List letters from Mizito's correspondence module (formal, threaded messages — the " +
      'دبیرخانه/مکاتبات feature, distinct from chat). Choose the mailbox with box: inbox ' +
      '(received, default), outbox (sent), or archive. Each row has the thread id, subject, ' +
      'sender, unread flag, date, attachment/label counts, whether it is formally ' +
      'registered, and a short preview. Use the thread id with mizito_read_letter. Defaults ' +
      'to the active workspace.',
    inputSchema: {
      box: z.enum(['inbox', 'outbox', 'archive']).optional().describe('Mailbox: inbox (default), outbox, or archive.'),
      limit: z.number().int().min(1).max(200).optional().describe('Max letters to return (default 30).'),
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id. Omit for the active workspace.'),
    },
  },
  (args) =>
    withContext((ctx) =>
      listLetters(ctx, { workspace: args?.workspace, box: args?.box ?? 'inbox', limit: args?.limit ?? 30 }),
    ),
);

server.registerTool(
  'mizito_read_letter',
  {
    title: 'Read a Mizito letter',
    description:
      'Read a full letter thread by its thread id (from mizito_letters): subject, sender, ' +
      'recipients with per-person read receipts, body text, attachments (each with a ' +
      'content_token for mizito_download_file), labels, and any follow-up replies in the ' +
      'thread.',
    inputSchema: {
      thread: z.string().describe('The letter thread id (from mizito_letters).'),
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id. Omit for the active workspace.'),
    },
  },
  (args) => withContext((ctx) => readLetter(ctx, { workspace: args?.workspace, thread: args?.thread })),
);

// --- write tools (mutating) ------------------------------------------------

server.registerTool(
  'mizito_create_task',
  {
    title: 'Create a Mizito task',
    description:
      'Create (define) a new task in Mizito. WRITES to your account. Give a title ' +
      '(required); optionally a project (name or id) and board (name or id) to file ' +
      'it under, notes, and assignees (member names or ids — defaults to you). For an ' +
      'advanced project the task is also posted into the project chat group unless ' +
      'post_to_chat is false. Use mizito_projects first to find valid project/board ' +
      'names. Returns the created task (id, project, board).',
    inputSchema: {
      title: z.string().describe('The task title (required).'),
      project: z
        .string()
        .optional()
        .describe('Project by name or id to file the task under. Omit for a personal task.'),
      board: z
        .string()
        .optional()
        .describe('Kanban board by name or id within the project. Omit to use the first board.'),
      notes: z.string().optional().describe('Optional task description / notes.'),
      assignees: z
        .array(z.string())
        .optional()
        .describe('Member names or ids to assign. Omit to assign to yourself.'),
      deadline: z
        .string()
        .optional()
        .describe('Optional deadline as an ISO date-time string.'),
      post_to_chat: z
        .boolean()
        .optional()
        .describe('For advanced projects, also post the task to the project chat (default true).'),
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id. Omit for the active workspace.'),
    },
  },
  (args) =>
    withContext((ctx) =>
      createTask(ctx, {
        workspace: args?.workspace,
        project: args?.project,
        board: args?.board,
        title: args?.title,
        notes: args?.notes,
        assignees: args?.assignees,
        deadline: args?.deadline ?? null,
        postToChat: args?.post_to_chat ?? true,
      }),
    ),
);

server.registerTool(
  'mizito_edit_task',
  {
    title: 'Edit a Mizito task',
    description:
      'Edit an existing task\'s fields. WRITES to your account. Identify the task by task_id ' +
      '(preferred) or task_title. Change any of: title, notes, deadline (ISO date-time, or ' +
      'null to clear), progress, board (name/id), assignees (names/ids). Only the fields you ' +
      'pass change; the rest are preserved. Returns the updated task.',
    inputSchema: {
      task_id: z.string().optional().describe('The task id (from mizito_my_tasks).'),
      task_title: z.string().optional().describe('The task title, if you do not have the id.'),
      title: z.string().optional().describe('New title.'),
      notes: z.string().optional().describe('New notes / description.'),
      deadline: z
        .string()
        .nullable()
        .optional()
        .describe('New deadline as an ISO date-time string, or null to clear it.'),
      progress: z.number().min(0).max(100).optional().describe('New progress percent, 0–100.'),
      board: z.string().optional().describe('Move to this kanban board (name or id).'),
      assignees: z
        .array(z.string())
        .optional()
        .describe('Replace assignees with these member names/ids.'),
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id. Omit for the active workspace.'),
    },
  },
  (args) =>
    withContext((ctx) =>
      editTask(ctx, {
        workspace: args?.workspace,
        taskId: args?.task_id,
        taskTitle: args?.task_title,
        title: args?.title,
        notes: args?.notes,
        deadline: args?.deadline,
        progress: args?.progress,
        board: args?.board,
        assignees: args?.assignees,
      }),
    ),
);

server.registerTool(
  'mizito_comment_task',
  {
    title: 'Comment on a Mizito task',
    description:
      'Add a comment to a task\'s discussion thread. WRITES to your account. Identify ' +
      'the task by task_id (preferred) or task_title (must match exactly one task in ' +
      'the workspace). Returns the task it commented on.',
    inputSchema: {
      comment: z.string().describe('The comment text (required).'),
      task_id: z.string().optional().describe('The task id (from mizito_my_tasks).'),
      task_title: z
        .string()
        .optional()
        .describe('The task title, if you do not have the id. Must match exactly one task.'),
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id. Omit for the active workspace.'),
    },
  },
  (args) =>
    withContext((ctx) =>
      commentOnTask(ctx, {
        workspace: args?.workspace,
        taskId: args?.task_id,
        taskTitle: args?.task_title,
        comment: args?.comment,
      }),
    ),
);

server.registerTool(
  'mizito_update_task_progress',
  {
    title: 'Update Mizito task progress',
    description:
      'Set a task\'s progress percentage (0–100). WRITES to your account. 100 marks the ' +
      'task completed. Identify the task by task_id (preferred) or task_title.',
    inputSchema: {
      progress: z.number().min(0).max(100).describe('Progress percent, 0 to 100.'),
      task_id: z.string().optional().describe('The task id (from mizito_my_tasks).'),
      task_title: z.string().optional().describe('The task title, if you do not have the id.'),
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id. Omit for the active workspace.'),
    },
  },
  (args) =>
    withContext((ctx) =>
      setTaskProgress(ctx, {
        workspace: args?.workspace,
        taskId: args?.task_id,
        taskTitle: args?.task_title,
        progress: args?.progress,
      }),
    ),
);

server.registerTool(
  'mizito_complete_task',
  {
    title: 'Complete or reopen a Mizito task',
    description:
      'Mark a task completed, or reopen it. WRITES to your account. Identify the task by ' +
      'task_id (preferred) or task_title. Pass completed=false to reopen a finished task.',
    inputSchema: {
      task_id: z.string().optional().describe('The task id (from mizito_my_tasks).'),
      task_title: z.string().optional().describe('The task title, if you do not have the id.'),
      completed: z
        .boolean()
        .optional()
        .describe('true to complete (default), false to reopen.'),
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id. Omit for the active workspace.'),
    },
  },
  (args) =>
    withContext((ctx) =>
      setTaskCompleted(ctx, {
        workspace: args?.workspace,
        taskId: args?.task_id,
        taskTitle: args?.task_title,
        completed: args?.completed ?? true,
      }),
    ),
);

server.registerTool(
  'mizito_send_message',
  {
    title: 'Send a Mizito chat message',
    description:
      "Send a text chat message. WRITES to your account. Target one of: a project's group " +
      'chat (project name/id), a dialog directly (dialog id), or a member directly (user ' +
      "name/id — opens the direct message if it doesn't exist yet). Use mizito_projects or " +
      'mizito_conversations to find targets. This is chat, not the letters module — for a ' +
      'formal letter use mizito_send_letter. Returns where the message was sent.',
    inputSchema: {
      text: z.string().describe('The message text (required).'),
      project: z
        .string()
        .optional()
        .describe('Project by name or id — sends to its group chat.'),
      dialog: z
        .string()
        .optional()
        .describe('A dialog id to send to directly (alternative to project).'),
      user: z
        .string()
        .optional()
        .describe('A member name or id — sends them a direct message (opens the DM if needed).'),
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id. Omit for the active workspace.'),
    },
  },
  (args) =>
    withContext((ctx) =>
      args?.user
        ? messageUser(ctx, { workspace: args?.workspace, user: args.user, text: args?.text })
        : sendMessage(ctx, {
            workspace: args?.workspace,
            project: args?.project,
            dialog: args?.dialog,
            text: args?.text,
          }),
    ),
);

// --- letters / correspondence writes (mutating) ----------------------------

server.registerTool(
  'mizito_send_letter',
  {
    title: 'Send a Mizito letter',
    description:
      "Send a formal letter via Mizito's correspondence module (not chat). WRITES to your " +
      'account. Give recipients (to: member names or ids), a subject, and content. Use ' +
      'mizito_whoami / a workspace\'s members to find names. Returns the sent letter\'s ' +
      'thread id.',
    inputSchema: {
      to: z.array(z.string()).describe('Recipient member names or ids (at least one).'),
      subject: z.string().describe('The letter subject (required).'),
      content: z.string().describe('The letter body (required; plain text or HTML).'),
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id. Omit for the active workspace.'),
    },
  },
  (args) =>
    withContext((ctx) =>
      sendLetter(ctx, {
        workspace: args?.workspace,
        to: args?.to,
        subject: args?.subject,
        content: args?.content,
      }),
    ),
);

server.registerTool(
  'mizito_reply_letter',
  {
    title: 'Reply to a Mizito letter',
    description:
      'Reply within an existing letter thread. WRITES to your account. Identify the thread ' +
      'by its id (from mizito_letters / mizito_read_letter). The reply is addressed to the ' +
      "thread's participants automatically. Returns the thread id.",
    inputSchema: {
      thread: z.string().describe('The letter thread id (from mizito_letters).'),
      content: z.string().describe('The reply body (required).'),
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id. Omit for the active workspace.'),
    },
  },
  (args) =>
    withContext((ctx) =>
      replyLetter(ctx, { workspace: args?.workspace, thread: args?.thread, content: args?.content }),
    ),
);

server.registerTool(
  'mizito_mark_letter_read',
  {
    title: 'Mark a Mizito letter read',
    description:
      'Mark a letter thread as read. WRITES to your account. Identify the thread by its id ' +
      '(from mizito_letters).',
    inputSchema: {
      thread: z.string().describe('The letter thread id (from mizito_letters).'),
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id. Omit for the active workspace.'),
    },
  },
  (args) => withContext((ctx) => markLetterRead(ctx, { workspace: args?.workspace, thread: args?.thread })),
);

server.registerTool(
  'mizito_archive_letter',
  {
    title: 'Archive a Mizito letter',
    description:
      'Move a letter thread to the archive (or back out with unarchive=true). WRITES to your ' +
      'account. For a sent letter, set box=outbox so the correct archive is used.',
    inputSchema: {
      thread: z.string().describe('The letter thread id (from mizito_letters).'),
      box: z.enum(['inbox', 'outbox']).optional().describe('Which mailbox the letter is in (default inbox).'),
      unarchive: z.boolean().optional().describe('true to move it back out of the archive (default false).'),
      workspace: z
        .string()
        .optional()
        .describe('Workspace by exact title or id. Omit for the active workspace.'),
    },
  },
  (args) =>
    withContext((ctx) =>
      archiveLetter(ctx, {
        workspace: args?.workspace,
        thread: args?.thread,
        box: args?.box ?? 'inbox',
        unarchive: args?.unarchive ?? false,
      }),
    ),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  '[mizito-mcp] ready (stdio) — read: whoami, overview, my_tasks, unread_messages, ' +
    'projects, task_comments, download_file, conversations, read_conversation, letters, ' +
    'read_letter; write: create_task, edit_task, comment_task, update_task_progress, ' +
    'complete_task, send_message, send_letter, reply_letter, mark_letter_read, archive_letter',
);
