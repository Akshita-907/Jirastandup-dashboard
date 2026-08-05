/**
 * chat-app-core.js — Google Chat app: posts the check-in as an INTERACTIVE card
 * and updates it in place when people tap ✅/❌ (❌ opens a reason dialog).
 *
 * Needs (env, server-side): a service-account key with the chat.bot scope, and
 * the target space:
 *   GCHAT_SERVICE_ACCOUNT_JSON   the full service-account key JSON (or _B64)
 *   GCHAT_SPACE                  spaces/XXXXXXXX
 *
 * The interaction endpoint is api/chat-bot.js (set as the app's HTTP endpoint).
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

// Build the interactive card for a date. Tasks already answered show their
// result (no buttons); unanswered tasks show ✅ Done / ❌ Not done buttons.
async function buildCard(date, itemIds) {
  const checkin = await buildCheckin(date, { all: true });
  let items = checkin.items;
  if (Array.isArray(itemIds)) items = items.filter((i) => itemIds.includes(i.id));
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
        return [{ decoratedText: { text: label, bottomLabel: status } }];
      }
      return [
        { textParagraph: { text: label } },
        { buttonList: { buttons: [
          { text: '✅ Done', onClick: { action: { function: 'markDone', parameters: [{ key: 'id', value: it.id }] } } },
          { text: '❌ Not done', onClick: { action: { function: 'markNotDone', interaction: 'OPEN_DIALOG', parameters: [{ key: 'id', value: it.id }] } } },
        ] } },
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
  const body = await buildCard(checkin.date, itemIds);
  const r = await fetch(`${CHAT_API}/${space}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('post card failed: ' + JSON.stringify(j));
  await saveCardMeta(checkin.date, { messageName: j.name, itemIds });
  return j;
}

async function updateCard(date) {
  const meta = (await loadCardMeta())[date];
  if (!meta || !meta.messageName) return;
  const token = await getAccessToken();
  const body = await buildCard(date, meta.itemIds);
  await fetch(`${CHAT_API}/${meta.messageName}?updateMask=cardsV2`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

function reasonDialog(id) {
  return { actionResponse: { type: 'DIALOG', dialogAction: { dialog: { body: { sections: [{ widgets: [
    { textInput: { label: 'Why isn’t it done? (blocker / new ETA)', type: 'MULTIPLE_LINE', name: 'reason' } },
    { buttonList: { buttons: [{ text: 'Submit', onClick: { action: { function: 'submitNotDone', parameters: [{ key: 'id', value: id }] } } }] } },
  ] }] } } } } };
}
const dateOf = (id) => (id || '').replace(/-o?\d+$/, '');

/** Handle an interaction event from Google Chat. Returns the response JSON. */
export async function handleChatEvent(event) {
  try { console.log('[chat-bot]', JSON.stringify(event).slice(0, 800)); } catch { /* noop */ }
  const type = event && event.type;
  if (type === 'ADDED_TO_SPACE') return { text: '✅ SprintHub is here. Daily EOD check-ins will post in this space.' };
  if (type === 'MESSAGE') return { text: 'I post the daily EOD check-in card here — tap ✅ Done or ❌ Not done on your tasks.' };
  if (type === 'CARD_CLICKED') {
    const fn = event.common && event.common.invokedFunction;
    const params = (event.common && event.common.parameters) || {};
    const id = params.id;
    if (fn === 'markDone') {
      await recordResponse({ id, status: 'done' });
      const meta = (await loadCardMeta())[dateOf(id)];
      return { actionResponse: { type: 'UPDATE_MESSAGE' }, ...(await buildCard(dateOf(id), meta && meta.itemIds)) };
    }
    if (fn === 'markNotDone') return reasonDialog(id);
    if (fn === 'submitNotDone') {
      const reason = event.common && event.common.formInputs && event.common.formInputs.reason
        && event.common.formInputs.reason.stringInputs && event.common.formInputs.reason.stringInputs.value
        && event.common.formInputs.reason.stringInputs.value[0];
      await recordResponse({ id, status: 'notdone', reason: reason || '' });
      await updateCard(dateOf(id));
      return { actionResponse: { type: 'DIALOG', dialogAction: { actionStatus: { statusCode: 'OK', userFacingMessage: 'Saved ✅' } } } };
    }
  }
  return {};
}
