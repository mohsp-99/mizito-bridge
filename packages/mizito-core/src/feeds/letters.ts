// Workspace-aware LETTERS layer — Mizito's formal correspondence module
// ("inbox", the دبیرخانه/مکاتبات feature). Letters are threaded like email:
// each is addressed by a `thread` id, filed in a mailbox (inbox | outbox |
// archive), and carries recipients (with per-person read receipts), an HTML
// body, attachments, and labels.
//
// This mirrors feeds/write.ts for tasks: reads are normalized and safe; the
// send/reply/seen/archive helpers MUTATE your account and run only when a tool
// calls them. Every op targets ONE workspace (the active one unless a name/id is
// given) and resolves member names to ids, failing loudly rather than guessing.
//
// The letter READ endpoints are verified live; the letter WRITE endpoints are
// recovered from the SPA bundle but not yet exercised end-to-end (see
// docs/API_NOTES.md).
import { resolveWorkspace } from './index.js';
import type { MizitoContext } from './index.js';
import { loadMembers, findByName, fullName, attachmentOf, asMediaWrapper, assertWriteAccepted } from './write.js';
import type { AttachmentOptions, MediaWrapper } from './write.js';
import type { MizitoClient } from '../client.js';
import { stripHtml } from '../util.js';
import type { Attachment, Member } from '../types/index.js';

const MAILBOXES = new Set(['inbox', 'outbox', 'archive']);

// Upload each `files` entry and return the full attachment list in the shape a
// letter wants: the bare `{_: 'messageMediaDocument', document}` wrapper, with
// NO `media` layer. This is the mirror image of feeds/write.ts::collectAttachments
// (tasks nest the same wrapper under `media`) — verified live against
// inbox/getHistory on several letters, at both thread and reply level.
//
// Pre-supplied `attachments` go through asMediaWrapper too: AttachmentOptions is
// shared with the task writes and documents that either shape is accepted, so a
// caller may well hand us an entry read back off a task. Spreading those in raw
// is what would have posted a task-shaped `{_id, media}` into a letter.
async function collectLetterAttachments(
  mz: MizitoClient,
  { attachments = [], files = [] }: AttachmentOptions,
): Promise<MediaWrapper[]> {
  const uploaded: MediaWrapper[] = [];
  for (const f of files) {
    const doc = await mz.content.upload(f.data, {
      filename: f.filename,
      maxWidthHeight: f.maxWidthHeight,
      sendAsFile: f.sendAsFile,
    });
    uploaded.push(asMediaWrapper(doc));
  }
  return [...attachments.map(asMediaWrapper), ...uploaded];
}

// `inbox/send` has never been exercised live, so its success shape is unknown —
// the SPA bundle shows the response used as an object. Reject only what is
// unambiguously a refusal (a bare `false`/null, or an { error } body) rather
// than inventing a success predicate we cannot verify. This at least closes the
// hole the task comments fell through, where a bare `false` read as success.
function assertLetterAccepted(res: unknown, what: string): void {
  assertWriteAccepted(res, what);
  const err = (res as { error?: unknown; msg?: string } | null)?.error;
  if (err) {
    throw new Error(`${what} was rejected by Mizito: ${(res as { msg?: string }).msg ?? String(err)}`);
  }
}

const nameOf = (map: Map<string, string>, id: string | null | undefined): string | null =>
  id ? map.get(id) || id : null;

function memberMap(members: Member[]): Map<string, string> {
  return new Map(members.map((m) => [m._id, fullName(m) || m.username || m._id]));
}

// One-line preview of an HTML letter body.
function snippet(html: unknown, n = 240): string {
  const s = stripHtml(html).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// Resolve member name/id refs to ids (recipients for a new letter).
function resolveRecipients(members: Member[], refs: string | string[] | null | undefined, wsTitle: string): string[] {
  const list = refs == null ? [] : Array.isArray(refs) ? refs : [refs];
  return list.map((ref) => {
    const u =
      findByName(members, ref, fullName) ||
      findByName(members, ref, (m) => m.first_name) ||
      findByName(members, ref, (m) => m.username);
    if (!u) throw new Error(`No member matches "${ref}" in "${wsTitle}".`);
    return u._id;
  });
}

// ---------------------------------------------------------------------------
// List letters in a mailbox (inbox / outbox / archive), normalized.
// ---------------------------------------------------------------------------
export async function listLetters(
  ctx: MizitoContext,
  { workspace, box = 'inbox', limit = 30 }: { workspace?: string; box?: string; limit?: number } = {},
) {
  const mode = MAILBOXES.has(String(box)) ? String(box) : 'inbox';
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const [rows, members] = await Promise.all([
    mz.letters.getInbox(mode, 0).catch(() => []),
    loadMembers(mz).catch(() => []),
  ]);
  const names = memberMap(members);

  const letters = (Array.isArray(rows) ? rows : []).slice(0, limit).map((r) => ({
    thread: r.thread || r._id,
    subject: r.subject || '(no subject)',
    from: nameOf(names, r.from),
    // Sent letters carry `receivers`; received ones don't list them in the row.
    recipients: Array.isArray(r.receivers) ? r.receivers.map((id) => nameOf(names, id)) : undefined,
    unread: !!r.unread,
    date: r.send_date || null,
    attachments: r.attachments_count ?? 0,
    labels: Array.isArray(r.labels) ? r.labels.length : 0,
    // A non-empty `secretariat` means the letter is formally registered
    // (نامه‌ی ثبت‌شده در دبیرخانه) with an in/out number.
    registered: !!(r.secretariat && Object.keys(r.secretariat).length),
    snippet: snippet(r.short_content || r.raw_content || ''),
  }));

  return { workspace: ws.title, box: mode, count: letters.length, letters };
}

// ---------------------------------------------------------------------------
// Read one letter thread in full (body, recipients + read receipts, files).
// ---------------------------------------------------------------------------
export async function readLetter(
  ctx: MizitoContext,
  { workspace, thread }: { workspace?: string; thread: string },
) {
  if (!thread || !String(thread).trim()) throw new Error('thread is required (from mizito_letters).');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const [letter, members] = await Promise.all([
    mz.letters.getHistory(thread),
    loadMembers(mz).catch(() => []),
  ]);
  if (!letter || typeof letter !== 'object') {
    throw new Error(`No letter thread "${thread}" in "${ws.title}".`);
  }
  const names = memberMap(members);

  const recipients = (letter.to || []).map((t) => ({
    name: nameOf(names, t.user),
    seen: !t.unread,
    seen_date: t.seen_date || null,
    archived: !!t.archived,
  }));
  const attachments = (letter.attachments || []).map(attachmentOf).filter((x): x is Attachment => x != null);
  // Replies within the thread (a multi-message correspondence).
  const followups = (letter.messages || []).map((m) => ({
    from: nameOf(names, m.from),
    date: m.send_date || m.date || null,
    text: stripHtml(m.content || m.message || ''),
    attachments: (m.attachments || []).map(attachmentOf).filter((x): x is Attachment => x != null),
  }));

  return {
    workspace: ws.title,
    thread: letter.thread || thread,
    subject: letter.subject || '(no subject)',
    from: nameOf(names, letter.from),
    to: recipients,
    date: letter.send_date || null,
    seen: !!letter.is_seen,
    bookmarked: !!letter.bookmarked,
    labels: Array.isArray(letter.labels) ? letter.labels.length : 0,
    body: stripHtml(letter.content || ''),
    attachments,
    followups,
  };
}

// ---------------------------------------------------------------------------
// Send a new letter. WRITE (mutating).
//
// The compose model the SPA posts to inbox/send is
//   { to:[uid], subject, content, attachments:[], tasks_insert_to_chat_groups:[],
//     labels:[] }
// `to` is required (the API rejects an empty recipient list). `content` is HTML
// in the app; a plain string is fine (it renders as text).
// ---------------------------------------------------------------------------
export async function sendLetter(
  ctx: MizitoContext,
  {
    workspace,
    to,
    subject,
    content,
    labels = [],
    attachments = [],
    files = [],
  }: {
    workspace?: string;
    to: string | string[];
    subject: string;
    content: string;
    labels?: unknown[];
  } & AttachmentOptions,
) {
  if (!subject || !String(subject).trim()) throw new Error('subject is required.');
  if (!content || !String(content).trim()) throw new Error('content is required.');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const members = await loadMembers(mz);
  const toIds = resolveRecipients(members, to, ws.title);
  if (!toIds.length) throw new Error('At least one recipient (to) is required.');

  // Letters take the bare media wrapper, NOT the `media`-nested entry tasks use
  // (see collectLetterAttachments).
  const attachmentDocs = await collectLetterAttachments(mz, { attachments, files });

  const body = {
    to: toIds,
    subject: String(subject),
    content: String(content),
    attachments: attachmentDocs,
    tasks_insert_to_chat_groups: [],
    labels: labels ?? [],
  };
  const res = (await mz.letters.send(body)) as { thread?: string; _id?: string } | null;
  assertLetterAccepted(res, `Sending "${body.subject}"`);
  // Verified live 2026-07-20: the send response carries neither `thread` nor
  // `_id`, so `thread` below is normally null. To find the letter afterwards,
  // list the outbox (newest first) — see listLetters({box:'outbox'}).
  return {
    workspace: ws.title,
    // Not refused — see assertLetterAccepted. That is weaker than confirmed
    // delivery: the endpoint gives us nothing to confirm against.
    sent: true,
    recipients: toIds.length,
    subject: body.subject,
    attachments: attachmentDocs.length,
    thread: res?.thread || res?._id || null,
  };
}

// ---------------------------------------------------------------------------
// Reply within an existing letter thread. WRITE (mutating).
//
// A reply reuses inbox/send with the thread id set, re-addressed to the original
// participants (sender + other recipients, minus me). Reads the thread first to
// derive the subject and recipient set so the reply lands with the right people.
// ---------------------------------------------------------------------------
export async function replyLetter(
  ctx: MizitoContext,
  {
    workspace,
    thread,
    content,
    attachments = [],
    files = [],
  }: { workspace?: string; thread: string; content: string } & AttachmentOptions,
) {
  if (!thread || !String(thread).trim()) throw new Error('thread is required.');
  if (!content || !String(content).trim()) throw new Error('content is required.');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const letter = await mz.letters.getHistory(thread);
  if (!letter || typeof letter !== 'object') {
    throw new Error(`No letter thread "${thread}" in "${ws.title}".`);
  }

  const me = ctx.boot.uid;
  const participants = new Set<string>();
  if (letter.from) participants.add(letter.from);
  for (const t of letter.to || []) if (t.user) participants.add(t.user);
  participants.delete(me);
  const toIds = [...participants];

  const attachmentDocs = await collectLetterAttachments(mz, { attachments, files });
  const body = {
    thread,
    to: toIds,
    subject: letter.subject || '',
    content: String(content),
    attachments: attachmentDocs,
    tasks_insert_to_chat_groups: [],
    labels: [],
  };
  const res = await mz.letters.send(body);
  assertLetterAccepted(res, `Replying to "${body.subject}"`);
  return {
    workspace: ws.title,
    thread,
    recipients: toIds.length,
    attachments: attachmentDocs.length,
    replied: true,
  };
}

// ---------------------------------------------------------------------------
// Mark a letter thread read. WRITE (mutating).
// ---------------------------------------------------------------------------
export async function markLetterRead(
  ctx: MizitoContext,
  { workspace, thread }: { workspace?: string; thread: string },
) {
  if (!thread || !String(thread).trim()) throw new Error('thread is required.');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  await mz.letters.seen(thread);
  return { workspace: ws.title, thread, marked_read: true };
}

// ---------------------------------------------------------------------------
// Archive (or unarchive) a letter thread. WRITE (mutating).
//
// Sent letters (box:'outbox') use the `.sender` archive variant. Pass
// unarchive:true to move it back.
// ---------------------------------------------------------------------------
export async function archiveLetter(
  ctx: MizitoContext,
  {
    workspace,
    thread,
    box = 'inbox',
    unarchive = false,
  }: { workspace?: string; thread: string; box?: string; unarchive?: boolean },
) {
  if (!thread || !String(thread).trim()) throw new Error('thread is required.');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const outbox = String(box) === 'outbox';
  if (unarchive) await mz.letters.unarchive(thread, { outbox });
  else await mz.letters.archive(thread, { outbox });
  return { workspace: ws.title, thread, archived: !unarchive };
}
