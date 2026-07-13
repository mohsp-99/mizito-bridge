// Programmatic entry point for @mohsp-99/mizito-bridge.
//
// Use the building blocks directly in your own Node code (Node >= 20):
//
//   import { buildContext, createTask, myTasks } from '@mohsp-99/mizito-bridge';
//   const ctx = await buildContext();                 // uses the saved session
//   await createTask(ctx, { project: 'Ops', title: 'Ship it' });
//   const mine = await myTasks(ctx);
//
// Sign in once with `mizito login` (or `npm run login`) to save the session the
// API client reads. Everything here talks to your live Mizito account; the
// write helpers mutate it.
export { createClient, MizitoApiError } from './core/http.js';
export { createMizito, taskFromMessage } from './core/mizito.js';
export { loadToken, saveSession, requireToken } from './core/auth.js';

// Headless login (password -> token) + automatic re-login on expiry.
export {
  createSession,
  hashPassword,
  loadCredentials,
  hasCredentials,
  reauthenticate,
} from './core/login.js';

// Read layer (personal feeds, across or within a workspace).
export {
  buildContext,
  resolveWorkspace,
  identity,
  overview,
  myTasks,
  unreadMessages,
} from './core/feed.js';

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
} from './core/write.js';

// Letters / correspondence (read + write).
export {
  listLetters,
  readLetter,
  sendLetter,
  replyLetter,
  markLetterRead,
  archiveLetter,
} from './core/letters.js';

// Conversations / chat (read + write).
export {
  listConversations,
  readConversation,
  messageUser,
} from './core/conversations.js';
