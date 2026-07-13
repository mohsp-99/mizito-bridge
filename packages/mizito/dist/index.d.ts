/** The standard `/api` response envelope. `status === 1` means OK. */
interface Envelope<T = unknown> {
    status: number | boolean;
    data?: T;
    msg?: string;
    [key: string]: unknown;
}
interface Workspace {
    _id: string;
    title: string;
    active?: boolean;
    [key: string]: unknown;
}
/** Response of `workspace/userId` — identity + the account's workspaces. */
interface Bootstrap {
    uid: string;
    phone?: string;
    client_version?: string;
    workspaces?: Workspace[];
    [key: string]: unknown;
}
interface Member {
    _id: string;
    first_name?: string;
    last_name?: string;
    username?: string;
    [key: string]: unknown;
}
interface KanbanBoard {
    _id: string;
    title?: string;
    [key: string]: unknown;
}
interface Project {
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
type TaskRoleRef = string | {
    _id?: string;
    user?: string;
    uid?: string;
    [key: string]: unknown;
};
interface Task {
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
    last_comment?: {
        attachments?: unknown[];
        [key: string]: unknown;
    } | null;
    error?: string;
    [key: string]: unknown;
}
interface TaskComment {
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
interface DocumentNode {
    _id: string;
    name?: string;
    size?: number | null;
    /** CDN content token (JWT) — pass to the CDN download with x-token auth. */
    content?: string | null;
    content_key?: string | null;
    [key: string]: unknown;
}
/** Normalized attachment descriptor used across the feeds layer. */
interface Attachment {
    id: string;
    name: string;
    size: number | null;
    content_token: string | null;
    content_key: string | null;
}
interface MessageMedia {
    _?: string;
    task?: Task;
    document?: DocumentNode;
    photo?: {
        _id?: string;
        name?: string;
        content_key?: string | null;
        photo_large?: {
            size?: number | null;
            content?: string | null;
            content_key?: string | null;
        };
        photo_medium?: {
            size?: number | null;
            content?: string | null;
            content_key?: string | null;
        };
        photo_small?: {
            size?: number | null;
            content?: string | null;
            content_key?: string | null;
        };
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
interface ChatMessage {
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
interface Dialog {
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
interface LetterRow {
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
interface LetterThread {
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
interface DashboardSummaryRow {
    workspace_id?: string;
    workspace_title?: string;
    inbox?: number;
    chat?: number;
    task?: {
        today?: number;
        overdue?: number;
        with_time?: number;
        no_time?: number;
    };
    meetings?: unknown[];
    [key: string]: unknown;
}
/** Login credentials for the headless password login. */
interface Credentials {
    username: string;
    password: string;
    /** SMS/OTP code — empty for a password-only account. */
    loginCode?: string;
    /** Push-registration id; null is accepted ("no push device"). */
    regId?: string | null;
}
/** The distilled session persisted to auth/session.json. */
interface SessionInfo {
    token: string;
    user?: unknown;
    savedAt?: string;
}

interface TokenProvider {
    /** The current session token. Throw if none can be produced. */
    getToken(): string | Promise<string>;
    /**
     * Mint a fresh token after an auth failure (e.g. headless re-login with
     * stored credentials). Return null when re-auth isn't possible; the auth
     * error then propagates to the caller.
     */
    onAuthExpired?(): string | null | Promise<string | null>;
}

interface CallOptions {
    method?: string;
    /** Return the body as-is instead of unwrapping the {status,data} envelope. */
    raw?: boolean;
}
type CallFn = <T = unknown>(endpoint: string, payload?: unknown, opts?: CallOptions) => Promise<T>;
interface Http {
    call: CallFn;
    resolve(endpoint: string): string;
    /** The provider's current token (e.g. for CDN downloads outside /api). */
    currentToken(): Promise<string>;
    tokens: TokenProvider;
}
interface HttpOptions {
    tokens: TokenProvider;
    /** Politeness delay after each successful call (ms). */
    pacingMs?: number;
}
declare function createHttp({ tokens, pacingMs }: HttpOptions): Http;

interface SendLetterBody {
    to: string[];
    subject: string;
    content: string;
    attachments?: unknown[];
    tasks_insert_to_chat_groups?: unknown[];
    labels?: unknown[];
    /** Present when replying within an existing thread. */
    thread?: string;
    [key: string]: unknown;
}
declare function lettersResource(call: CallFn): {
    getInbox: (mode?: string, offset?: number, extra?: Record<string, unknown>) => Promise<LetterRow[]>;
    getHistory: (thread: string) => Promise<LetterThread>;
    getMessageLabels: (thread: string) => Promise<unknown>;
    badge: () => Promise<unknown>;
    send: (body: SendLetterBody) => Promise<unknown>;
    seen: (thread: string) => Promise<unknown>;
    archive: (thread: string, { outbox }?: {
        outbox?: boolean;
    }) => Promise<unknown>;
    unarchive: (thread: string, { outbox }?: {
        outbox?: boolean;
    }) => Promise<unknown>;
    toggleBookmark: (thread: string) => Promise<unknown>;
};

declare const CHAT_PAGE_SIZE = 15;
interface SearchMessagesInput {
    /** 'all' or a dialog id. */
    mode?: string;
    offset?: number;
    search_str?: string;
    bookmarked?: boolean;
}
declare function chatResource(call: CallFn): {
    getDialogs: () => Promise<{
        dialogs?: Dialog[];
    }>;
    getFullChat: (dialog: string) => Promise<unknown>;
    getHistory: (dialog: string, offset?: number) => Promise<ChatMessage[]>;
    getChatView: (dialog: string) => Promise<unknown>;
    search: ({ mode, offset, search_str, bookmarked }?: SearchMessagesInput) => Promise<ChatMessage[]>;
    send: (message: Record<string, unknown>) => Promise<unknown>;
    removeSentMessage: (dialog: string, mid: string | number) => Promise<unknown>;
    createDialog: (user: string) => Promise<Dialog>;
    seen: (dialog: string, seen_count: number) => Promise<unknown>;
    fullHistory(dialog: string, { max, onPage }?: {
        max?: number;
        onPage?: (p: {
            offset: number;
            size: number;
            total: number;
        }) => void;
    }): Promise<ChatMessage[]>;
};
declare function taskFromMessage(message: ChatMessage | null | undefined): Task | null;

interface NewTaskCommentInput {
    /** The task's access_token JWT (not its id). */
    token: string;
    comment: string;
    attachments?: unknown[];
    mention?: unknown[];
    reply_id?: string | null;
}
interface SetCompletedInput {
    /** The task's access_token JWT. */
    token: string;
    completed: boolean;
    /** Required by the API even when null. */
    project: string | null;
    /** On reopen (completed:false) pass the target progress. */
    progress?: number | null;
    undone_user_id?: string | null;
}
declare function tasksResource(call: CallFn): {
    getAll: () => Promise<Task[]>;
    upcoming: (outbox?: boolean) => Promise<unknown>;
    badge: () => Promise<unknown>;
    getComments: (accessToken: string) => Promise<TaskComment[]>;
    add: (task: Record<string, unknown>) => Promise<Task | Task[]>;
    save: (task: Record<string, unknown>) => Promise<Task | Task[]>;
    remove: (accessToken: string) => Promise<unknown>;
    newComment: ({ token, comment, attachments, mention, reply_id }: NewTaskCommentInput) => Promise<unknown>;
    updateProgress: (accessToken: string, progress: number) => Promise<Task>;
    setCompleted: ({ token, completed, project, progress, undone_user_id }: SetCompletedInput) => Promise<Task>;
};

declare function projectsResource(call: CallFn): {
    getList: () => Promise<{
        projects?: Project[];
    }>;
    allSummary: () => Promise<unknown>;
};

declare function labelsResource(call: CallFn): {
    getAll: (type?: string) => Promise<unknown>;
};

declare function workspacesResource(call: CallFn): {
    bootstrap: () => Promise<Bootstrap>;
    switchRaw: (workspace_id: string) => Promise<unknown>;
    switchToken(workspace_id: string): Promise<string | null>;
    name: () => Promise<unknown>;
    planInfo: () => Promise<unknown>;
    getUsers: () => Promise<{
        users?: Member[];
    }>;
};

declare function dashboardResource(call: CallFn): {
    getAllSummary: () => Promise<DashboardSummaryRow[] | {
        summary?: DashboardSummaryRow[];
    }>;
    getAllWorkspacesUsers: () => Promise<unknown>;
};

declare function filesResource(http: Http): {
    /**
     * Download an attachment by its CDN content token; returns the bytes.
     * Content tokens expire — re-read the comment/message for a fresh one if
     * a download fails.
     */
    download(contentToken: string): Promise<Buffer>;
};

interface ClientOptions {
    /** Where tokens come from and how they refresh. Default: diskSession(). */
    tokens?: TokenProvider;
    /** Convenience: a fixed token (wraps staticToken). Ignored if tokens is set. */
    token?: string;
    /** Politeness delay between calls (ms). */
    pacingMs?: number;
}
interface MizitoClient {
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
}
declare function createClient({ tokens, token, pacingMs }?: ClientOptions): MizitoClient;
interface CreateMizitoOptions {
    token?: string | null;
    pacingMs?: number;
}
declare function createMizito({ token, pacingMs }?: CreateMizitoOptions): {
    /** Raw transport view ({ call, resolve }); token resolves via the provider. */
    client: {
        call: CallFn;
        resolve: (endpoint: string) => string;
        token: string | null | undefined;
        currentToken: () => Promise<string>;
    };
    bootstrap: () => Promise<Bootstrap>;
    switchWorkspace: (workspace_id: string) => Promise<unknown>;
    workspaceName: () => Promise<unknown>;
    planInfo: () => Promise<unknown>;
    members: () => Promise<{
        users?: Member[];
    }>;
    projects: () => Promise<{
        projects?: Project[];
    }>;
    projectSummaries: () => Promise<unknown>;
    taskLabels: () => Promise<unknown>;
    taskComments: (accessToken: string) => Promise<TaskComment[]>;
    addTask: (task: Record<string, unknown>) => Promise<Task | Task[]>;
    saveTask: (task: Record<string, unknown>) => Promise<Task | Task[]>;
    removeTask: (accessToken: string) => Promise<unknown>;
    newTaskComment: (input: Parameters<({ token, comment, attachments, mention, reply_id }: NewTaskCommentInput) => Promise<unknown>>[0]) => Promise<unknown>;
    updateTaskProgress: (accessToken: string, progress: number) => Promise<Task>;
    setTaskCompleted: (input: Parameters<({ token, completed, project, progress, undone_user_id }: SetCompletedInput) => Promise<Task>>[0]) => Promise<Task>;
    allTasks: () => Promise<Task[]>;
    upcomingFeed: (outbox?: boolean) => Promise<unknown>;
    tasksBadge: () => Promise<unknown>;
    inboxBadge: () => Promise<unknown>;
    sendMessage: (message: Record<string, unknown>) => Promise<unknown>;
    removeSentMessage: (dialog: string, mid: string | number) => Promise<unknown>;
    dialogs: () => Promise<{
        dialogs?: Dialog[];
    }>;
    fullChat: (dialog: string) => Promise<unknown>;
    history: (dialog: string, offset?: number) => Promise<ChatMessage[]>;
    chatView: (dialog: string) => Promise<unknown>;
    searchMessages: (input?: Parameters<({ mode, offset, search_str, bookmarked }?: SearchMessagesInput) => Promise<ChatMessage[]>>[0]) => Promise<ChatMessage[]>;
    createDialog: (user: string) => Promise<Dialog>;
    chatSeen: (dialog: string, seen_count: number) => Promise<unknown>;
    fullHistory: (dialog: string, opts?: Parameters<(dialog: string, { max, onPage }?: {
        max?: number;
        onPage?: (p: {
            offset: number;
            size: number;
            total: number;
        }) => void;
    }) => Promise<ChatMessage[]>>[1]) => Promise<ChatMessage[]>;
    dashboardSummary: () => Promise<DashboardSummaryRow[] | {
        summary?: DashboardSummaryRow[];
    }>;
    workspacesUsers: () => Promise<unknown>;
    letters: (mode?: string, offset?: number, extra?: Record<string, unknown>) => Promise<LetterRow[]>;
    letterThread: (thread: string) => Promise<LetterThread>;
    letterLabels: (thread: string) => Promise<unknown>;
    sendLetter: (body: Parameters<(body: SendLetterBody) => Promise<unknown>>[0]) => Promise<unknown>;
    letterSeen: (thread: string) => Promise<unknown>;
    letterArchive: (thread: string, opts?: {
        outbox?: boolean;
    }) => Promise<unknown>;
    letterUnarchive: (thread: string, opts?: {
        outbox?: boolean;
    }) => Promise<unknown>;
    letterToggleBookmark: (thread: string) => Promise<unknown>;
};
type Mizito = ReturnType<typeof createMizito>;

type MizitoErrorCode = 'auth' | 'rate_limit' | 'server' | 'api' | 'network' | 'not_found';
interface MizitoApiErrorOptions {
    code?: MizitoErrorCode;
    /** The envelope's `status` field, when the API rejected the call. */
    status?: number | boolean;
    httpStatus?: number;
    endpoint?: string;
    body?: unknown;
}
/** Map an HTTP status to an error code, or null if the status isn't an error class we type. */
declare function codeForHttpStatus(httpStatus: number): MizitoErrorCode | null;
declare class MizitoApiError extends Error {
    code: MizitoErrorCode;
    status?: number | boolean;
    httpStatus?: number;
    endpoint?: string;
    body?: unknown;
    constructor(message: string, { code, status, httpStatus, endpoint, body }?: MizitoApiErrorOptions);
}

declare function loadCredentials(): Credentials | null;
declare function hasCredentials(): boolean;
declare function reauthenticate(): Promise<{
    token: string;
    status: number | boolean;
    user: unknown;
} | null>;
/** A fixed token — for throwaway scripts, tests, and workspace-scoped clients. */
declare function staticToken(token: string): TokenProvider;
interface DiskSessionOptions {
    /** Path of the session file (default: <data root>/auth/session.json). */
    path?: string;
    /** Login credentials for self-healing; default: env or auth/credentials.json. */
    credentials?: Credentials | null;
}
/**
 * The default provider: token from auth/session.json (with the Playwright
 * storageState fallback); on expiry, re-login headless with the configured
 * credentials and rewrite the session file. This is what makes a stale session
 * heal itself instead of erroring.
 */
declare function diskSession({ path, credentials }?: DiskSessionOptions): TokenProvider;
/**
 * Pure headless sessions: log in with the given credentials on first use and
 * keep the token in memory only (nothing touches the disk).
 */
declare function passwordSession(credentials: Credentials): TokenProvider;

declare function hashPassword(password: string): string;

interface CreateSessionOptions extends Credentials {
    /** Persist the token to auth/session.json (like the browser login). Default true. */
    save?: boolean;
}
interface CreateSessionResult {
    token: string;
    status: number | boolean;
    user: unknown;
}
declare function createSession({ username, password, loginCode, regId, save, }: CreateSessionOptions): Promise<CreateSessionResult>;

declare const ROOT: string;
declare const WEB_BASE = "https://office.mizito.ir";
declare const WEB_LOGIN_URL = "https://office.mizito.ir/#/lg/login";
declare const API_BASE = "https://app.mizito.ir";
declare const API_PREFIX = "/api";
declare const LOGIN_PREFIX = "/capi";
declare const SESSION_CREATE_URL = "https://app.mizito.ir/capi/session/create";
declare const CDN_BASE = "https://app.mizito.ir/cdn/";
declare const TOKEN_HEADER = "x-token";
declare const AUTH_DIR: string;
declare const DATA_DIR: string;
declare const STORAGE_STATE_PATH: string;
declare const SESSION_PATH: string;
declare const CREDENTIALS_PATH: string;
declare const TARGET_WORKSPACE: string;

interface StorageState {
    origins?: Array<{
        origin?: string;
        localStorage?: Array<{
            name: string;
            value: string;
        }>;
    }>;
}
declare function tokenFromStorageState(storageState: StorageState | null | undefined): string | null;
declare function saveSession({ token, user }: {
    token: string;
    user?: unknown;
}, sessionPath?: string): SessionInfo;
declare function loadToken(sessionPath?: string): string | null;
declare function requireToken(): string;

interface MizitoContext {
    tokens: TokenProvider;
    /** The base session token (scoped to the account's active workspace). */
    token: string;
    root: MizitoClient;
    boot: Bootstrap;
}
interface WorkspaceRef {
    id: string;
    title: string;
    active: boolean;
}
declare function buildContext(tokensOrToken?: TokenProvider | string): Promise<MizitoContext>;
declare function resolveWorkspace(ctx: MizitoContext, { workspace }?: {
    workspace?: string;
}): Promise<{
    mz: MizitoClient;
    ws: WorkspaceRef;
}>;
declare function identity(ctx: MizitoContext): {
    uid: string;
    phone: string | undefined;
    client_version: string | undefined;
    workspaces: {
        id: string;
        title: string;
        active: boolean;
    }[];
};
declare function overview(ctx: MizitoContext): Promise<{
    workspace: string | undefined;
    workspaceId: string | undefined;
    inbox: number;
    unread_chats: number;
    tasks: {
        today: number;
        overdue: number;
        with_time: number;
        no_time: number;
    };
    meetings: number;
}[]>;
interface NormalizedTask {
    id: string;
    title: string;
    role: 'assignee' | 'responsible';
    notes: string;
    workspace: string;
    project: string | null;
    progress: number;
    completed: boolean;
    has_deadline: boolean;
    deadline: string | null;
    has_attachments: boolean;
    labels: number;
    modified_at: string | null;
    dialog: string | null;
}
declare function myTasks(ctx: MizitoContext, { workspace, includeCompleted }?: {
    workspace?: string;
    includeCompleted?: boolean;
}): Promise<{
    count: number;
    tasks: NormalizedTask[];
    errors: {
        workspace: string;
        error: string | undefined;
    }[];
}>;
declare function unreadMessages(ctx: MizitoContext, { workspace }?: {
    workspace?: string;
}): Promise<{
    conversations: number;
    total_unread: number;
    items: {
        dialog: string;
        title: string;
        workspace: string;
        is_group: boolean;
        is_project: boolean;
        unread_count: number;
        history_unread_count: number;
        last_message_date: string | number | null;
    }[];
    errors: {
        workspace: string;
        error: string | undefined;
    }[];
}>;

declare function listProjects(ctx: MizitoContext, { workspace }?: {
    workspace?: string;
}): Promise<{
    workspace: string;
    count: number;
    projects: {
        id: string;
        title: string;
        is_advanced: boolean;
        archived: boolean;
        dialog: string | null;
        boards: {
            id: string | null;
            title: string;
        }[];
    }[];
}>;
interface CreateTaskInput {
    workspace?: string;
    project?: string;
    board?: string;
    title: string;
    notes?: string;
    assignees?: string | string[] | null;
    deadline?: string | null;
    deadlineStart?: string | null;
    progress?: number;
    labels?: unknown[];
    postToChat?: boolean;
}
declare function createTask(ctx: MizitoContext, { workspace, project, board, title, notes, assignees, deadline, deadlineStart, progress, labels, postToChat, }: CreateTaskInput): Promise<{
    workspace: string;
    created: boolean;
    task: {
        id: string;
        title: string;
        project: string | null;
        board: string | null;
        assignees: number;
        progress: number;
        deadline: string | null;
        dialog: string | null;
    };
}>;
interface EditTaskInput {
    workspace?: string;
    taskId?: string;
    taskTitle?: string;
    title?: string;
    notes?: string;
    deadline?: string | null;
    deadlineStart?: string | null;
    progress?: number;
    board?: string | null;
    assignees?: string | string[] | null;
}
declare function editTask(ctx: MizitoContext, { workspace, taskId, taskTitle, title, notes, deadline, deadlineStart, progress, board, assignees }?: EditTaskInput): Promise<{
    workspace: string;
    task_id: string;
    title: string;
    progress: number;
    deadline: string | null;
    updated: boolean;
}>;
declare function commentOnTask(ctx: MizitoContext, { workspace, taskId, taskTitle, comment }: {
    workspace?: string;
    taskId?: string;
    taskTitle?: string;
    comment: string;
}): Promise<{
    workspace: string;
    task_id: string;
    title: string;
    commented: boolean;
}>;
declare function setTaskProgress(ctx: MizitoContext, { workspace, taskId, taskTitle, progress }: {
    workspace?: string;
    taskId?: string;
    taskTitle?: string;
    progress: number;
}): Promise<{
    workspace: string;
    task_id: string;
    title: string;
    progress: number;
    completed: boolean;
}>;
declare function setTaskCompleted(ctx: MizitoContext, { workspace, taskId, taskTitle, completed }?: {
    workspace?: string;
    taskId?: string;
    taskTitle?: string;
    completed?: boolean;
}): Promise<{
    workspace: string;
    task_id: string;
    title: string;
    completed: boolean;
}>;
declare function sendMessage(ctx: MizitoContext, { workspace, project, dialog, text }: {
    workspace?: string;
    project?: string;
    dialog?: string;
    text: string;
}): Promise<{
    workspace: string;
    dialog: string;
    sent_to: string | null;
    text: string;
    sent: boolean;
}>;
declare function getTaskComments(ctx: MizitoContext, { workspace, taskId, taskTitle }?: {
    workspace?: string;
    taskId?: string;
    taskTitle?: string;
}): Promise<{
    workspace: string;
    task_id: string;
    title: string;
    count: number;
    attachment_count: number;
    comments: {
        id: string;
        author: string | null;
        text: string;
        date: string | null;
        edited: boolean;
        attachments: Attachment[];
    }[];
}>;
declare function downloadAttachment(ctx: MizitoContext, { workspace, contentToken, name, dir, maxInlineBytes, }: {
    workspace?: string;
    contentToken: string;
    name?: string;
    dir?: string;
    maxInlineBytes?: number;
}): Promise<{
    workspace: string;
    name: string;
    path: string;
    size: number;
    saved: boolean;
    base64?: string;
}>;

declare function listLetters(ctx: MizitoContext, { workspace, box, limit }?: {
    workspace?: string;
    box?: string;
    limit?: number;
}): Promise<{
    workspace: string;
    box: string;
    count: number;
    letters: {
        thread: string | undefined;
        subject: string;
        from: string | null;
        recipients: (string | null)[] | undefined;
        unread: boolean;
        date: string | null;
        attachments: number;
        labels: number;
        registered: boolean;
        snippet: string;
    }[];
}>;
declare function readLetter(ctx: MizitoContext, { workspace, thread }: {
    workspace?: string;
    thread: string;
}): Promise<{
    workspace: string;
    thread: string;
    subject: string;
    from: string | null;
    to: {
        name: string | null;
        seen: boolean;
        seen_date: string | null;
        archived: boolean;
    }[];
    date: string | null;
    seen: boolean;
    bookmarked: boolean;
    labels: number;
    body: string;
    attachments: Attachment[];
    followups: {
        from: string | null;
        date: string | null;
        text: string;
        attachments: Attachment[];
    }[];
}>;
declare function sendLetter(ctx: MizitoContext, { workspace, to, subject, content, labels, }: {
    workspace?: string;
    to: string | string[];
    subject: string;
    content: string;
    labels?: unknown[];
}): Promise<{
    workspace: string;
    sent: boolean;
    recipients: number;
    subject: string;
    thread: string | null;
}>;
declare function replyLetter(ctx: MizitoContext, { workspace, thread, content }: {
    workspace?: string;
    thread: string;
    content: string;
}): Promise<{
    workspace: string;
    thread: string;
    recipients: number;
    replied: boolean;
}>;
declare function markLetterRead(ctx: MizitoContext, { workspace, thread }: {
    workspace?: string;
    thread: string;
}): Promise<{
    workspace: string;
    thread: string;
    marked_read: boolean;
}>;
declare function archiveLetter(ctx: MizitoContext, { workspace, thread, box, unarchive, }: {
    workspace?: string;
    thread: string;
    box?: string;
    unarchive?: boolean;
}): Promise<{
    workspace: string;
    thread: string;
    archived: boolean;
}>;

declare function listConversations(ctx: MizitoContext, { workspace, unreadOnly, limit }?: {
    workspace?: string;
    unreadOnly?: boolean;
    limit?: number;
}): Promise<{
    workspace: string;
    count: number;
    conversations: {
        dialog: string;
        title: string;
        kind: "project" | "group" | "direct";
        unread: number;
        messages: number;
        last_message_date: string | number | null;
    }[];
}>;
declare function readConversation(ctx: MizitoContext, { workspace, dialog, project, user, limit, }?: {
    workspace?: string;
    dialog?: string;
    project?: string;
    user?: string;
    limit?: number;
}): Promise<{
    workspace: string;
    dialog: string;
    conversation: string;
    count: number;
    messages: ({
        type: string;
        text: string;
        mid: string | number | null;
        from: string | null;
        mine: boolean;
        date: string | number | null;
        reply_to: {} | null;
    } | {
        type: string;
        task: {
            id: string | undefined;
            title: string | undefined;
            progress: number;
            completed: boolean;
        };
        mid: string | number | null;
        from: string | null;
        mine: boolean;
        date: string | number | null;
        reply_to: {} | null;
    } | {
        type: string;
        photo: {
            name: string;
            size: number | null;
            content_token: string | null;
            content_key: string | null;
        } | null;
        mid: string | number | null;
        from: string | null;
        mine: boolean;
        date: string | number | null;
        reply_to: {} | null;
    } | {
        type: string;
        attachment: Attachment | null;
        mid: string | number | null;
        from: string | null;
        mine: boolean;
        date: string | number | null;
        reply_to: {} | null;
    })[];
}>;
declare function messageUser(ctx: MizitoContext, { workspace, user, text }: {
    workspace?: string;
    user: string;
    text: string;
}): Promise<{
    workspace: string;
    dialog: string;
    sent_to: string;
    text: string;
    sent: boolean;
}>;

declare function ensureDir(dir: string): string;
declare function writeJson(filePath: string, value: unknown): string;
declare function readJson<T = unknown>(filePath: string, fallback?: T): T;
declare function exists(p: string): boolean;
declare const log: {
    info: (...a: unknown[]) => void;
    ok: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    err: (...a: unknown[]) => void;
};
declare function stripHtml(html: unknown): string;
declare function slug(name: unknown): string;
declare const sleep: (ms: number) => Promise<void>;

interface FileDescriptor extends Attachment {
    source_type: 'task' | 'comment' | 'message';
    source_id: string | null;
    task_id: string | null;
    dialog_id: string | null;
}
declare function docOf(node: unknown): Attachment | null;
declare function extractFiles(base: string): FileDescriptor[];

export { API_BASE, API_PREFIX, AUTH_DIR, type Attachment, type Bootstrap, CDN_BASE, CHAT_PAGE_SIZE, CREDENTIALS_PATH, type CallFn, type CallOptions, type ChatMessage, type ClientOptions, type CreateMizitoOptions, type CreateSessionOptions, type CreateSessionResult, type CreateTaskInput, type Credentials, DATA_DIR, type DashboardSummaryRow, type Dialog, type DiskSessionOptions, type DocumentNode, type EditTaskInput, type Envelope, type FileDescriptor, type Http, type HttpOptions, type KanbanBoard, LOGIN_PREFIX, type LetterRow, type LetterThread, type Member, type MessageMedia, type Mizito, MizitoApiError, type MizitoApiErrorOptions, type MizitoClient, type MizitoContext, type MizitoErrorCode, type NormalizedTask, type Project, ROOT, SESSION_CREATE_URL, SESSION_PATH, STORAGE_STATE_PATH, type SessionInfo, TARGET_WORKSPACE, TOKEN_HEADER, type Task, type TaskComment, type TaskRoleRef, type TokenProvider, WEB_BASE, WEB_LOGIN_URL, type Workspace, type WorkspaceRef, archiveLetter, buildContext, codeForHttpStatus, commentOnTask, createClient, createHttp, createMizito, createSession, createTask, diskSession, docOf, downloadAttachment, editTask, ensureDir, exists, extractFiles, getTaskComments, hasCredentials, hashPassword, identity, listConversations, listLetters, listProjects, loadCredentials, loadToken, log, markLetterRead, messageUser, myTasks, overview, passwordSession, readConversation, readJson, readLetter, reauthenticate, replyLetter, requireToken, resolveWorkspace, saveSession, sendLetter, sendMessage, setTaskCompleted, setTaskProgress, sleep, slug, staticToken, stripHtml, taskFromMessage, tokenFromStorageState, unreadMessages, writeJson };
