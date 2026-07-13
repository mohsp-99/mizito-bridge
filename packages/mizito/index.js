// Public surface of @mohsp-99/mizito — the Mizito core API library.
//
// Use the building blocks directly in your own Node code (Node >= 20):
//
//   import { buildContext, createTask, myTasks } from '@mohsp-99/mizito';
//   const ctx = await buildContext();                 // uses the saved session
//   await createTask(ctx, { project: 'Ops', title: 'Ship it' });
//   const mine = await myTasks(ctx);
//
// Sign in once with `mizito login` / `mizito relogin` to save the session the
// API client reads. Everything here talks to your live Mizito account; the
// write helpers mutate it.
export { createClient, MizitoApiError } from './http.js';
export { createMizito, taskFromMessage, CHAT_PAGE_SIZE } from './mizito.js';
export { loadToken, saveSession, requireToken, tokenFromStorageState } from './auth.js';

// Headless login (password -> token) + automatic re-login on expiry.
export {
  createSession,
  hashPassword,
  loadCredentials,
  hasCredentials,
  reauthenticate,
} from './login.js';

// Read layer (personal feeds, across or within a workspace).
export {
  buildContext,
  resolveWorkspace,
  identity,
  overview,
  myTasks,
  unreadMessages,
} from './feed.js';

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
} from './write.js';

// Letters / correspondence (read + write).
export {
  listLetters,
  readLetter,
  sendLetter,
  replyLetter,
  markLetterRead,
  archiveLetter,
} from './letters.js';

// Conversations / chat (read + write).
export {
  listConversations,
  readConversation,
  messageUser,
} from './conversations.js';

// Configuration: API/web URLs, header + endpoint constants, and the runtime
// data layout (anchored at MIZITO_DATA_DIR or the working directory).
export {
  WEB_BASE,
  WEB_LOGIN_URL,
  API_BASE,
  API_PREFIX,
  LOGIN_PREFIX,
  SESSION_CREATE_URL,
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
