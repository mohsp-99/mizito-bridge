// Content: file uploads and download links.
//
// Uploads are the write-half of attachments. The SPA posts multipart/form-data
// to `/api/content/upload` (NOT a dotted invokeApi call) with the same x-token
// header; from the bundle the FormData fields are:
//   upload         — the file bytes (required)
//   maxWidthHeight — optional image resize cap
//   sendAsFile     — "true" to keep a file as a document, "false" to treat an
//                    image as an inline photo
// The response is the `messageMediaDocument` **wrapper** around the uploaded
// document — `{_:'messageMediaDocument', document:{_id, name, size, content,
// content_key}}` — NOT the bare document, which is what this file and the
// `UploadedDocument` type used to claim. Verified live 2026-07-20.
//
// That wrapper is exactly what a LETTER's `attachments: []` array wants; task
// attachments nest it one level deeper under `media`. Don't assemble either by
// hand — the feed layer (feeds/write.ts) normalizes both shapes.
import { UPLOAD_URL, TOKEN_HEADER } from '../config.js';
import { MizitoApiError } from '../transport/errors.js';
import type { CallFn } from '../transport/http.js';
import type { Http } from '../transport/http.js';
import type { MediaWrapper } from '../types/index.js';

export interface UploadOptions {
  /** Filename to send (defaults to the File's name, or "upload"). */
  filename?: string;
  /** Cap the longest image side to this many px (server-side resize). */
  maxWidthHeight?: number;
  /**
   * Keep the upload as a file/document rather than an inline photo. Defaults to
   * true for non-image inputs. When false an image is treated as a photo.
   */
  sendAsFile?: boolean;
}

// Accept the shapes a Node/browser caller is likely to have.
export type UploadInput = Blob | Uint8Array | ArrayBuffer;

export function contentResource(http: Http, call: CallFn) {
  return {
    /**
     * Upload a file and return the created `messageMediaDocument` wrapper (the
     * document itself is at `.document`). Pass the bytes as a Blob
     * (browser/File), a Uint8Array, or an ArrayBuffer. Feed it to the
     * feeds/write.ts helpers to build a write's `attachments` entry.
     */
    async upload(input: UploadInput, opts: UploadOptions = {}): Promise<MediaWrapper> {
      const blob =
        input instanceof Blob
          ? input
          : new Blob([input instanceof Uint8Array ? input : new Uint8Array(input)]);
      const isImage = input instanceof Blob && input.type.startsWith('image/');
      const sendAsFile = opts.sendAsFile ?? !isImage;

      const form = new FormData();
      // The third arg names the part; the server reads it as the filename.
      form.append('upload', blob, opts.filename ?? (input instanceof File ? input.name : 'upload'));
      if (opts.maxWidthHeight != null) form.append('maxWidthHeight', String(opts.maxWidthHeight));
      form.append('sendAsFile', sendAsFile ? 'true' : 'false');

      const token = await http.currentToken();
      let res: Response;
      try {
        res = await fetch(UPLOAD_URL, {
          method: 'POST',
          headers: { [TOKEN_HEADER]: token },
          body: form,
        });
      } catch (err) {
        throw new MizitoApiError(`Upload network failure: ${(err as Error)?.message ?? err}`, {
          code: 'network',
          endpoint: 'content/upload',
        });
      }
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { _nonJson: true, _raw: text };
      }
      if (res.status === 401 || res.status === 403) {
        throw new MizitoApiError(`HTTP ${res.status} (auth) from content/upload`, {
          code: 'auth',
          httpStatus: res.status,
          endpoint: 'content/upload',
          body: json,
        });
      }
      if (!res.ok) {
        throw new MizitoApiError(`HTTP ${res.status} from content/upload`, {
          code: res.status >= 500 ? 'server' : 'api',
          httpStatus: res.status,
          endpoint: 'content/upload',
          body: json,
        });
      }
      // The upload endpoint answers with the media wrapper directly (not the
      // {status,data} envelope); an { error, msg } object signals failure.
      const doc = json as MediaWrapper & { error?: boolean; msg?: string };
      if (doc?.error) {
        throw new MizitoApiError(`Upload rejected: ${doc.msg ?? 'unknown error'}`, {
          code: 'api',
          endpoint: 'content/upload',
          body: json,
        });
      }
      return doc;
    },

    /**
     * Resolve a download link for a content token. The SPA uses this for the
     * "download" affordance; direct fetches can still use the CDN path (see the
     * files resource). Returns the link token the CDN expects.
     */
    getDownloadLink: (content: string) => call<string>('content/getDownloadLink', { content }),

    /** Produce a cropped rendition of a base photo. `points` is the crop rect. */
    getCroppedPhoto: (base: string, points: unknown) =>
      call<{ success?: boolean; photo?: unknown }>('content/getCroppedPhoto', { base, points }),
  };
}

export type ContentResource = ReturnType<typeof contentResource>;
