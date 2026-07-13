// Error taxonomy for the Mizito transport. Consumers branch on `code` instead
// of sniffing HTTP statuses:
//   auth       — 401/403: the session token is expired/invalid (re-login fixes it)
//   rate_limit — 429: back off and retry
//   server     — 5xx: Mizito-side failure, retriable
//   api        — HTTP OK but the {status,data,msg} envelope rejected the call
//   network    — fetch itself failed (DNS, connection, abort)
//   not_found  — reserved for endpoints that address a missing entity
export type MizitoErrorCode = 'auth' | 'rate_limit' | 'server' | 'api' | 'network' | 'not_found';

export interface MizitoApiErrorOptions {
  code?: MizitoErrorCode;
  /** The envelope's `status` field, when the API rejected the call. */
  status?: number | boolean;
  httpStatus?: number;
  endpoint?: string;
  body?: unknown;
}

/** Map an HTTP status to an error code, or null if the status isn't an error class we type. */
export function codeForHttpStatus(httpStatus: number): MizitoErrorCode | null {
  if (httpStatus === 401 || httpStatus === 403) return 'auth';
  if (httpStatus === 429) return 'rate_limit';
  if (httpStatus >= 500) return 'server';
  return null;
}

export class MizitoApiError extends Error {
  code: MizitoErrorCode;
  status?: number | boolean;
  httpStatus?: number;
  endpoint?: string;
  body?: unknown;

  constructor(message: string, { code, status, httpStatus, endpoint, body }: MizitoApiErrorOptions = {}) {
    super(message);
    this.name = 'MizitoApiError';
    this.code = code ?? (httpStatus != null ? codeForHttpStatus(httpStatus) ?? 'api' : 'api');
    this.status = status;
    this.httpStatus = httpStatus;
    this.endpoint = endpoint;
    this.body = body;
  }
}
