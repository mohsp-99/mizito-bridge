// Workspace-aware LETTERS layer — Mizito's formal correspondence module
// ("inbox", the دبیرخانه/مکاتبات feature). Letters are threaded like email:
// each is addressed by a `thread` id, filed in a mailbox (inbox | outbox |
// archive), and carries recipients (with per-person read receipts), an HTML
// body, attachments, and labels.
//
// This mirrors core/write.js for tasks: reads are normalized and safe; the
// send/reply/seen/archive helpers MUTATE your account and run only when a tool
// calls them. Every op targets ONE workspace (the active one unless a name/id is
// given) and resolves member names to ids, failing loudly rather than guessing.
//
// The letter READ endpoints are verified live (see apps/crawler/letters-probe or
// docs/API_NOTES.md); the letter WRITE endpoints are recovered from the SPA
// bundle but not yet exercised end-to-end.
import { resolveWorkspace } from './feed.js';
import { loadMembers, findByName, fullName, attachmentOf } from './write.js';
import { stripHtml } from './util.js';

const MAILBOXES = new Set(['inbox', 'outbox', 'archive']);

const nameOf = (map, id) => (id ? map.get(id) || id : null);

function memberMap(members) {
  return new Map(members.map((m) => [m._id, fullName(m) || m.username || m._id]));
}

// One-line preview of an HTML letter body.
function snippet(html, n = 240) {
  const s = stripHtml(html).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// Resolve member name/id refs to ids (recipients for a new letter).
function resolveRecipients(members, refs, wsTitle) {
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
export async function listLetters(ctx, { workspace, box = 'inbox', limit = 30 } = {}) {
  const mode = MAILBOXES.has(String(box)) ? String(box) : 'inbox';
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const [rows, members] = await Promise.all([
    mz.letters(mode, 0).catch(() => []),
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
export async function readLetter(ctx, { workspace, thread } = {}) {
  if (!thread || !String(thread).trim()) throw new Error('thread is required (from mizito_letters).');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const [letter, members] = await Promise.all([
    mz.letterThread(thread),
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
  const attachments = (letter.attachments || []).map(attachmentOf).filter(Boolean);
  // Replies within the thread (a multi-message correspondence).
  const followups = (letter.messages || []).map((m) => ({
    from: nameOf(names, m.from),
    date: m.send_date || m.date || null,
    text: stripHtml(m.content || m.message || ''),
    attachments: (m.attachments || []).map(attachmentOf).filter(Boolean),
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
export async function sendLetter(ctx, { workspace, to, subject, content, labels = [] } = {}) {
  if (!subject || !String(subject).trim()) throw new Error('subject is required.');
  if (!content || !String(content).trim()) throw new Error('content is required.');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const members = await loadMembers(mz);
  const toIds = resolveRecipients(members, to, ws.title);
  if (!toIds.length) throw new Error('At least one recipient (to) is required.');

  const body = {
    to: toIds,
    subject: String(subject),
    content: String(content),
    attachments: [],
    tasks_insert_to_chat_groups: [],
    labels: labels ?? [],
  };
  const res = await mz.sendLetter(body);
  return {
    workspace: ws.title,
    sent: true,
    recipients: toIds.length,
    subject: body.subject,
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
export async function replyLetter(ctx, { workspace, thread, content } = {}) {
  if (!thread || !String(thread).trim()) throw new Error('thread is required.');
  if (!content || !String(content).trim()) throw new Error('content is required.');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const letter = await mz.letterThread(thread);
  if (!letter || typeof letter !== 'object') {
    throw new Error(`No letter thread "${thread}" in "${ws.title}".`);
  }

  const me = ctx.boot.uid;
  const participants = new Set();
  if (letter.from) participants.add(letter.from);
  for (const t of letter.to || []) if (t.user) participants.add(t.user);
  participants.delete(me);
  const toIds = [...participants];

  const body = {
    thread,
    to: toIds,
    subject: letter.subject || '',
    content: String(content),
    attachments: [],
    tasks_insert_to_chat_groups: [],
    labels: [],
  };
  await mz.sendLetter(body);
  return { workspace: ws.title, thread, recipients: toIds.length, replied: true };
}

// ---------------------------------------------------------------------------
// Mark a letter thread read. WRITE (mutating).
// ---------------------------------------------------------------------------
export async function markLetterRead(ctx, { workspace, thread } = {}) {
  if (!thread || !String(thread).trim()) throw new Error('thread is required.');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  await mz.letterSeen(thread);
  return { workspace: ws.title, thread, marked_read: true };
}

// ---------------------------------------------------------------------------
// Archive (or unarchive) a letter thread. WRITE (mutating).
//
// Sent letters (box:'outbox') use the `.sender` archive variant. Pass
// unarchive:true to move it back.
// ---------------------------------------------------------------------------
export async function archiveLetter(ctx, { workspace, thread, box = 'inbox', unarchive = false } = {}) {
  if (!thread || !String(thread).trim()) throw new Error('thread is required.');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const outbox = String(box) === 'outbox';
  if (unarchive) await mz.letterUnarchive(thread, { outbox });
  else await mz.letterArchive(thread, { outbox });
  return { workspace: ws.title, thread, archived: !unarchive };
}
