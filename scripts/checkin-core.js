/**
 * checkin-core.js — build & send the EOD "did you finish it?" check-in.
 *
 * Finds the deadline commitments in the latest standup notes and posts ONE
 * Google Chat card into the AI space. Each task has ✅ Done / ❌ Not done
 * buttons that link back to the dashboard; ❌ opens a reason box there and the
 * response is saved to checkin-responses.json (read back on the dashboard).
 *
 * Env (server-side, from .env):
 *   GCHAT_WEBHOOK_URL   the AI-space incoming webhook (Space → Manage webhooks)
 *   DASHBOARD_URL       base URL the ✅/❌ buttons link to (default localhost:5173)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { loadDotEnv } from './sync-core.js';
import { buildNameIndex, parseTranscript } from '../src/standup-parse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);

// Static requires so Vercel's file tracer bundles these into the function.
// (On Vercel, runtime readFileSync of arbitrary paths is NOT included.)
const safeRequire = (p) => { try { return require(p); } catch { return null; } };
const BUNDLED = {
  'transcripts.json': safeRequire('../src/transcripts.json'),
  'issues.json': safeRequire('../src/issues.json'),
};
// On Vercel use the bundled copy; elsewhere (dev / self-hosted) read fresh so
// daily edits to the notes are picked up without a restart.
const readJson = (rel) => {
  if (process.env.VERCEL) return BUNDLED[rel] || [];
  return JSON.parse(readFileSync(join(ROOT, 'src', rel), 'utf8'));
};
// Vercel's filesystem is read-only except /tmp (ephemeral, per-instance).
const RESPONSES_FILE = process.env.VERCEL
  ? join(tmpdir(), 'checkin-responses.json')
  : join(ROOT, 'checkin-responses.json');

// A commitment is "time-bound" if it names a same-day deadline.
const DEADLINE_RE = /\b(eod|end of day|by\s+end of day|by\s+\d{1,2}(:\d{2})?\s*(am|pm)?|by\s+noon|by\s+midnight|by\s+today|today)\b/i;
export function deadlinePhrase(text) {
  const m = DEADLINE_RE.exec(text || '');
  return m ? m[0] : null;
}

/** Build the check-in for a date (defaults to the latest transcript). */
export function buildCheckin(dateStr) {
  let transcripts = [];
  let issues = [];
  try { transcripts = readJson('transcripts.json'); } catch { /* none */ }
  try { issues = readJson('issues.json'); } catch { /* none */ }
  if (!transcripts.length) return { date: null, items: [], people: [] };

  const entry = transcripts.find((t) => t.date === dateStr) || transcripts[transcripts.length - 1];
  const names = new Set();
  for (const i of issues) { if (i.assignee && i.assignee !== 'Unassigned') names.add(i.assignee); }
  const parsed = parseTranscript(entry, buildNameIndex([...names]));

  const items = [];
  for (const p of parsed.people) {
    for (const c of p.commitments) {
      const dl = deadlinePhrase(c.text);
      if (dl) items.push({ id: `${entry.date}-${items.length}`, person: p.person, text: c.text, tickets: c.tickets, deadline: dl });
    }
  }
  return { date: entry.date, items, people: [...new Set(items.map((i) => i.person))] };
}

const fmtDate = (d) => d
  ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  : '';

function dashboardBase() {
  const fallback = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5173';
  const u = (process.env.DASHBOARD_URL || fallback).trim();
  return u.replace(/\/+$/, '');
}

/** Plain-text per-person blocks — used only for the dashboard preview. */
export function buildMessages(checkin) {
  return checkin.people.map((person) => {
    const mine = checkin.items.filter((i) => i.person === person);
    const lines = mine.map((i) => {
      const tickets = i.tickets.map((k) => k.replace('G99PRODUCT-', '#')).join(', ');
      return `• ${i.text}${tickets ? `  (${tickets})` : ''}   [✅ Done] [❌ Not done]`;
    });
    return { person, text: `*${person}*\n${lines.join('\n')}` };
  });
}

/** One Google Chat card containing every person's tasks with link buttons. */
export function buildCard(checkin) {
  const base = dashboardBase();
  const link = (id, mark) => `${base}/?checkin=${encodeURIComponent(id)}&mark=${mark}`;
  const sections = checkin.people.map((person) => {
    const mine = checkin.items.filter((i) => i.person === person);
    const widgets = [];
    for (const i of mine) {
      const tickets = i.tickets.map((k) => k.replace('G99PRODUCT-', '#')).join(', ');
      widgets.push({ textParagraph: { text: `${i.text}${tickets ? `  <b>(${tickets})</b>` : ''}` } });
      widgets.push({ buttonList: { buttons: [
        { text: '✅ Done', onClick: { openLink: { url: link(i.id, 'done') } } },
        { text: '❌ Not done', onClick: { openLink: { url: link(i.id, 'notdone') } } },
      ] } });
    }
    return { header: person, collapsible: false, widgets };
  });
  return {
    cardsV2: [{
      cardId: `eod-checkin-${checkin.date}`,
      card: {
        header: { title: '🔔 EOD check-in', subtitle: fmtDate(checkin.date) + ' · mark each task, add a reason if not done' },
        sections,
      },
    }],
  };
}

async function post(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Chat webhook ${res.status} ${res.statusText}`);
  return res.json().catch(() => ({}));
}

/** Build the check-in and (unless dry-run / no webhook) post the card. */
export async function sendCheckin(opts = {}) {
  loadDotEnv();
  const webhook = process.env.GCHAT_WEBHOOK_URL;
  const checkin = buildCheckin(opts.dateStr);
  const messages = buildMessages(checkin);

  if (!checkin.items.length) return { ok: false, reason: 'no-deadline-items', date: checkin.date, items: [], messages: [], sent: 0 };
  if (!webhook || opts.dryRun) {
    return { ok: false, reason: webhook ? 'dry-run' : 'no-webhook', date: checkin.date, items: checkin.items, messages, sent: 0, preview: true };
  }
  await post(webhook, buildCard(checkin));
  return { ok: true, date: checkin.date, items: checkin.items, messages, sent: 1 };
}

// ---- response store (✅/❌ + reason, written from the dashboard) -----------

export function loadResponses() {
  if (!existsSync(RESPONSES_FILE)) return {};
  try { return JSON.parse(readFileSync(RESPONSES_FILE, 'utf8')); } catch { return {}; }
}
export function recordResponse({ id, status, reason, person, taskText }) {
  if (!id || !['done', 'notdone'].includes(status)) throw new Error('bad response');
  // Enrich person/task from the source notes when the client didn't send them.
  if (!person || !taskText) {
    try {
      const date = id.replace(/-\d+$/, '');
      const item = buildCheckin(date).items.find((i) => i.id === id);
      if (item) { person = person || item.person; taskText = taskText || item.text; }
    } catch { /* leave blank */ }
  }
  const all = loadResponses();
  all[id] = { id, status, reason: reason || '', person: person || '', taskText: taskText || '', at: new Date().toISOString() };
  writeFileSync(RESPONSES_FILE, JSON.stringify(all, null, 2) + '\n');
  return all[id];
}

// ---- HTTP handlers (Node req/res style) ------------------------------------

const json = (res, code, obj) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
};

/** GET /api/checkin — build (and optionally send) the check-in. */
export async function handleCheckin(res, opts = {}) {
  try { return json(res, 200, await sendCheckin(opts)); }
  catch (e) { console.error('[checkin] failed:', e.message); return json(res, 500, { ok: false, error: e.message }); }
}

/** GET /api/checkin/responses — the collected ✅/❌ + reasons. */
export function handleResponses(res) {
  try { return json(res, 200, { ok: true, responses: loadResponses() }); }
  catch (e) { return json(res, 500, { ok: false, error: e.message }); }
}

/** POST /api/checkin/respond — record one ✅/❌ (+ reason). body already parsed. */
export function handleRespond(res, body) {
  try { return json(res, 200, { ok: true, saved: recordResponse(body || {}) }); }
  catch (e) { return json(res, 400, { ok: false, error: e.message }); }
}
