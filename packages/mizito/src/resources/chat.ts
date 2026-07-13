// Chat / dialog endpoints. A "dialog" is any conversation: a direct message,
// a team group, or a project group (tasks live in project groups as messages).
import type { CallFn } from '../transport/http.js';
import type { ChatMessage, Dialog, Task } from '../types/index.js';

export const CHAT_PAGE_SIZE = 15; // chat/getHistory returns 15 messages per page

export interface SearchMessagesInput {
  /** 'all' or a dialog id. */
  mode?: string;
  offset?: number;
  search_str?: string;
  bookmarked?: boolean;
}

export function chatResource(call: CallFn) {
  const getHistory = (dialog: string, offset = 0) =>
    call<ChatMessage[]>('chat/getHistory', { dialog, offset });

  return {
    getDialogs: () => call<{ dialogs?: Dialog[] }>('chat/getDialogs', {}),
    getFullChat: (dialog: string) => call('chat/getFullChat', { dialog }),
    getHistory,
    // Combined view of a dialog (members, admins, pinned, counts, title).
    getChatView: (dialog: string) => call('chat/getChatView', { dialog }),
    // Full-text search across messages. mode='all' (or a dialog id); optional
    // search_str and bookmarked filter. Returns an array of matching messages.
    search: ({ mode = 'all', offset = 0, search_str, bookmarked }: SearchMessagesInput = {}) =>
      call<ChatMessage[]>('chat/search', {
        mode,
        offset,
        ...(search_str ? { search_str } : {}),
        ...(bookmarked ? { bookmarked } : {}),
      }),

    // --- writes (mutating) ---
    // Send a message to a dialog. `message` is the full outgoing message object
    // ({ _:'message', dialog, out:true, message, from, date, randomId, ... }).
    // Returns `true` on success (no message id echoed back).
    send: (message: Record<string, unknown>) => call('chat/send', message),
    // Delete a message you sent, addressed by dialog + message id (mid).
    removeSentMessage: (dialog: string, mid: string | number) =>
      call('chat/removeSentMessage', { dialog, mid }),
    // Open (or return) a direct-message dialog with a user. Returns the dialog.
    createDialog: (user: string) => call<Dialog>('chat/createDialog', { user }),
    // Mark a dialog seen up to `seen_count` messages.
    seen: (dialog: string, seen_count: number) => call('chat/seen', { dialog, seen_count }),

    // Page through a dialog's entire message history. Returns all messages,
    // oldest-to-newest order as the API provides them.
    async fullHistory(
      dialog: string,
      { max = 100000, onPage }: { max?: number; onPage?: (p: { offset: number; size: number; total: number }) => void } = {},
    ): Promise<ChatMessage[]> {
      const all: ChatMessage[] = [];
      let offset = 0;
      for (;;) {
        const page = await getHistory(dialog, offset);
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

export type ChatResource = ReturnType<typeof chatResource>;

// Pull the task object out of a Mizito chat message, or null if it isn't a task.
export function taskFromMessage(message: ChatMessage | null | undefined): Task | null {
  if (message?.media?._ === 'messageMediaTask' && message.media.task) {
    return message.media.task;
  }
  return null;
}
