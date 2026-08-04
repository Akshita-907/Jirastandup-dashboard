/**
 * api/checkin/respond.js — Vercel function for POST /api/checkin/respond.
 * Records one ✅/❌ (+ reason) from the dashboard.
 *
 * NOTE: on Vercel storage is /tmp (ephemeral). Back with Vercel KV / a DB for
 * durable responses.
 */
import { handleRespond } from '../../scripts/checkin-core.js';

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }
  handleRespond(res, await readBody(req));
}
