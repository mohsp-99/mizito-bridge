// Small shared helpers: filesystem + logging.
import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  return filePath;
}

export function readJson(filePath, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

export function exists(p) {
  return fs.existsSync(p);
}

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
export const log = {
  info: (...a) => console.log(`[${ts()}]`, ...a),
  ok: (...a) => console.log(`[${ts()}] ✓`, ...a),
  warn: (...a) => console.warn(`[${ts()}] !`, ...a),
  err: (...a) => console.error(`[${ts()}] ✗`, ...a),
};

// Make a filesystem-safe slug from an arbitrary (incl. Persian) name.
export function slug(name) {
  return String(name)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
