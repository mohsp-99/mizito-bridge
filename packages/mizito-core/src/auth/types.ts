// The token provider — the seam that decouples the core from where sessions
// live. The transport calls getToken() for the x-token header; on a 401/403 it
// calls onAuthExpired() once and retries if a fresh token comes back.
export interface TokenProvider {
  /** The current session token. Throw if none can be produced. */
  getToken(): string | Promise<string>;
  /**
   * Mint a fresh token after an auth failure (e.g. headless re-login with
   * stored credentials). Return null when re-auth isn't possible; the auth
   * error then propagates to the caller.
   */
  onAuthExpired?(): string | null | Promise<string | null>;
}

export type { Credentials } from '../types/index.js';
