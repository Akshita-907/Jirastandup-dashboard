/**
 * chat-app-core.js — Google Chat app for the EOD check-in.
 *
 * Posts the check-in as an interactive card and repaints it in place on every
 * click (no dialog, no extra API call — each click's reply IS the update):
 *   ✅ Done        -> task shows "✅ Done", buttons gone
 *   ❌ Not done    -> task swaps buttons for an inline reason box + Submit
 *   Submit         -> task shows "❌ Not done — <reason>", buttons gone
 * Every result is also stored (so the dashboard shows it).
 *
 * Env (server-side): a service-account key (chat.bot scope) + the space —
 * needed only to POST the initial card, NOT to handle clicks:
 *   GCHAT_SERVICE_ACCOUNT_JSON   (or _B64)
 *   GCHAT_SPACE                  spaces/XXXXXXXX
 */
import crypto from 'node:crypto';
import { loadDotEnv } from './sync-core.js';
import { buildCheckin, recordResponse, loadResponses, loadCardMeta, saveCardMeta } from './checkin-core.js';

const CHAT_API = 'https://chat.googleapis.com/v1';

function serviceAccount() {
  loadDotEnv();
  let raw = process.env.GCHAT_SERVICE_ACCOUNT_JSON;
  if (!raw && process.env.GCHAT_SERVICE_ACCOUNT_B64) raw = Buffer.from(process.env.GCHAT_SERVICE_ACCOUNT_B64, 'base64').toString('utf8');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export function chatAppConfigured() {
  loadDotEnv();
  return !!(serviceAccount() && process.env.GCHAT_SPACE);
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function getAccessToken() {
  const sa = serviceAccount();
  if (!sa) throw new Error('no service account configured');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/chat.bot', aud: sa.token_uri, iat: now, exp: now + 3600 }));
  const signed = `${header}.${claim}`;
  const sig = b64url(crypto.sign('RSA-SHA256', Buffer.from(signed), sa.private_key));
  const res = await fetch(sa.token_uri, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${signed}.${sig}` }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('token exchange failed: ' + JSON.stringify(j));
  return j.access_token;
}

const btn = (text, fn, id) => ({ text, onClick: { action: { function: fn, parameters: [{ key: 'id', value: id }] } } });

// Build the interactive card. `awaitingId` = the task currently showing its
// inline reason box (transient, from a "Not done" click).
async function buildCard(date, opts = {}) {
  const checkin = await buildCheckin(date, { all: true });
  let items = checkin.items;
  if (Array.isArray(opts.itemIds)) items = items.filter((i) => opts.itemIds.includes(i.id));
  const responses = await loadResponses();
  const byPerson = {};
  for (const it of items) (byPerson[it.person] = byPerson[it.person] || []).push(it);
  const sections = Object.entries(byPerson).map(([person, list]) => ({
    header: person,
    widgets: list.flatMap((it) => {
      const tickets = it.tickets.map((k) => k.replace('G99PRODUCT-', '#')).join(', ');
      const label = `${it.text}${tickets ? `  <b>(${tickets})</b>` : ''}`;
      const r = responses[it.id];
      if (r) {
        const status = r.status === 'done' ? '✅ Done' : `❌ Not done${r.reason ? ` — ${r.reason}` : ''}`;
        return [{ decoratedText: { text: label, bottomLabel: status, wrapText: true } }];
      }
      if (opts.awaitingId === it.id) {
        return [
          { textParagraph: { text: label } },
          { textInput: { name: 'reason', label: 'Reason (blocker / new ETA)', type: 'MULTIPLE_LINE' } },
          { buttonList: { buttons: [btn('Submit', 'submitNotDone', it.id), btn('Cancel', 'cancelMark', it.id)] } },
        ];
      }
      return [
        { textParagraph: { text: label } },
        { buttonList: { buttons: [btn('✅ Done', 'markDone', it.id), btn('❌ Not done', 'markNotDone', it.id)] } },
      ];
    }),
  }));
  return { cardsV2: [{ cardId: `eod-${date}`, card: { header: { title: '🔔 EOD check-in', subtitle: date }, sections } }] };
}

/** Post the interactive card to the configured space (as the app). */
export async function postInteractiveCard(checkin) {
  const token = await getAccessToken();
  const space = process.env.GCHAT_SPACE;
  const itemIds = checkin.items.map((i) => i.id);
  const body = await buildCard(checkin.date, { itemIds });
  const r = await fetch(`${CHAT_API}/${space}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('post card failed: ' + JSON.stringify(j));
  await saveCardMeta(checkin.date, { messageName: j.name, itemIds });
  return j;
}

const dateOf = (id) => (id || '').replace(/-o?\d+$/, '');
const update = async (id, opts) => ({ actionResponse: { type: 'UPDATE_MESSAGE' }, ...(await buildCard(dateOf(id), opts)) });
async function itemIdsFor(id) { const m = (await loadCardMeta())[dateOf(id)]; return m && m.itemIds; }

/** Handle an interaction event from Google Chat. Returns the response JSON. */
export async function handleChatEvent(event) {
  try { console.log('[chat-bot]', JSON.stringify(event).slice(0, 800)); } catch { /* noop */ }
  const type = event && event.type;
  const common = (event && (event.common || event.commonEventObject)) || {};
  const rawParams = common.parameters || {};
  const params = Array.isArray(rawParams) ? Object.fromEntries(rawParams.map((p) => [p.key, p.value])) : rawParams;
  const fn = common.invokedFunction || (event && event.action && event.action.actionMethodName);

  if (type === 'ADDED_TO_SPACE') return { text: '✅ SprintHub is here. Daily EOD check-ins will post in this space.' };
  if (type === 'MESSAGE' && !fn) return { text: 'I post the daily EOD check-in card here — tap ✅ Done or ❌ Not done on your tasks.' };

  const id = params.id;
  const itemIds = await itemIdsFor(id);
  if (fn === 'markDone') { await recordResponse({ id, status: 'done' }); return update(id, { itemIds }); }
  if (fn === 'markNotDone') { return update(id, { itemIds, awaitingId: id }); }
  if (fn === 'cancelMark') { return update(id, { itemIds }); }
  if (fn === 'submitNotDone') {
    const fi = common.formInputs || {};
    const reason = (fi.reason && fi.reason.stringInputs && fi.reason.stringInputs.value && fi.reason.stringInputs.value[0]) || '';
    await recordResponse({ id, status: 'notdone', reason });
    return update(id, { itemIds });
  }
  return {};
}
