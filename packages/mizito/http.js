// Thin authenticated client for the Mizito /capi API.
//
// Every data call is `${API_BASE}${API_PREFIX}/<endpoint>` with the session
// token in the `x-token` header. The server answers with a JSON envelope
// shaped roughly like `{ status, data, msg }` where status === 1 means OK.
import { API_BASE, API_PREFIX, TOKEN_HEADER } from './config.js';
import { loadToken } from './auth.js';
import { sleep, log } from './util.js';

export class MizitoApiError extends Error {
  constructor(message, { status, httpStatus, endpoint, body } = {}) {
    super(message);
    this.name = 'MizitoApiError';
    this.status = status;
    this.httpStatus = httpStatus;
    this.endpoint = endpoint;
    this.body = body;
  }
}

export function createClient({ token = loadToken(), pacingMs = 250 } = {}) {
  if (!token) throw new Error('createClient: no token (run `npm run login`).');

  // endpoint may be "session/whoami" or "/capi/session/whoami" or a full URL.
  function resolve(endpoint) {
    if (/^https?:\/\//.test(endpoint)) return endpoint;
    let p = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    if (!p.startsWith(API_PREFIX)) p = `${API_PREFIX}${p}`;
    return `${API_BASE}${p}`;
  }

  async function call(endpoint, payload = {}, { method = 'POST', raw = false } = {}) {
    const url = resolve(endpoint);
    const init = {
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

    let lastErr;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(url, init);
        const text = await res.text();
        let json;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          json = { _nonJson: true, _raw: text };
        }

        // Expired/invalid session token → the API answers 401 (an HTML error
        // page, not a JSON envelope). Surface it as a typed error so callers —
        // and the automatic re-login in core/feed.js — can react instead of
        // silently getting a junk body. Retrying won't help, so it breaks the
        // retry loop below (it isn't classified retriable).
        if (res.status === 401 || res.status === 403) {
          throw new MizitoApiError(`HTTP ${res.status} (auth) from ${endpoint}`, {
            httpStatus: res.status,
            endpoint,
            body: json,
          });
        }
        if (res.status === 429 || res.status >= 500) {
          throw new MizitoApiError(`HTTP ${res.status} from ${endpoint}`, {
            httpStatus: res.status,
            endpoint,
            body: json,
          });
        }
        if (pacingMs) await sleep(pacingMs);
        if (raw) return json;

        // Unwrap the standard envelope when present.
        if (json && typeof json === 'object' && 'status' in json) {
          if (json.status === 1 || json.status === true) {
            return json.data !== undefined ? json.data : json;
          }
          throw new MizitoApiError(
            `API status ${json.status} for ${endpoint}: ${json.msg ?? ''}`,
            { status: json.status, httpStatus: res.status, endpoint, body: json },
          );
        }
        return json;
      } catch (err) {
        lastErr = err;
        const retriable =
          err instanceof MizitoApiError ? (err.httpStatus === 429 || err.httpStatus >= 500) : true;
        if (!retriable || attempt === 4) break;
        const backoff = 500 * attempt;
        log.warn(`${endpoint} failed (attempt ${attempt}): ${err.message}; retrying in ${backoff}ms`);
        await sleep(backoff);
      }
    }
    throw lastErr;
  }

  return { call, resolve, token };
}
