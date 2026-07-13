// Notes: Mizito's sticky-notes module (personal/workspace notes with an
// optional checklist, color, labels, pin, and archive state). Payloads were
// recovered from the bundle's invokeApi call sites; not yet exercised live.
//
// A note object is `{ _id?, title, note, photo, color, checklist:[{title,
// checked}], labels:[id] }` (from the SPA's getEmptyNote). create/update take
// the whole object; the smaller mutators are keyed by `note_id` (except
// updatePinState, which the bundle keys by `noteId` — kept verbatim).
import type { CallFn } from '../transport/http.js';
import type { Note } from '../types/index.js';

export function notesResource(call: CallFn) {
  return {
    /** All notes (optionally filtered — the SPA passes a query object). */
    getAll: (filter: Record<string, unknown> = {}) => call<Note[]>('notes/getAll', filter),
    /** Create a note from a note object; returns the created note. */
    create: (note: Note) => call<Note>('notes/create', note),
    /** Update an existing note (must carry `_id`); returns the updated note. */
    update: (note: Note) => call<Note>('notes/update', note),
    /** Soft-delete (or restore with deleted:false) a note. */
    deleteNote: (noteId: string, deleted = true) =>
      call('notes/deleteNote', { note_id: noteId, deleted }),
    /** Archive (or unarchive with archived:false) a note. */
    archiveNote: (noteId: string, archived = true) =>
      call('notes/archiveNote', { note_id: noteId, archived }),
    /** Check/uncheck a checklist item by its index. */
    setChecklistValue: (noteId: string, checkIndex: number, checked: boolean) =>
      call<Note>('notes/setChecklistValue', { note_id: noteId, check_index: checkIndex, checked }),
    setColor: (noteId: string, color: string) => call('notes/setColor', { note_id: noteId, color }),
    setLabels: (noteId: string, labels: string[]) =>
      call('notes/setLabels', { note_id: noteId, labels }),
    /** Pin/unpin. Note: the API keys this by `noteId` (camelCase), not note_id. */
    updatePinState: (noteId: string, pinned: boolean) =>
      call('notes/updatePinState', { pinned, noteId }),
  };
}

export type NotesResource = ReturnType<typeof notesResource>;
