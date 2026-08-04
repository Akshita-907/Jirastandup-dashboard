/**
 * api/checkin/responses.js — Vercel function for GET /api/checkin/responses.
 * Returns the collected ✅/❌ + reasons.
 *
 * NOTE: on Vercel these are stored in /tmp (ephemeral, per-instance), so they
 * are not durable. For persistent responses, back this with Vercel KV / a DB.
 */
import { handleResponses } from '../../scripts/checkin-core.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }
  handleResponses(res);
}
