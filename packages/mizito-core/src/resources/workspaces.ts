// Workspace endpoints, including the token-scoped switch that makes
// cross-workspace reads possible without touching the user's active workspace
// (see docs/MIZITO_INTERNALS.md §4).
import type { CallFn } from '../transport/http.js';
import type { Bootstrap, Envelope, Member } from '../types/index.js';

// The `workspace/switch` response shape varies (sometimes `{token}`, sometimes
// the standard `{data:{token}}` envelope). Pull the token out of either.
export function tokenFromSwitch(sw: unknown): string | null {
  if (!sw) return null;
  if (typeof sw === 'string') return sw;
  const o = sw as Envelope<{ token?: string }> & { token?: string };
  return o.data?.token || o.token || null;
}

export function workspacesResource(call: CallFn) {
  return {
    // Identity + the account's workspaces (`workspace/userId`).
    bootstrap: () => call<Bootstrap>('workspace/userId', { regId: null }),
    // Switch the active workspace. Returns a NEW token scoped to that workspace;
    // the original token is unaffected (token-scoped, not account-wide state).
    // Raw response — use switchToken() for just the token.
    switchRaw: (workspace_id: string) => call('workspace/switch', { workspace_id }, { raw: true }),
    async switchToken(workspace_id: string): Promise<string | null> {
      return tokenFromSwitch(await call('workspace/switch', { workspace_id }, { raw: true }));
    },
    name: () => call('workspace/name', {}),
    planInfo: () => call('workspace/planInfo', {}),
    getUsers: () => call<{ users?: Member[] }>('workspace/getUsers', {}),

    // --- admin (recovered from the bundle, NOT yet exercised live) ---
    // Permission matrix / available plans for the active workspace.
    getPermissions: () => call('workspace/getPermissions', {}),
    getPlans: () => call('workspace/getPlans', {}),
    // Invite a member by name + phone/email. `is_guest` limits their access.
    inviteMember: (name: string, email_phone: string, is_guest = false) =>
      call<{ success?: boolean; message?: string }>('workspace/inviteMember', { name, email_phone, is_guest }),
    // Rename the active workspace.
    updateTitle: (title: string) => call('workspace/updateTitle', { title }),
  };
}

export type WorkspacesResource = ReturnType<typeof workspacesResource>;
