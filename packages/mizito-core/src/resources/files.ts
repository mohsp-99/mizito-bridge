// CDN file download. Files live at `${CDN_BASE}<content-token>` and the
// request must carry the owning workspace's session token in x-token
// (workspace-scoped tokens otherwise return a tiny "invalid" stub).
import { CDN_BASE, TOKEN_HEADER } from '../config.js';
import { MizitoApiError } from '../transport/errors.js';
import type { Http } from '../transport/http.js';

export function filesResource(http: Http) {
  return {
    /**
     * Download an attachment by its CDN content token; returns the bytes.
     * Content tokens expire — re-read the comment/message for a fresh one if
     * a download fails.
     */
    async download(contentToken: string): Promise<Buffer> {
      const token = await http.currentToken();
      const res = await fetch(CDN_BASE + contentToken, { headers: { [TOKEN_HEADER]: token } });
      if (!res.ok) {
        throw new MizitoApiError(`CDN returned HTTP ${res.status} for this attachment.`, {
          code: res.status === 401 || res.status === 403 ? 'auth' : 'server',
          httpStatus: res.status,
          endpoint: 'cdn',
        });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      // Guard against the ~15-byte "invalid" stub the CDN returns for a
      // bad/expired or wrongly-scoped token (it comes back HTTP 200, so status
      // isn't enough).
      if (buf.length <= 32 && /invalid/i.test(buf.toString('utf8'))) {
        throw new MizitoApiError(
          'CDN returned an "invalid" stub — the content token is expired or scoped to a ' +
            'different workspace. Re-read the comment for a fresh token, and pass the ' +
            'workspace the task belongs to.',
          { code: 'not_found', endpoint: 'cdn' },
        );
      }
      return buf;
    },
  };
}

export type FilesResource = ReturnType<typeof filesResource>;
