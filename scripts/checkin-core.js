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
import { buildNameIndex, parseTranscript, extractTickets } from '../src/standup-parse.js';

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
// Manual task edits/additions per date (overrides the parsed task list).
const OVERRIDES_FILE = process.env.VERCEL
  ? join(tmpdir(), 'checkin-overrides.json')
  : join(ROOT, 'checkin-overrides.json');

// ---- durable store: Vercel KV (Upstash REST) when configured, else a local
// file. KV is required on Vercel because its filesystem is ephemeral and not
// shared across serverless instances. Dependency-free — plain fetch. ----------
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const kvOn = () => !!(KV_URL && KV_TOKEN);
async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  if (!r.ok) return null;
  const j = await r.json();
  if (j.result == null) return null;
  return typeof j.result === 'string' ? JSON.parse(j.result) : j.result;
}
async function kvSet(key, val) {
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(val),
  });
  if (!r.ok) throw new Error(`KV set ${r.status}`);
}
async function storeLoad(key, file) {
  if (kvOn()) { return (await kvGet(key)) || {}; }
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}
async function storeSave(key, file, obj) {
  if (kvOn()) { await kvSet(key, obj); return; }
  writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}
const RESPONSES_KEY = 'checkin:responses';
const OVERRIDES_KEY = 'checkin:overrides';

// A commitment is "time-bound" if it names a same-day deadline.
const DEADLINE_RE = /\b(eod|end of day|by\s+end of day|by\s+\d{1,2}(:\d{2})?\s*(am|pm)?|by\s+noon|by\s+midnight|by\s+today|today)\b/i;
export function deadlinePhrase(text) {
  const m = DEADLINE_RE.exec(text || '');
  return m ? m[0] : null;
}

/**
 * Build the check-in for a date (defaults to the latest transcript).
 * @param {{ all?: boolean }} [opts]  all=true keeps every task discussed;
 *   otherwise only same-day-deadline ("by EOD / by <time>") tasks.
 * Item ids are the GLOBAL commitment index (stable across all/eod modes), so a
 * response recorded from an "all" card still resolves under either mode.
 */
export async function buildCheckin(dateStr, opts = {}) {
  const all = !!opts.all;
  let transcripts = [];
  let issues = [];
  try { transcripts = readJson('transcripts.json'); } catch { /* none */ }
  try { issues = readJson('issues.json'); } catch { /* none */ }
  if (!transcripts.length) return { date: null, items: [], people: [], scope: all ? 'all' : 'eod' };

  const entry = transcripts.find((t) => t.date === dateStr) || transcripts[transcripts.length - 1];

  // Base task list: the PM's saved overrides for this date if present, else the
  // parsed standup commitments.
  const overrides = (await loadOverrides())[entry.date];
  let base; // [{ id, person, text, tickets }]
  let edited = false;
  if (Array.isArray(overrides)) {
    edited = true;
    base = overrides.map((t, i) => ({
      id: t.id || `${entry.date}-o${i}`,
      person: t.person || 'Unassigned',
      text: t.text || '',
      tickets: t.tickets || extractTickets(t.text || ''),
    }));
  } else {
    const names = new Set();
    for (const i of issues) { if (i.assignee && i.assignee !== 'Unassigned') names.add(i.assignee); }
    const parsed = parseTranscript(entry, buildNameIndex([...names]));
    base = [];
    let idx = 0;
    for (const p of parsed.people) {
      for (const c of p.commitments) {
        base.push({ id: `${entry.date}-${idx}`, person: p.person, text: c.text, tickets: c.tickets });
        idx += 1; // advance for every commitment so ids stay stable regardless of filter
      }
    }
  }

  const items = base
    .map((t) => ({ ...t, deadline: deadlinePhrase(t.text) }))
    .filter((t) => all || t.deadline);
  return { date: entry.date, items, people: [...new Set(items.map((i) => i.person))], scope: all ? 'all' : 'eod', edited };
}

// ---- editable task overrides (PM add/edit/delete before sending) -----------

export function loadOverrides() {
  return storeLoad(OVERRIDES_KEY, OVERRIDES_FILE);
}
/** Replace the full task list for a date. tasks: [{id?, person, text}]. */
export async function saveTasks(date, tasks) {
  if (!date || !Array.isArray(tasks)) throw new Error('date and tasks[] required');
  const all = await loadOverrides();
  all[date] = tasks
    .filter((t) => (t.text || '').trim())
    .map((t, i) => ({ id: t.id || `${date}-o${i}`, person: (t.person || 'Unassigned').trim(), text: t.text.trim(), tickets: extractTickets(t.text) }));
  await storeSave(OVERRIDES_KEY, OVERRIDES_FILE, all);
  return all[date];
}
/** Drop overrides for a date (revert to the parsed standup tasks). */
export async function resetTasks(date) {
  const all = await loadOverrides();
  delete all[date];
  await storeSave(OVERRIDES_KEY, OVERRIDES_FILE, all);
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
  const checkin = await buildCheckin(opts.dateStr, { all: opts.all });
  const messages = buildMessages(checkin);
  const base = { date: checkin.date, scope: checkin.scope, edited: checkin.edited, items: checkin.items, messages };

  if (!checkin.items.length) return { ok: false, reason: opts.all ? 'no-tasks' : 'no-deadline-items', ...base, items: [], messages: [], sent: 0 };
  if (!webhook || opts.dryRun) {
    return { ok: false, reason: webhook ? 'dry-run' : 'no-webhook', ...base, sent: 0, preview: true };
  }
  await post(webhook, buildCard(checkin));
  return { ok: true, ...base, sent: 1 };
}

/** Plain-text status line echoed back into the AI space when a task is marked. */
export function statusNoticeText(resp) {
  const icon = resp.status === 'done' ? '✅' : '❌';
  const label = resp.status === 'done' ? 'done' : 'not done';
  let text = `${icon} *${resp.person || 'Someone'}* marked *${label}*: ${resp.taskText || ''}`.trim();
  if (resp.status === 'notdone' && resp.reason) text += `\n↳ Reason: ${resp.reason}`;
  return text;
}
/** Best-effort: post the status line to the AI space. Never throws. */
export async function postStatusNotice(resp) {
  loadDotEnv();
  const webhook = process.env.GCHAT_WEBHOOK_URL;
  if (!webhook || !resp) return { posted: false };
  try { await post(webhook, { text: statusNoticeText(resp) }); return { posted: true }; }
  catch (e) { console.error('[checkin] status notice failed:', e.message); return { posted: false }; }
}

// ---- response store (✅/❌ + reason, written from the dashboard) -----------

export function loadResponses() {
  return storeLoad(RESPONSES_KEY, RESPONSES_FILE);
}
export async function recordResponse({ id, status, reason, person, taskText }) {
  if (!id || !['done', 'notdone'].includes(status)) throw new Error('bad response');
  // Enrich person/task from the source notes when the client didn't send them.
  if (!person || !taskText) {
    try {
      const date = id.replace(/-\d+$/, '');
      const item = (await buildCheckin(date, { all: true })).items.find((i) => i.id === id);
      if (item) { person = person || item.person; taskText = taskText || item.text; }
    } catch { /* leave blank */ }
  }
  const all = await loadResponses();
  all[id] = { id, status, reason: reason || '', person: person || '', taskText: taskText || '', at: new Date().toISOString() };
  await storeSave(RESPONSES_KEY, RESPONSES_FILE, all);
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
export async function handleResponses(res) {
  try { return json(res, 200, { ok: true, responses: await loadResponses() }); }
  catch (e) { return json(res, 500, { ok: false, error: e.message }); }
}

/** POST /api/checkin/respond — record one ✅/❌ (+ reason). body already parsed. */
export async function handleRespond(res, body) {
  try {
    const saved = await recordResponse(body || {});
    postStatusNotice(saved).catch(() => {}); // echo into the AI space, best-effort
    return json(res, 200, { ok: true, saved });
  } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
}

/** POST /api/checkin-tasks — save the edited task list, or reset to notes. */
export async function handleSaveTasks(res, body) {
  try {
    const { date, tasks, reset } = body || {};
    if (!date) throw new Error('date required');
    if (reset) { await resetTasks(date); return json(res, 200, { ok: true, reset: true }); }
    return json(res, 200, { ok: true, tasks: await saveTasks(date, tasks) });
  } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
}
