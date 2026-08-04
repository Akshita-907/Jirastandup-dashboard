/**
 * api/checkin.js — Vercel serverless function for GET /api/checkin.
 *
 * Builds the EOD check-in from the latest standup notes and (unless ?preview=1)
 * posts one card to the Google Chat AI space. Env vars (Project → Settings →
 * Environment Variables): GCHAT_WEBHOOK_URL, DASHBOARD_URL.
 */
import { handleCheckin } from '../scripts/checkin-core.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }
  const dryRun = /[?&]preview=1\b/.test(req.url || '');
  await handleCheckin(res, { dryRun });
}
