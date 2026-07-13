// Task endpoints. Writes are verified live (see mizito-crawler's write-probe).
import type { CallFn } from '../transport/http.js';
import type { Task, TaskComment } from '../types/index.js';

export interface NewTaskCommentInput {
  /** The task's access_token JWT (not its id). */
  token: string;
  comment: string;
  attachments?: unknown[];
  mention?: unknown[];
  reply_id?: string | null;
}

export interface SetCompletedInput {
  /** The task's access_token JWT. */
  token: string;
  completed: boolean;
  /** Required by the API even when null. */
  project: string | null;
  /** On reopen (completed:false) pass the target progress. */
  progress?: number | null;
  undone_user_id?: string | null;
}

export function tasksResource(call: CallFn) {
  return {
    // Every task in the (active/scoped) workspace — the authoritative source.
    // "My tasks" is derived by filtering this on assignee/responsible (see
    // feeds/index.ts). Note: `tasks/upcoming {outbox:false}` is a *feed* of
    // upcoming/unassigned tasks in dialogs you follow, NOT your assignments.
    getAll: () => call<Task[]>('tasks/getAll', {}),
    // The dashboard's personal feed. outbox:false = tasks coming to me
    // (assigned to / awaiting me) rather than ones I assigned out (outbox:true).
    upcoming: (outbox = false) =>
      call('tasks/upcoming', { outbox, from_dashboard: true, from: null, filter: null }),
    badge: () => call('tasks/badge', {}),

    // Full comment thread for a task, addressed by the task's access_token JWT
    // (not its id). Returns an array of comments.
    getComments: (accessToken: string) => call<TaskComment[]>('tasks/getComments', { token: accessToken }),

    // --- writes (mutating) ---
    // Create a task. `task` is the full add payload (title, assignee, project,
    // kanban_board, ...); returns the created task object (with _id,
    // access_token, dialog). Advanced-project tasks are posted into the project
    // chat group when `insert_to_chat_group` is true.
    add: (task: Record<string, unknown>) => call<Task | Task[]>('tasks/add', task),
    // Edit an existing task. Needs `task_id` + the task's `token` (access_token).
    save: (task: Record<string, unknown>) => call<Task | Task[]>('tasks/save', task),
    // Delete a task, addressed by its access_token JWT.
    remove: (accessToken: string) => call('tasks/removeTask', { token: accessToken }),
    // Add a comment to a task's thread (keyed by access_token, like getComments).
    newComment: ({ token, comment, attachments = [], mention = [], reply_id = null }: NewTaskCommentInput) =>
      call('tasks/newComment', { token, comment, attachments, mention, reply_id }),
    // Set a task's progress (0..100). 100 marks it completed server-side.
    updateProgress: (accessToken: string, progress: number) =>
      call<Task>('tasks/updateProgress', { token: accessToken, progress }),
    // Complete (or reopen) a task. `project` is required by the API. On reopen
    // (completed:false) pass the target `progress` and optional `undone_user_id`.
    setCompleted: ({ token, completed, project, progress, undone_user_id = null }: SetCompletedInput) =>
      call<Task>('tasks/setCompleted', {
        token,
        completed,
        project,
        ...(progress != null ? { progress } : {}),
        undone_user_id,
      }),
  };
}

export type TasksResource = ReturnType<typeof tasksResource>;
