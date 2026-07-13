// The Mizito client: resource namespaces (client.tasks.*, client.chat.*, …)
// mounted over the token-provider transport. Each namespace maps 1:1 to
// confirmed endpoints (see docs/API_NOTES.md); keeping the endpoint names in
// the resources/ modules means any API change is fixed in one place.
import { createHttp } from './transport/http.js';
import type { CallOptions, Http } from './transport/http.js';
import { staticToken, diskSession } from './auth/providers.js';
import type { TokenProvider } from './auth/types.js';
import { tasksResource } from './resources/tasks.js';
import { chatResource, CHAT_PAGE_SIZE, taskFromMessage } from './resources/chat.js';
import { projectsResource } from './resources/projects.js';
import { labelsResource } from './resources/labels.js';
import { workspacesResource } from './resources/workspaces.js';
import { lettersResource } from './resources/letters.js';
import { dashboardResource } from './resources/dashboard.js';
import { filesResource } from './resources/files.js';
import { contentResource } from './resources/content.js';
import { notesResource } from './resources/notes.js';

export { CHAT_PAGE_SIZE, taskFromMessage };

export interface ClientOptions {
  /** Where tokens come from and how they refresh. Default: diskSession(). */
  tokens?: TokenProvider;
  /** Convenience: a fixed token (wraps staticToken). Ignored if tokens is set. */
  token?: string;
  /** Politeness delay between calls (ms). */
  pacingMs?: number;
}

export interface MizitoClient {
  http: Http;
  call: Http['call'];
  resolve: Http['resolve'];
  /** The provider's current token (e.g. for CDN downloads or manual calls). */
  currentToken(): Promise<string>;
  tasks: ReturnType<typeof tasksResource>;
  chat: ReturnType<typeof chatResource>;
  projects: ReturnType<typeof projectsResource>;
  labels: ReturnType<typeof labelsResource>;
  workspaces: ReturnType<typeof workspacesResource> & {
    /** A NEW client scoped to another workspace (the base token is unaffected). */
    switch(workspaceId: string): Promise<MizitoClient>;
  };
  letters: ReturnType<typeof lettersResource>;
  dashboard: ReturnType<typeof dashboardResource>;
  files: ReturnType<typeof filesResource>;
  content: ReturnType<typeof contentResource>;
  notes: ReturnType<typeof notesResource>;
}

export function createClient({ tokens, token, pacingMs = 200 }: ClientOptions = {}): MizitoClient {
  const provider = tokens ?? (token != null ? staticToken(token) : diskSession());
  const http = createHttp({ tokens: provider, pacingMs });
  const workspaces = workspacesResource(http.call);

  const client: MizitoClient = {
    http,
    call: http.call,
    resolve: http.resolve,
    currentToken: http.currentToken,
    tasks: tasksResource(http.call),
    chat: chatResource(http.call),
    projects: projectsResource(http.call),
    labels: labelsResource(http.call),
    workspaces: {
      ...workspaces,
      async switch(workspaceId: string): Promise<MizitoClient> {
        const scoped = await workspaces.switchToken(workspaceId);
        if (!scoped) throw new Error(`Could not switch into workspace "${workspaceId}".`);
        return createClient({ token: scoped, pacingMs });
      },
    },
    letters: lettersResource(http.call),
    dashboard: dashboardResource(http.call),
    files: filesResource(http),
    content: contentResource(http, http.call),
    notes: notesResource(http.call),
  };
  return client;
}

// ---------------------------------------------------------------------------
// Back-compat facade: the flat method set of the pre-TypeScript core
// (`createMizito(...)`). Existing scripts keep working; new code should use
// createClient's namespaces. The method names and payloads are unchanged.
// ---------------------------------------------------------------------------
export interface CreateMizitoOptions {
  token?: string | null;
  pacingMs?: number;
}

export function createMizito({ token, pacingMs = 200 }: CreateMizitoOptions = {}) {
  const c = createClient(token != null ? { token, pacingMs } : { pacingMs });

  return {
    /** Raw transport view ({ call, resolve }); token resolves via the provider. */
    client: { call: c.call, resolve: c.resolve, token, currentToken: c.currentToken },

    // --- workspace ---
    bootstrap: () => c.workspaces.bootstrap(),
    switchWorkspace: (workspace_id: string) => c.workspaces.switchRaw(workspace_id),
    workspaceName: () => c.workspaces.name(),
    planInfo: () => c.workspaces.planInfo(),
    members: () => c.workspaces.getUsers(),

    // --- projects ---
    projects: () => c.projects.getList(),
    projectSummaries: () => c.projects.allSummary(),

    // --- labels ---
    taskLabels: () => c.labels.getAll('task'),

    // --- tasks ---
    taskComments: (accessToken: string) => c.tasks.getComments(accessToken),
    addTask: (task: Record<string, unknown>) => c.tasks.add(task),
    saveTask: (task: Record<string, unknown>) => c.tasks.save(task),
    removeTask: (accessToken: string) => c.tasks.remove(accessToken),
    newTaskComment: (input: Parameters<typeof c.tasks.newComment>[0]) => c.tasks.newComment(input),
    updateTaskProgress: (accessToken: string, progress: number) =>
      c.tasks.updateProgress(accessToken, progress),
    setTaskCompleted: (input: Parameters<typeof c.tasks.setCompleted>[0]) => c.tasks.setCompleted(input),
    allTasks: () => c.tasks.getAll(),
    upcomingFeed: (outbox = false) => c.tasks.upcoming(outbox),
    tasksBadge: () => c.tasks.badge(),
    inboxBadge: () => c.letters.badge(),

    // --- chat ---
    sendMessage: (message: Record<string, unknown>) => c.chat.send(message),
    removeSentMessage: (dialog: string, mid: string | number) => c.chat.removeSentMessage(dialog, mid),
    dialogs: () => c.chat.getDialogs(),
    fullChat: (dialog: string) => c.chat.getFullChat(dialog),
    history: (dialog: string, offset = 0) => c.chat.getHistory(dialog, offset),
    chatView: (dialog: string) => c.chat.getChatView(dialog),
    searchMessages: (input: Parameters<typeof c.chat.search>[0] = {}) => c.chat.search(input),
    createDialog: (user: string) => c.chat.createDialog(user),
    chatSeen: (dialog: string, seen_count: number) => c.chat.seen(dialog, seen_count),
    fullHistory: (dialog: string, opts: Parameters<typeof c.chat.fullHistory>[1] = {}) =>
      c.chat.fullHistory(dialog, opts),

    // --- dashboard ---
    dashboardSummary: () => c.dashboard.getAllSummary(),
    workspacesUsers: () => c.dashboard.getAllWorkspacesUsers(),

    // --- letters ---
    letters: (mode = 'inbox', offset = 0, extra: Record<string, unknown> = {}) =>
      c.letters.getInbox(mode, offset, extra),
    letterThread: (thread: string) => c.letters.getHistory(thread),
    letterLabels: (thread: string) => c.letters.getMessageLabels(thread),
    sendLetter: (body: Parameters<typeof c.letters.send>[0]) => c.letters.send(body),
    letterSeen: (thread: string) => c.letters.seen(thread),
    letterArchive: (thread: string, opts: { outbox?: boolean } = {}) => c.letters.archive(thread, opts),
    letterUnarchive: (thread: string, opts: { outbox?: boolean } = {}) => c.letters.unarchive(thread, opts),
    letterToggleBookmark: (thread: string) => c.letters.toggleBookmark(thread),

    // --- newer modules exposed as namespaces (no legacy flat names existed) ---
    content: c.content,
    notes: c.notes,
  };
}

export type Mizito = ReturnType<typeof createMizito>;
export type { CallOptions };
