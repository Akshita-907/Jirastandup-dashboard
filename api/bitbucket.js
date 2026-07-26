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
  const url = req.url || '';
  const force = /[?&]force=1\b/.test(url);
  const range = /[?&]from=(\d{4}-\d{2}-\d{2})[^&]*&to=(\d{4}-\d{2}-\d{2})/.exec(url);
  const d = /[?&]days=(\d+)/.exec(url);
  const opts = range ? { from: range[1], to: range[2] } : { days: d ? Number(d[1]) : undefined };
  await handleBitbucket(res, { force, ...opts });
}
