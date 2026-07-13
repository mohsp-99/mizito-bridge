// Thin authenticated transport for the Mizito /api endpoints.
//
// Every data call is `${API_BASE}${API_PREFIX}/<endpoint>` with the session
// token in the `x-token` header. The server answers with a JSON envelope
// shaped roughly like `{ status, data, msg }` where status === 1 means OK.
//
// The token comes from an injected TokenProvider: getToken() per request, and
// after a 401/403 one call to onAuthExpired() — if that mints a fresh token
// the request is retried once, otherwise the typed auth error propagates.
import { API_BASE, API_PREFIX, TOKEN_HEADER } from '../config.js';
import { sleep, log } from '../util.js';
import { MizitoApiError } from './errors.js';
import type { TokenProvider } from '../auth/types.js';
import type { Envelope } from '../types/index.js';

export interface CallOptions {
  method?: string;
  /** Return the body as-is instead of unwrapping the {status,data} envelope. */
  raw?: boolean;
}

export type CallFn = <T = unknown>(endpoint: string, payload?: unknown, opts?: CallOptions) => Promise<T>;

export interface Http {
  call: CallFn;
  resolve(endpoint: string): string;
  /** The provider's current token (e.g. for CDN downloads outside /api). */
  currentToken(): Promise<string>;
  tokens: TokenProvider;
}

export interface HttpOptions {
  tokens: TokenProvider;
  /** Politeness delay after each successful call (ms). */
  pacingMs?: number;
}

export function createHttp({ tokens, pacingMs = 250 }: HttpOptions): Http {
  // endpoint may be "session/whoami" or "/api/session/whoami" or a full URL.
  function resolve(endpoint: string): string {
    if (/^https?:\/\//.test(endpoint)) return endpoint;
    let p = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    if (!p.startsWith(API_PREFIX)) p = `${API_PREFIX}${p}`;
    return `${API_BASE}${p}`;
  }

  async function call<T = unknown>(endpoint: string, payload: unknown = {}, { method = 'POST', raw = false }: CallOptions = {}): Promise<T> {
    const url = resolve(endpoint);

    let lastErr: unknown;
    let healedAuth = false; // one re-login per call, no matter how many attempts
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const token = await tokens.getToken();
        const init: RequestInit = {
          method,
          headers: {
            [TOKEN_HEADER]: token,
            accept: 'application/json, text/javascript, */*; q=0.01',
            'content-type': 'application/json;charset=UTF-8',
            origin: 'https://office.mizito.ir',
            referer: 'https://office.mizito.ir/',
          },
        };
        if (method !== 'GET' && method !== 'HEAD') {
          init.body = JSON.stringify(payload ?? {});
        }

        const res = await fetch(url, init);
        const text = await res.text();
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          json = { _nonJson: true, _raw: text };
        }

        // Expired/invalid session token → the API answers 401 (an HTML error
        // page, not a JSON envelope). Give the provider one chance to mint a
        // fresh token and retry; otherwise surface a typed auth error so
        // callers can react instead of silently getting a junk body.
        if (res.status === 401 || res.status === 403) {
          if (!healedAuth && tokens.onAuthExpired) {
            const fresh = await tokens.onAuthExpired();
            if (fresh) {
              healedAuth = true;
              attempt--; // the healed retry doesn't consume a transient-retry slot
              continue;
            }
          }
          throw new MizitoApiError(`HTTP ${res.status} (auth) from ${endpoint}`, {
            code: 'auth',
            httpStatus: res.status,
            endpoint,
            body: json,
          });
        }
        if (res.status === 429 || res.status >= 500) {
          throw new MizitoApiError(`HTTP ${res.status} from ${endpoint}`, {
            code: res.status === 429 ? 'rate_limit' : 'server',
            httpStatus: res.status,
            endpoint,
            body: json,
          });
        }
        if (pacingMs) await sleep(pacingMs);
        if (raw) return json as T;

        // Unwrap the standard envelope when present.
        if (json && typeof json === 'object' && 'status' in json) {
          const env = json as Envelope;
          if (env.status === 1 || env.status === true) {
            return (env.data !== undefined ? env.data : env) as T;
          }
          throw new MizitoApiError(`API status ${env.status} for ${endpoint}: ${env.msg ?? ''}`, {
            code: 'api',
            status: env.status,
            httpStatus: res.status,
            endpoint,
            body: json,
          });
        }
        return json as T;
      } catch (err) {
        lastErr = err;
        const retriable =
          err instanceof MizitoApiError
            ? err.code === 'rate_limit' || err.code === 'server'
            : true; // fetch/network failures are worth retrying
        if (!retriable || attempt === 4) break;
        const backoff = 500 * attempt;
        log.warn(
          `${endpoint} failed (attempt ${attempt}): ${(err as Error).message}; retrying in ${backoff}ms`,
        );
        await sleep(backoff);
      }
    }
    if (lastErr instanceof MizitoApiError) throw lastErr;
    // fetch threw (DNS, connection, abort) — wrap it so consumers get a code.
    throw new MizitoApiError(`Network failure for ${endpoint}: ${(lastErr as Error)?.message ?? lastErr}`, {
      code: 'network',
      endpoint,
    });
  }

  return {
    call,
    resolve,
    currentToken: async () => tokens.getToken(),
    tokens,
  };
}
