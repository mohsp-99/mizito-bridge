// The exact client-side password hash the SPA sends for a normal (non-AD/SSO)
// login (recovered from the app bundle, v1.0.4-589):
//   password field = md5(password) + "|" + sha256(password)   (both lowercase hex)
// from the bundle's `i.createHash(a)+"|"+r.convertToSHA256(a)`. Those two hashes
// are the `gdi2290.md5-service` `createHash` and the `sha256` factory's
// `convertToSHA256`; both were verified byte-for-byte equal to Node's crypto
// hex digests across several test vectors (see docs/MIZITO_INTERNALS.md §2).
// AD/SSO tenants send the raw password instead — not supported here (use the
// browser login for those).
import crypto from 'node:crypto';

export function hashPassword(password: string): string {
  const md5 = crypto.createHash('md5').update(password, 'utf8').digest('hex');
  const sha256 = crypto.createHash('sha256').update(password, 'utf8').digest('hex');
  return `${md5}|${sha256}`;
}
