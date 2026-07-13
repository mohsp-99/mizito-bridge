// Ad-hoc API probe / debugging CLI.
//
//   node scripts/api.mjs <endpoint> [jsonPayload]
//
// Examples:
//   node scripts/api.mjs workspace/userId
//   node scripts/api.mjs projects/getList '{}'
//   node scripts/api.mjs tasks/upcoming '{"outbox":true,"from_dashboard":true}'
//
// Uses the saved session token. Prints the unwrapped response as JSON.
import { createClient } from '@mohsp-99/mizito-core';
import { requireToken } from '@mohsp-99/mizito-core';

const [endpoint, payloadArg] = process.argv.slice(2);
if (!endpoint) {
  console.error('usage: node scripts/api.mjs <endpoint> [jsonPayload]');
  process.exit(1);
}

const payload = payloadArg ? JSON.parse(payloadArg) : {};
const client = createClient({ token: requireToken() });

try {
  const data = await client.call(endpoint, payload);
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
} catch (err) {
  console.error('ERROR:', err.message);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
}
