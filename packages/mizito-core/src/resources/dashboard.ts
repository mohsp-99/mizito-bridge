// Dashboard endpoints — cheap cross-workspace summaries.
import type { CallFn } from '../transport/http.js';
import type { DashboardSummaryRow } from '../types/index.js';

export function dashboardResource(call: CallFn) {
  return {
    getAllSummary: () =>
      call<DashboardSummaryRow[] | { summary?: DashboardSummaryRow[] }>('dashboard/getAllSummary', {}),
    getAllWorkspacesUsers: () => call('dashboard/getAllWorkspacesUsers', {}),
    // Pending items (e.g. workspace invitations awaiting me). Verified live ({}).
    getPending: () => call('dashboard/getPending', {}),
    // "What's new" changelog marker. Verified live ({}).
    checkWhatsNew: () => call<{ count?: number; message?: string }>('dashboard/checkWhatsNew', {}),
    // All per-workspace badges in one call (bundle: { only_badges:true }).
    getAllBadges: () => call('dashboard/getAllBadges', { only_badges: true }),
    // Accept / decline a workspace invite (from getPending), keyed by workspace id.
    acceptInviteRequest: (workspace: string) =>
      call<{ success?: boolean }>('dashboard/acceptInviteRequest', { workspace }),
    cancelInviteRequest: (workspace: string) => call('dashboard/cancelInviteRequest', { workspace }),
  };
}

export type DashboardResource = ReturnType<typeof dashboardResource>;
