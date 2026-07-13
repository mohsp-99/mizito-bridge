// Small shared helpers: filesystem + logging + text.
import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(filePath: string, value: unknown): string {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  return filePath;
}

export function readJson<T = unknown>(filePath: string, fallback?: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

export function exists(p: string): boolean {
  return fs.existsSync(p);
}

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
// info/ok write to stdout — keep them out of any code path the MCP server hits
// (JSON-RPC owns stdout there); warn/err go to stderr and are always safe.
export const log = {
  info: (...a: unknown[]) => console.log(`[${ts()}]`, ...a),
  ok: (...a: unknown[]) => console.log(`[${ts()}] ✓`, ...a),
  warn: (...a: unknown[]) => console.warn(`[${ts()}] !`, ...a),
  err: (...a: unknown[]) => console.error(`[${ts()}] ✗`, ...a),
};

// Strip HTML to readable plain text. Mizito letter bodies (inbox/getInbox
// `short_content`, inbox/getHistory `content`) are HTML fragments; this turns
// block boundaries into newlines, drops the remaining tags, and decodes the few
// entities the app emits. It is a readability helper, not a sanitizer.
export function stripHtml(html: unknown): string {
  if (html == null) return '';
  let s = String(html);
  // Block-level boundaries become newlines so paragraphs stay separated.
  s = s.replace(/<\s*\/?\s*(br|p|div|li|tr|h[1-6])\b[^>]*>/gi, '\n');
  s = s.replace(/<[^>]*>/g, '');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&zwnj;/gi, '‌')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return '';
      }
    });
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Make a filesystem-safe slug from an arbitrary (incl. Persian) name.
export function slug(name: unknown): string {
  return String(name)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
