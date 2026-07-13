// Project endpoints.
import type { CallFn } from '../transport/http.js';
import type { Project } from '../types/index.js';

export function projectsResource(call: CallFn) {
  return {
    getList: () => call<{ projects?: Project[] }>('projects/getList', {}),
    allSummary: () => call('projects/allSummary', {}),
  };
}

export type ProjectsResource = ReturnType<typeof projectsResource>;
