// High-level, typed-ish wrapper over the raw /api client. Each method maps to a
// confirmed Mizito endpoint (see docs/API_NOTES.md). Keeping the endpoint names
// in one place means the crawler reads cleanly and any API change is fixed here.
import { createClient } from './http.js';
import { loadToken } from './auth.js';

export const CHAT_PAGE_SIZE = 15; // chat/getHistory returns 15 messages per page

export function createMizito({ token = loadToken(), pacingMs = 200 } = {}) {
  const client = createClient({ token, pacingMs });
  const call = client.call;

  return {
    client,

    // --- workspace ---
    bootstrap: () => call('workspace/userId', { regId: null }),
    // Switch the active workspace. Returns a NEW token scoped to that workspace;
    // the original token is unaffected (token-scoped, not account-wide state).
    switchWorkspace: (workspace_id) => call('workspace/switch', { workspace_id }, { raw: true }),
    workspaceName: () => call('workspace/name', {}),
    planInfo: () => call('workspace/planInfo', {}),
    members: () => call('workspace/getUsers', {}),

    // --- projects ---
    projects: () => call('projects/getList', {}),
    projectSummaries: () => call('projects/allSummary', {}),

    // --- labels ---
    taskLabels: () => call('labels/getAll', { type: 'task' }),

    // --- task comment threads ---
    // Full comment thread for a task, addressed by the task's access_token JWT
    // (not its id). Returns an array of comments.
    taskComments: (accessToken) => call('tasks/getComments', { token: accessToken }),

    // --- writes (mutating; verified live, see apps/crawler/write-probe.mjs) ---
    // Create a task. `task` is the full add payload (title, assignee, project,
    // kanban_board, ...); returns the created task object (with _id,
    // access_token, dialog). Advanced-project tasks are posted into the project
    // chat group when `insert_to_chat_group` is true.
    addTask: (task) => call('tasks/add', task),
    // Edit an existing task. Needs `task_id` + the task's `token` (access_token).
    saveTask: (task) => call('tasks/save', task),
    // Delete a task, addressed by its access_token JWT.
    removeTask: (accessToken) => call('tasks/removeTask', { token: accessToken }),
    // Add a comment to a task's thread (keyed by access_token, like getComments).
    newTaskComment: ({ token, comment, attachments = [], mention = [], reply_id = null }) =>
      call('tasks/newComment', { token, comment, attachments, mention, reply_id }),
    // Set a task's progress (0..100). 100 marks it completed server-side.
    updateTaskProgress: (accessToken, progress) =>
      call('tasks/updateProgress', { token: accessToken, progress }),
    // Complete (or reopen) a task. `project` is required by the API. On reopen
    // (completed:false) pass the target `progress` and optional `undone_user_id`.
    setTaskCompleted: ({ token, completed, project, progress, undone_user_id = null }) =>
      call('tasks/setCompleted', {
        token,
        completed,
        project,
        ...(progress != null ? { progress } : {}),
        undone_user_id,
      }),

    // --- chat writes ---
    // Send a message to a dialog. `message` is the full outgoing message object
    // ({ _:'message', dialog, out:true, message, from, date, randomId, ... }).
    // Returns `true` on success (no message id echoed back).
    sendMessage: (message) => call('chat/send', message),
    // Delete a message you sent, addressed by dialog + message id (mid).
    removeSentMessage: (dialog, mid) => call('chat/removeSentMessage', { dialog, mid }),

    // --- dashboard ---
    dashboardSummary: () => call('dashboard/getAllSummary', {}),
    workspacesUsers: () => call('dashboard/getAllWorkspacesUsers', {}),

    // --- "my" feeds (personal, scoped to the active/scoped workspace) ---
    // The dashboard's personal task feed. outbox:false = tasks coming to me
    // (assigned to / awaiting me) rather than ones I assigned out (outbox:true).
    // Every task in the (active/scoped) workspace — the authoritative source.
    // "My tasks" is derived by filtering this on assignee/responsible (see
    // core/feed.js). Note: `tasks/upcoming {outbox:false}` is a *feed* of
    // upcoming/unassigned tasks in dialogs you follow, NOT your assignments.
    allTasks: () => call('tasks/getAll', {}),
    upcomingFeed: (outbox = false) =>
      call('tasks/upcoming', { outbox, from_dashboard: true, from: null, filter: null }),
    tasksBadge: () => call('tasks/badge', {}),
    inboxBadge: () => call('inbox/badge', {}),

    // --- chat / dialogs (tasks live here) ---
    dialogs: () => call('chat/getDialogs', {}),
    fullChat: (dialog) => call('chat/getFullChat', { dialog }),
    history: (dialog, offset = 0) => call('chat/getHistory', { dialog, offset }),

    // Page through a dialog's entire message history. Returns all messages,
    // oldest-to-newest order as the API provides them.
    async fullHistory(dialog, { max = 100000, onPage } = {}) {
      const all = [];
      let offset = 0;
      for (;;) {
        const page = await call('chat/getHistory', { dialog, offset });
        if (!Array.isArray(page) || page.length === 0) break;
        all.push(...page);
        if (onPage) onPage({ offset, size: page.length, total: all.length });
        offset += page.length;
        if (page.length < CHAT_PAGE_SIZE) break; // short page => last page
        if (all.length >= max) break;
      }
      return all;
    },
  };
}

// Pull the task object out of a Mizito chat message, or null if it isn't a task.
export function taskFromMessage(message) {
  if (message?.media?._ === 'messageMediaTask' && message.media.task) {
    return message.media.task;
  }
  return null;
}
