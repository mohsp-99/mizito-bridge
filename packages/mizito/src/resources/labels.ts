// Label endpoints.
import type { CallFn } from '../transport/http.js';

export function labelsResource(call: CallFn) {
  return {
    getAll: (type = 'task') => call('labels/getAll', { type }),
  };
}

export type LabelsResource = ReturnType<typeof labelsResource>;
