/**
 * api/chat-bot.js — Vercel function: the Google Chat app's interaction endpoint.
 * Set this URL in the Chat API Configuration → Connection settings → HTTP endpoint:
 *   https://<your-app>.vercel.app/api/chat-bot
 * Handles ✅/❌ clicks and the reason dialog, updating the card in place.
 */
import { handleChatEvent } from '../scripts/chat-app-core.js';

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 200; return res.end('SprintHub chat endpoint'); }
  const event = await readBody(req);
  let out = {};
  try { out = await handleChatEvent(event); } catch (e) { console.error('[chat-bot] error', e.message); }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(out || {}));
}
