// The verified password hash: md5_hex(pw) + "|" + sha256_hex(pw), lowercase.
// These vectors were checked byte-for-byte against the SPA bundle's own
// hashing (gdi2290.md5-service createHash + the sha256 factory's
// convertToSHA256) — see docs/MIZITO_INTERNALS.md §2. If this test breaks,
// the headless login breaks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '@mohsp-99/mizito';

const VECTORS = [
  [
    'password',
    '5f4dcc3b5aa765d61d8327deb882cf99|5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
  ],
  [
    '',
    'd41d8cd98f00b204e9800998ecf8427e|e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  ],
  // Persian text + Persian digits — the hash is over the UTF-8 bytes.
  [
    'پرگار۱۲۳',
    'a69a4d2b49a3df15881c93d81b5c2cda|259dc8da87b37611527015741bc386a6082a68c6459743063ce839d6a433985e',
  ],
];

test('hashPassword matches the verified md5|sha256 vectors', () => {
  for (const [pw, expected] of VECTORS) {
    assert.equal(hashPassword(pw), expected);
  }
});

test('hashPassword output shape: two lowercase hex digests joined by |', () => {
  const out = hashPassword('anything');
  assert.match(out, /^[0-9a-f]{32}\|[0-9a-f]{64}$/);
});
