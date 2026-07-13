// Dashboard endpoints — cheap cross-workspace summaries.
import type { CallFn } from '../transport/http.js';
import type { DashboardSummaryRow } from '../types/index.js';

export function dashboardResource(call: CallFn) {
  return {
    getAllSummary: () =>
      call<DashboardSummaryRow[] | { summary?: DashboardSummaryRow[] }>('dashboard/getAllSummary', {}),
    getAllWorkspacesUsers: () => call('dashboard/getAllWorkspacesUsers', {}),
  };
}

export type DashboardResource = ReturnType<typeof dashboardResource>;
