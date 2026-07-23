/**
 * api/bitbucket.js — Vercel serverless function for GET /api/bitbucket.
 *
 * Returns per-developer commit + PR activity across the workspace for the last
 * N days (?days=14 by default). Credentials come from Vercel env vars:
 * BITBUCKET_WORKSPACE, BITBUCKET_TOKEN. Never committed to the repo.
 */

import { handleBitbucket } from '../scripts/sync-endpoint.js';

// Scanning many repos can take a while — give it headroom.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }
  const force = /[?&]force=1\b/.test(req.url || '');
  const m = /[?&]days=(\d+)/.exec(req.url || '');
  await handleBitbucket(res, { force, days: m ? Number(m[1]) : undefined });
}
