// Shared extraction of file/attachment descriptors from a crawled workspace
// directory. Used by both the SQLite loader and the file downloader so the two
// always agree on what counts as a file.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, exists } from './util.js';
import type { Attachment, ChatMessage, Task } from './types/index.js';

export interface FileDescriptor extends Attachment {
  source_type: 'task' | 'comment' | 'message';
  source_id: string | null;
  task_id: string | null;
  dialog_id: string | null;
}

// A Mizito attachment/message media node -> { id, name, size, content_token, content_key }
export function docOf(node: unknown): Attachment | null {
  const d = (node as { media?: { document?: { _id?: string; name?: string; size?: number | null; content?: string | null; content_key?: string | null } } } | null)
    ?.media?.document;
  if (!d?._id) return null;
  return {
    id: d._id,
    name: d.name || d._id,
    size: d.size ?? null,
    content_token: d.content || null,
    content_key: d.content_key || null,
  };
}

// Walk a crawled workspace dir and return one descriptor per unique file
// (deduped by document id), tagged with where it came from.
export function extractFiles(base: string): FileDescriptor[] {
  const out = new Map<string, FileDescriptor>(); // id -> descriptor

  const add = (doc: Attachment | null, extra: Omit<FileDescriptor, keyof Attachment>) => {
    if (!doc || out.has(doc.id)) return;
    out.set(doc.id, { ...doc, ...extra });
  };

  // tasks.json: task attachments + last-comment attachments
  const tasks = readJson<Task[]>(path.join(base, 'tasks.json'), []);
  for (const t of tasks) {
    for (const a of t.attachments || [])
      add(docOf(a), { source_type: 'task', source_id: t._id, task_id: t._id, dialog_id: (t as { _dialog?: string })._dialog ?? null });
    for (const a of t.last_comment?.attachments || [])
      add(docOf(a), { source_type: 'comment', source_id: t._id, task_id: t._id, dialog_id: (t as { _dialog?: string })._dialog ?? null });
  }

  // comments.json: full comment threads' attachments
  const commentDoc = readJson<Array<{ task_id?: string; comments?: Array<{ _id?: string; attachments?: unknown[] }> }>>(
    path.join(base, 'comments.json'),
    [],
  );
  for (const entry of commentDoc) {
    for (const cm of entry.comments || []) {
      for (const a of cm.attachments || [])
        add(docOf(a), { source_type: 'comment', source_id: cm._id ?? null, task_id: entry.task_id ?? null, dialog_id: null });
    }
  }

  // chats/*.json: standalone document messages
  const chatsDir = path.join(base, 'chats');
  if (exists(chatsDir)) {
    for (const f of fs.readdirSync(chatsDir)) {
      const chat = readJson<{ messages?: ChatMessage[] }>(path.join(chatsDir, f), { messages: [] });
      const dialogId = path.basename(f, '.json');
      for (const m of chat.messages || []) {
        add(docOf(m), {
          source_type: 'message',
          source_id: m._id ?? null,
          task_id: m.media?.task?._id ?? null,
          dialog_id: dialogId,
        });
      }
    }
  }

  return [...out.values()];
}
