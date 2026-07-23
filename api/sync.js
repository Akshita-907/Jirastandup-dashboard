/**
 * api/sync.js — Vercel serverless function for GET /api/sync.
 *
 * Vercel auto-detects files in /api as serverless functions. This runs the live
 * Jira fetch server-side and returns the fresh issue array as JSON, so the
 * deployed (static) dashboard's Reload button gets live data.
 *
 * Credentials come from Vercel environment variables (Project → Settings →
 * Environment Variables): JIRA_SITE, JIRA_EMAIL, JIRA_API_TOKEN.
 * They are never committed to the repo.
 */

import { handleSync } from '../scripts/sync-endpoint.js';

// Changelog enrichment can take a while for a full sprint — give it headroom.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }
  const force = /[?&]force=1\b/.test(req.url || '');
  await handleSync(res, { force });
}
