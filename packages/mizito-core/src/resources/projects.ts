// Project endpoints. The two read endpoints are verified live; the rest are
// recovered from the bundle (payloads verbatim), NOT yet exercised live.
import type { CallFn } from '../transport/http.js';
import type { Project } from '../types/index.js';

export interface AddProjectInput {
  title: string;
  color?: string;
  members?: string[];
}

export interface CloneProjectInput {
  projectId: string;
  projectName: string;
  /** Task ids to exclude from the clone. */
  ignoreTaskIds?: string[];
}

export function projectsResource(call: CallFn) {
  return {
    getList: () => call<{ projects?: Project[] }>('projects/getList', {}),
    allSummary: () => call('projects/allSummary', {}),

    // --- reads ---
    // A single project (scoped read used inside a project view).
    get: (projectId: string, token?: string) => call<Project>('projects/get', { projectId, token }),
    // The full project object (members, boards, settings, …).
    full: (projectId: string) => call<Project>('projects/full', { project_id: projectId }),
    // Change history of a project.
    history: (projectId: string) => call('projects/history', { project_id: projectId }),
    // Task/board completion summary for a project's chat.
    chatSummary: (dialog: string, project: string, withBoards = false) =>
      call('projects/chatSummary', { dialog, project, withBoards }),

    // --- writes ---
    add: ({ title, color, members = [] }: AddProjectInput) => call<Project>('projects/add', { title, color, members }),
    save: (input: { project_id: string; title: string; color?: string; members?: string[] }) =>
      call<Project>('projects/save', input),
    archive: (projectId: string) => call('projects/archive', { project_id: projectId }),
    undoArchive: (projectId: string) => call('projects/undoArchive', { project_id: projectId }),
    clone: ({ projectId, projectName, ignoreTaskIds = [] }: CloneProjectInput) =>
      call('projects/clone', { projectId, projectName, ignoreTaskIds }),
    setChatProjectColor: (project: string, dialog: string, color: string) =>
      call('projects/setChatProjectColor', { project, dialog, color }),
    setChatProjectLabels: (project: string, dialog: string, labels: string[]) =>
      call('projects/setChatProjectLabels', { project, dialog, labels }),

    // --- kanban boards ---
    addKanbanBoard: (projectId: string, kanbanBoard: unknown) =>
      call('projects/addKanbanBoard', { projectId, kanbanBoard }),
    updateKanbanBoard: (projectId: string, kanbanBoardId: string, kanbanBoard: unknown) =>
      call('projects/updateKanbanBoard', { projectId, kanbanBoardId, kanbanBoard }),
    removeKanbanBoard: (projectId: string, boardId: string) =>
      call('projects/removeKanbanBoard', { projectId, boardId }),
    setKanbanBoardOrder: (input: { projectId: string; boardId: string; oldPosition: number; newPosition: number }) =>
      call('projects/setKanbanBoardOrder', input),
  };
}

export type ProjectsResource = ReturnType<typeof projectsResource>;
