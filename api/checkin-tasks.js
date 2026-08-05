/**
 * api/checkin-tasks.js — Vercel function for POST /api/checkin-tasks.
 * Saves the PM's edited task list for a date (or resets to the parsed notes).
 *
 * NOTE: on Vercel edits are stored in /tmp (ephemeral). Back with Vercel KV / a
 * DB for durable edits.
 */
import { handleSaveTasks } from '../scripts/checkin-core.js';

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
  handleSaveTasks(res, await readBody(req));
}
