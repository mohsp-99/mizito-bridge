// Label endpoints. `getAll` is verified live; the CRUD writes are recovered
// from the bundle (payloads verbatim), NOT yet exercised live.
import type { CallFn } from '../transport/http.js';

export function labelsResource(call: CallFn) {
  return {
    getAll: (type = 'task') => call('labels/getAll', { type }),
    // Create a label. `type` is e.g. 'task'. Returns { success }.
    add: (title: string, color: string, type = 'task') =>
      call<{ success?: boolean }>('labels/add', { title, color, type }),
    // Edit an existing label (by id).
    save: (input: { label_id: string; type: string; title: string; color: string }) =>
      call<{ success?: boolean }>('labels/save', input),
    // Delete a label. Note the API keys this by { label_id, label_type }.
    delete: (labelId: string, labelType: string) =>
      call<{ success?: boolean }>('labels/delete', { label_id: labelId, label_type: labelType }),
    // A label's change history.
    history: (labelId: string) => call('labels/history', { label_id: labelId }),
  };
}

export type LabelsResource = ReturnType<typeof labelsResource>;
