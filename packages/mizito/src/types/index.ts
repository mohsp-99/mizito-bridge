// Shapes of the Mizito API, as observed from the live app (version
// 1.0.4-589 — see docs/API_NOTES.md). There is no published contract, so every
// interface is deliberately permissive: fields we have confirmed are typed,
// everything else passes through via an index signature. Do not "tighten" these
// against live responses without re-verifying across workspaces.

/** The standard `/api` response envelope. `status === 1` means OK. */
export interface Envelope<T = unknown> {
  status: number | boolean;
  data?: T;
  msg?: string;
  [key: string]: unknown;
}

export interface Workspace {
  _id: string;
  title: string;
  active?: boolean;
  [key: string]: unknown;
}

/** Response of `workspace/userId` — identity + the account's workspaces. */
export interface Bootstrap {
  uid: string;
  phone?: string;
  client_version?: string;
  workspaces?: Workspace[];
  [key: string]: unknown;
}

export interface Member {
  _id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  [key: string]: unknown;
}

export interface KanbanBoard {
  _id: string;
  title?: string;
  [key: string]: unknown;
}

export interface Project {
  _id: string;
  title: string;
  deleted?: boolean;
  archived?: boolean;
  is_advanced?: boolean;
  /** The project group chat's dialog id. */
  dialog?: string | null;
  /** Boards appear as objects or (in older data) as bare id strings. */
  kanban_boards?: Array<KanbanBoard | string>;
  [key: string]: unknown;
}

/** A task's assignee/responsible reference — id string or a wrapper object. */
export type TaskRoleRef = string | { _id?: string; user?: string; uid?: string; [key: string]: unknown };

export interface Task {
  _id: string;
  title: string;
  notes?: string | null;
  assignee?: TaskRoleRef | TaskRoleRef[] | null;
  responsible?: TaskRoleRef | TaskRoleRef[] | null;
  project?: string | null;
  kanban_board?: string | null;
  labels?: unknown[];
  attachments?: unknown[];
  checklist?: unknown[];
  alarm_options?: unknown;
  deleted?: boolean;
  completed?: boolean;
  progress?: number;
  deadline?: string | null;
  deadline_start?: string | null;
  alarm_at?: string | null;
  has_deadline?: boolean;
  has_attachments?: boolean;
  modified_at?: string | null;
  /** The task's chat dialog id (task discussions are dialogs). */
  dialog?: string | null;
  /**
   * JWT addressing the task in comment/progress/complete/remove endpoints.
   * Present on tasks read from `tasks/getAll` and task chat messages.
   */
  access_token?: string;
  last_comment?: { attachments?: unknown[]; [key: string]: unknown } | null;
  error?: string;
  [key: string]: unknown;
}

export interface TaskComment {
  _id: string;
  comment?: string;
  comment_owner?: string;
  comment_at?: string;
  edited?: boolean;
  deleted?: boolean;
  attachments?: unknown[];
  [key: string]: unknown;
}

/** A document node as it appears in message media / attachments. */
export interface DocumentNode {
  _id: string;
  name?: string;
  size?: number | null;
  /** CDN content token (JWT) — pass to the CDN download with x-token auth. */
  content?: string | null;
  content_key?: string | null;
  [key: string]: unknown;
}

/** Normalized attachment descriptor used across the feeds layer. */
export interface Attachment {
  id: string;
  name: string;
  size: number | null;
  content_token: string | null;
  content_key: string | null;
}

export interface MessageMedia {
  _?: string;
  task?: Task;
  document?: DocumentNode;
  photo?: {
    _id?: string;
    name?: string;
    content_key?: string | null;
    photo_large?: { size?: number | null; content?: string | null; content_key?: string | null };
    photo_medium?: { size?: number | null; content?: string | null; content_key?: string | null };
    photo_small?: { size?: number | null; content?: string | null; content_key?: string | null };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ChatMessage {
  _?: string;
  _id?: string;
  mid?: string | number;
  dialog?: string;
  from?: string;
  out?: boolean;
  date?: number | string | null;
  message?: string;
  media?: MessageMedia | null;
  reply_to?: unknown;
  mention?: unknown[];
  action?: string;
  [key: string]: unknown;
}

export interface Dialog {
  _id: string;
  title?: string;
  is_group?: boolean;
  is_project_group?: boolean;
  peer_user?: string;
  unread_count?: number;
  history_unread_count?: number;
  messages_count?: number;
  last_message_date?: string | number | null;
  [key: string]: unknown;
}

/** A row of `inbox/getInbox` — one letter thread in a mailbox listing. */
export interface LetterRow {
  _id?: string;
  thread?: string;
  subject?: string;
  from?: string;
  /** Sent (outbox) letters list their recipients here. */
  receivers?: string[];
  unread?: boolean;
  send_date?: string | null;
  attachments_count?: number;
  labels?: unknown[];
  /** Non-empty when the letter is formally registered (دبیرخانه). */
  secretariat?: Record<string, unknown> | null;
  short_content?: string;
  raw_content?: string;
  [key: string]: unknown;
}

/** Response of `inbox/getHistory` — one full letter thread. */
export interface LetterThread {
  thread?: string;
  subject?: string;
  from?: string;
  to?: Array<{
    user?: string;
    unread?: boolean;
    seen_date?: string | null;
    archived?: boolean;
    [key: string]: unknown;
  }>;
  send_date?: string | null;
  is_seen?: boolean;
  bookmarked?: boolean;
  labels?: unknown[];
  content?: string;
  attachments?: unknown[];
  messages?: Array<{
    from?: string;
    send_date?: string | null;
    date?: string | null;
    content?: string;
    message?: string;
    attachments?: unknown[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/** One row of `dashboard/getAllSummary` — per-workspace counters. */
export interface DashboardSummaryRow {
  workspace_id?: string;
  workspace_title?: string;
  inbox?: number;
  chat?: number;
  task?: { today?: number; overdue?: number; with_time?: number; no_time?: number };
  meetings?: unknown[];
  [key: string]: unknown;
}

/** Login credentials for the headless password login. */
export interface Credentials {
  username: string;
  password: string;
  /** SMS/OTP code — empty for a password-only account. */
  loginCode?: string;
  /** Push-registration id; null is accepted ("no push device"). */
  regId?: string | null;
}

/** The distilled session persisted to auth/session.json. */
export interface SessionInfo {
  token: string;
  user?: unknown;
  savedAt?: string;
}
