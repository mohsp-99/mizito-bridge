// Letters / correspondence endpoints ("inbox" — Mizito's دبیرخانه/مکاتبات).
// Formal letters, threaded like email. Every op is keyed by `thread`; `mode`
// is the mailbox ('inbox' | 'outbox' | 'archive'). See docs/API_NOTES.md.
// The response shape carries per-recipient read receipts and attachments.
import type { CallFn } from '../transport/http.js';
import type { LetterRow, LetterThread } from '../types/index.js';

export interface SendLetterBody {
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

export function lettersResource(call: CallFn) {
  return {
    getInbox: (mode = 'inbox', offset = 0, extra: Record<string, unknown> = {}) =>
      call<LetterRow[]>('inbox/getInbox', { mode, offset, ...extra }),
    getHistory: (thread: string) => call<LetterThread>('inbox/getHistory', { thread }),
    getMessageLabels: (thread: string) => call('inbox/getMessageLabels', { thread }),
    badge: () => call('inbox/badge', {}),

    // --- writes (mutating). Recovered from the SPA bundle; unlike the
    // task/chat writes these are NOT yet exercised live — see docs/API_NOTES.md.
    // Compose/send a letter. `body` is the compose model:
    // { to:[uid], subject, content, attachments:[], tasks_insert_to_chat_groups:[],
    //   labels:[] } — plus `thread` when replying within an existing thread.
    send: (body: SendLetterBody) => call('inbox/send', body),
    seen: (thread: string) => call('inbox/seen', { thread }),
    // Archive/unarchive a letter thread. Sent (outbox) letters use the
    // `.sender` variant (dots map to slashes in the URL).
    archive: (thread: string, { outbox = false }: { outbox?: boolean } = {}) =>
      call(outbox ? 'inbox/archive/sender' : 'inbox/archive', { thread }),
    unarchive: (thread: string, { outbox = false }: { outbox?: boolean } = {}) =>
      call(outbox ? 'inbox/unArchive/sender' : 'inbox/unArchive', { thread }),
    toggleBookmark: (thread: string) => call('inbox/toggleBookmark', { thread }),
  };
}

export type LettersResource = ReturnType<typeof lettersResource>;
