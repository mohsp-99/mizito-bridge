// Workspace-aware CONVERSATIONS layer (Mizito chat).
//
// feeds/index.ts already answers "which conversations have unread messages?"
// across all workspaces. This module goes deeper within a workspace: list every
// conversation, and READ a conversation's message history — normalized so each
// message reports its author, direction, time, and kind (text / task / photo /
// document / service). It also adds one WRITE: message a specific member
// directly (opening the DM if it doesn't exist yet).
//
// A "dialog" is any conversation: a direct message, a team group, or a project
// group. Project-group messages are mostly task cards (a task is a message whose
// media is `messageMediaTask`; see docs/MIZITO_INTERNALS.md).
import { resolveWorkspace } from './index.js';
import type { MizitoContext } from './index.js';
import type { MizitoClient } from '../client.js';
import { loadProjects, loadMembers, findByName, fullName, attachmentOf } from './write.js';
import { taskFromMessage, CHAT_PAGE_SIZE } from '../resources/chat.js';
import type { ChatMessage, Dialog, Member, MessageMedia } from '../types/index.js';
import type { WorkspaceRef } from './index.js';

const nameOf = (map: Map<string, string>, id: string | null | undefined): string | null =>
  id ? map.get(id) || id : null;

function memberMap(members: Member[]): Map<string, string> {
  return new Map(members.map((m) => [m._id, fullName(m) || m.username || m._id]));
}

function dialogTitle(d: Dialog, names: Map<string, string>): string {
  if (d.title) return d.title;
  if (d.is_group || d.is_project_group) return '(group)';
  return nameOf(names, d.peer_user) || '(direct message)';
}

function dialogKind(d: Dialog): 'project' | 'group' | 'direct' {
  if (d.is_project_group) return 'project';
  if (d.is_group) return 'group';
  return 'direct';
}

// Pick the CDN token for a photo message (prefer the largest rendition).
function photoOf(photo: MessageMedia['photo'] | null | undefined) {
  if (!photo) return null;
  const r = photo.photo_large || photo.photo_medium || photo.photo_small || {};
  return {
    name: photo.name || photo._id || 'photo',
    size: r.size ?? null,
    content_token: r.content || null,
    content_key: r.content_key || photo.content_key || null,
  };
}

// Normalize a chat message into a compact, readable shape.
function normalizeMessage(m: ChatMessage, names: Map<string, string>, uid: string) {
  const kind = m?.media?._ || m?._ || (typeof m?.message === 'string' ? 'message' : 'unknown');
  const base = {
    mid: m._id || m.mid || null,
    from: nameOf(names, m.from),
    mine: m.from === uid,
    date: m.date || null,
    reply_to: m.reply_to || null,
  };
  switch (kind) {
    case 'message':
      return { ...base, type: 'text', text: m.message || '' };
    case 'messageMediaTask':
    case 'messageMediaMentionInTask': {
      const t = taskFromMessage(m) || m.media?.task || ({} as Record<string, unknown>);
      return {
        ...base,
        type: kind === 'messageMediaMentionInTask' ? 'task_mention' : 'task',
        task: {
          id: (t as { _id?: string })._id,
          title: (t as { title?: string }).title,
          progress: (t as { progress?: number }).progress ?? 0,
          completed: !!(t as { completed?: boolean }).completed,
        },
      };
    }
    case 'messageMediaPhoto':
      return { ...base, type: 'photo', photo: photoOf(m.media?.photo) };
    case 'messageMediaDocument':
      return { ...base, type: 'document', attachment: attachmentOf(m.media) };
    case 'messageService':
      return { ...base, type: 'service', text: m.message || m.action || '(event)' };
    default:
      return { ...base, type: kind, text: m.message || '' };
  }
}

// ---------------------------------------------------------------------------
// List conversations in a workspace (optionally only those with unread).
// ---------------------------------------------------------------------------
export async function listConversations(
  ctx: MizitoContext,
  { workspace, unreadOnly = false, limit = 50 }: { workspace?: string; unreadOnly?: boolean; limit?: number } = {},
) {
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const [res, members] = await Promise.all([
    mz.chat.getDialogs(),
    loadMembers(mz).catch(() => []),
  ]);
  const names = memberMap(members);
  let dialogs = res?.dialogs ?? [];
  if (unreadOnly) {
    dialogs = dialogs.filter((d) => (d.unread_count ?? 0) > 0 || (d.history_unread_count ?? 0) > 0);
  }
  dialogs.sort((a, b) => String(b.last_message_date).localeCompare(String(a.last_message_date)));

  const conversations = dialogs.slice(0, limit).map((d) => ({
    dialog: d._id,
    title: dialogTitle(d, names),
    kind: dialogKind(d),
    unread: d.unread_count ?? d.history_unread_count ?? 0,
    messages: d.messages_count ?? 0,
    last_message_date: d.last_message_date ?? null,
  }));
  return { workspace: ws.title, count: conversations.length, conversations };
}

// Resolve which dialog to read from: an explicit dialog id, a project (its group
// chat), or a member (an existing direct-message dialog — not created here).
async function resolveDialog(
  ctx: MizitoContext,
  mz: MizitoClient,
  ws: WorkspaceRef,
  { dialog, project, user }: { dialog?: string; project?: string; user?: string },
): Promise<{ dialog: string; where: string }> {
  if (dialog) return { dialog, where: dialog };
  if (project) {
    const projects = (await loadProjects(mz)).filter((p) => !p.deleted);
    const proj = findByName(projects, project, (p) => p.title);
    if (!proj) throw new Error(`No project matches "${project}" in "${ws.title}".`);
    if (!proj.dialog) throw new Error(`Project "${proj.title}" has no chat dialog.`);
    return { dialog: proj.dialog, where: proj.title };
  }
  if (user) {
    const [members, res] = await Promise.all([loadMembers(mz), mz.chat.getDialogs()]);
    const u =
      findByName(members, user, fullName) ||
      findByName(members, user, (m) => m.first_name) ||
      findByName(members, user, (m) => m.username);
    if (!u) throw new Error(`No member matches "${user}" in "${ws.title}".`);
    const dm = (res?.dialogs ?? []).find(
      (d) => !d.is_group && !d.is_project_group && d.peer_user === u._id,
    );
    if (!dm) {
      throw new Error(
        `No existing direct message with "${fullName(u) || user}". Send them a message first (mizito_send_message with user).`,
      );
    }
    return { dialog: dm._id, where: fullName(u) || user };
  }
  throw new Error('Provide a dialog id, a project name/id, or a user name/id to read.');
}

// ---------------------------------------------------------------------------
// Read a conversation's recent messages, normalized and in chronological order.
// ---------------------------------------------------------------------------
export async function readConversation(
  ctx: MizitoContext,
  {
    workspace,
    dialog,
    project,
    user,
    limit = 30,
  }: { workspace?: string; dialog?: string; project?: string; user?: string; limit?: number } = {},
) {
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const { dialog: dlg, where } = await resolveDialog(ctx, mz, ws, { dialog, project, user });

  const cap = Math.max(1, Math.min(Number(limit) || 30, 200));
  const collected: ChatMessage[] = [];
  let offset = 0;
  for (;;) {
    const page = await mz.chat.getHistory(dlg, offset).catch(() => [] as ChatMessage[]);
    if (!Array.isArray(page) || page.length === 0) break;
    collected.push(...page);
    offset += page.length;
    if (collected.length >= cap || page.length < CHAT_PAGE_SIZE) break;
  }

  const members = await loadMembers(mz).catch(() => []);
  const names = memberMap(members);
  const uid = ctx.boot.uid;
  const messages = collected
    .slice(0, cap)
    .map((m) => normalizeMessage(m, names, uid))
    // Chronological (oldest first) makes the thread read naturally.
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return { workspace: ws.title, dialog: dlg, conversation: where, count: messages.length, messages };
}

// ---------------------------------------------------------------------------
// Message a member directly. WRITE (mutating).
//
// Opens (or reuses) the direct-message dialog with the member, then sends the
// text. chat/createDialog returns the existing DM if one already exists, so this
// is safe to call repeatedly. Uses the same outgoing-message shape as
// feeds/write.ts sendMessage.
// ---------------------------------------------------------------------------
export async function messageUser(
  ctx: MizitoContext,
  { workspace, user, text }: { workspace?: string; user: string; text: string },
) {
  if (!user || !String(user).trim()) throw new Error('user is required.');
  if (!text || !String(text).trim()) throw new Error('text is required.');
  const { mz, ws } = await resolveWorkspace(ctx, { workspace });
  const members = await loadMembers(mz);
  const u =
    findByName(members, user, fullName) ||
    findByName(members, user, (m) => m.first_name) ||
    findByName(members, user, (m) => m.username);
  if (!u) throw new Error(`No member matches "${user}" in "${ws.title}".`);

  const created = (await mz.chat.createDialog(u._id)) as
    | { _id?: string; dialog?: string; data?: { _id?: string } }
    | null;
  const dlg = created?._id || created?.dialog || created?.data?._id;
  if (!dlg) throw new Error('Could not open a direct message with that member.');

  const message = {
    _: 'message',
    dialog: dlg,
    out: true,
    message: String(text),
    media: null,
    from: ctx.boot.uid,
    date: Date.now(),
    reply_to: null,
    mention: [],
    seen_count: 1,
    randomId: Math.floor(Math.random() * 1e9),
    pending: true,
  };
  await mz.chat.send(message);
  return { workspace: ws.title, dialog: dlg, sent_to: fullName(u) || user, text: String(text), sent: true };
}
