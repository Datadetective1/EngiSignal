#!/usr/bin/env node
/**
 * Mints the bearer token the ingestion worker authenticates with.
 *
 * WHY THIS IS A SCRIPT AND NOT SOMETHING THE APPLICATION DOES
 *
 * Signing a token requires the project's JWT secret, and that secret can mint a
 * token for ANY role -- including service_role, which can read and write every
 * tenant's data. Putting it in the deployment environment so the app could sign
 * its own tokens would hand the running application exactly the capability this
 * design exists to withhold.
 *
 * So it is signed once, here, on the machine that already has the secret, and
 * only the resulting token is deployed. The token names `ingestion_worker`, a
 * database role with EXECUTE on six functions and no rights over any table, so
 * the worst a leaked copy can do is drive the import queue it was built for.
 *
 * USAGE
 *
 *   node scripts/mint-ingestion-worker-token.mjs
 *
 * It reads the secret from SUPABASE_JWT_SECRET, or prompts for it. The secret
 * is in the Supabase dashboard under Project Settings -> API -> JWT Settings.
 * Nothing is written to disk and nothing is sent anywhere.
 */
import { createHmac } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const base64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function readSecret() {
  if (process.env.SUPABASE_JWT_SECRET) return process.env.SUPABASE_JWT_SECRET.trim();
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question('Supabase JWT secret: ');
  rl.close();
  return answer.trim();
}

const secret = await readSecret();
if (!secret) {
  console.error('No secret given; nothing minted.');
  process.exit(1);
}

const issuedAt = Math.floor(Date.now() / 1000);
// Ten years. A worker credential that expires silently would stop every
// customer's imports with no failure anyone would think to look for, and
// rotating it is a deliberate act -- re-run this script and replace the
// variable -- rather than something that should happen on a timer.
const expiresAt = issuedAt + 60 * 60 * 24 * 365 * 10;

const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const payload = base64url(
  JSON.stringify({ role: 'ingestion_worker', iss: 'supabase', iat: issuedAt, exp: expiresAt }),
);
const signature = createHmac('sha256', secret)
  .update(`${header}.${payload}`)
  .digest('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

console.log('\nINGESTION_WORKER_TOKEN=' + `${header}.${payload}.${signature}` + '\n');
console.log('Add that to the Vercel project environment (Production).');
console.log('It names the ingestion_worker role, which cannot read any table.\n');
