// Public surface of @mohsp-99/mizito — the Mizito core API library.
//
// Use the building blocks directly in your own Node code (Node >= 20):
//
//   import { createClient, buildContext, createTask, myTasks } from '@mohsp-99/mizito';
//
//   const client = createClient();               // token from the saved session
//   const tasks = await client.tasks.getAll();   // typed resource namespaces
//
//   const ctx = await buildContext();            // cross-workspace feeds
//   await createTask(ctx, { project: 'Ops', title: 'Ship it' });
//   const mine = await myTasks(ctx);
//
// Sign in once with `mizito login` / `mizito relogin` to save the session, or
// inject your own TokenProvider (staticToken / diskSession / passwordSession).
// Everything here talks to your live Mizito account; the write helpers mutate it.

// The client: resource namespaces over the token-provider transport.
export { createClient, createMizito, taskFromMessage, CHAT_PAGE_SIZE } from './client.js';
export type { MizitoClient, ClientOptions, Mizito, CreateMizitoOptions } from './client.js';

// Resource input types (for callers building payloads directly).
export type { NewTaskCommentInput, SetCompletedInput } from './resources/tasks.js';
export type { SearchMessagesInput } from './resources/chat.js';
export type { AddProjectInput, CloneProjectInput } from './resources/projects.js';
export type { SendLetterBody } from './resources/letters.js';
export type { UploadInput, UploadOptions } from './resources/content.js';

// Transport building blocks.
export { createHttp } from './transport/http.js';
export type { Http, HttpOptions, CallFn, CallOptions } from './transport/http.js';
export { MizitoApiError, codeForHttpStatus } from './transport/errors.js';
export type { MizitoErrorCode, MizitoApiErrorOptions } from './transport/errors.js';

// Auth: token providers (the key decoupling), headless login, session store.
export { staticToken, diskSession, passwordSession, loadCredentials, hasCredentials, reauthenticate } from './auth/providers.js';
export type { DiskSessionOptions } from './auth/providers.js';
export type { TokenProvider } from './auth/types.js';
export { hashPassword } from './auth/hash.js';
export { createSession } from './auth/login.js';
export type { CreateSessionOptions, CreateSessionResult } from './auth/login.js';
export { loadToken, saveSession, requireToken, tokenFromStorageState } from './auth/session.js';

// Read layer (personal feeds, across or within a workspace).
export {
  buildContext,
  resolveWorkspace,
  identity,
  overview,
  myTasks,
  unreadMessages,
} from './feeds/index.js';
export type { MizitoContext, WorkspaceRef, NormalizedTask } from './feeds/index.js';

// Write layer (mutating).
export {
  listProjects,
  createTask,
  editTask,
  commentOnTask,
  setTaskProgress,
  setTaskCompleted,
  sendMessage,
  getTaskComments,
  downloadAttachment,
  uploadFile,
  asMediaWrapper,
} from './feeds/write.js';
export type {
  CreateTaskInput,
  EditTaskInput,
  FileUpload,
  AttachmentOptions,
  AttachmentEntry,
  MediaWrapper,
} from './feeds/write.js';

// Letters / correspondence (read + write).
export {
  listLetters,
  readLetter,
  sendLetter,
  replyLetter,
  markLetterRead,
  archiveLetter,
} from './feeds/letters.js';

// Conversations / chat (read + write).
export {
  listConversations,
  readConversation,
  messageUser,
} from './feeds/conversations.js';

// Configuration: API/web URLs, header + endpoint constants, and the runtime
// data layout (anchored at MIZITO_DATA_DIR or the working directory).
export {
  WEB_BASE,
  WEB_LOGIN_URL,
  API_BASE,
  API_PREFIX,
  LOGIN_PREFIX,
  SESSION_CREATE_URL,
  CDN_BASE,
  UPLOAD_URL,
  TOKEN_HEADER,
  ROOT,
  AUTH_DIR,
  DATA_DIR,
  STORAGE_STATE_PATH,
  SESSION_PATH,
  CREDENTIALS_PATH,
  TARGET_WORKSPACE,
} from './config.js';

// Small shared helpers (filesystem, logging, text).
export { ensureDir, writeJson, readJson, exists, log, stripHtml, slug, sleep } from './util.js';

// Crawl-output file extraction (shared by the SQLite loader + downloader).
export { docOf, extractFiles } from './files.js';
export type { FileDescriptor } from './files.js';

// API entity shapes (observed from the live API; see src/types/index.ts for caveats).
export type {
  Envelope,
  Workspace,
  Bootstrap,
  Member,
  KanbanBoard,
  Project,
  Task,
  TaskRoleRef,
  TaskComment,
  DocumentNode,
  Attachment,
  MessageMedia,
  ChatMessage,
  Dialog,
  LetterRow,
  LetterThread,
  DashboardSummaryRow,
  UploadedDocument,
  Note,
  Credentials,
  SessionInfo,
} from './types/index.js';
