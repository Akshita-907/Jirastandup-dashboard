/**
 * sync-core.js — shared Jira sprint fetch logic.
 *
 * Exports `fetchSprintData()` which returns the array of transformed issues
 * (the same shape written to src/issues.json). Used by:
 *   - scripts/fetch-sprint.js  (CLI: `npm run sync`, writes the file)
 *   - the /api/sync endpoint    (Vite dev middleware + standalone server.js)
 *
 * Auth uses a Jira API token from the environment (or a .env file next to
 * package.json). The token stays server-side — it never reaches the browser.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---- Project config (change here if the board/fields ever change) ----
export const PROJECT = 'G99PRODUCT';
const JQL = `project = ${PROJECT} AND sprint in openSprints() ORDER BY status ASC`;
const FIELD_STORY_POINTS = 'customfield_10016';
const FIELD_PRIMARY_QA = 'customfield_10140';
const DONE_STATUSES = ['Done', 'Released To Prod', 'Ready to Release'];
// Fetch changelog for every non-backlog ticket so we get QA cycle times AND the
// "entered In Progress" date used for overdue detection.
const ENRICH_STATUSES = ['In Progress', 'Code Review', 'QA Review', 'QA BLOCKED', 'Ready to Release', 'Done', 'Released To Prod', 'Rejected'];
const CHANGELOG_CONCURRENCY = 6;
const DAY_MS = 86_400_000;

// ---- Minimal .env loader (no dependency) ----
export function loadDotEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function getCreds() {
  loadDotEnv();
  const SITE = process.env.JIRA_SITE;
  const EMAIL = process.env.JIRA_EMAIL;
  const TOKEN = process.env.JIRA_API_TOKEN;
  if (!SITE || !EMAIL || !TOKEN) {
    throw new Error(
      'Missing Jira credentials. Set JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN ' +
      '(in a .env file or the environment). Token: https://id.atlassian.com/manage-profile/security/api-tokens'
    );
  }
  const AUTH = 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
  const BASE = `https://${SITE}/rest/api/3`;
  return { SITE, AUTH, BASE };
}

async function jira(BASE, AUTH, path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      Authorization: AUTH,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Jira ${res.status} ${res.statusText} on ${path}\n${body.slice(0, 400)}`);
  }
  return res.json();
}

// Simple concurrency pool
async function mapPool(items, size, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await fn(items[idx], idx);
      }
    })
  );
  return results;
}

/**
 * Fetch the current open sprint from Jira and return the transformed issue array.
 * @param {(msg: string) => void} [log] optional progress logger
 * @returns {Promise<Array>} issues ready to serialize to issues.json
 */
export async function fetchSprintData(log = () => {}) {
  const { SITE, AUTH, BASE } = getCreds();

  const today = new Date();
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
  const iso = (d) => d.toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.max(0, Math.round(((b - a) / DAY_MS) * 10) / 10);

  // ---- 1. Fetch all sprint issues (paginated) ----
  async function fetchSprintIssues() {
    const fields = ['summary', 'status', 'assignee', 'priority', 'issuetype', 'updated', 'created', FIELD_STORY_POINTS, FIELD_PRIMARY_QA];
    const all = [];
    let nextPageToken;
    do {
      const body = { jql: JQL, fields, maxResults: 100 };
      if (nextPageToken) body.nextPageToken = nextPageToken;
      const page = await jira(BASE, AUTH, '/search/jql', { method: 'POST', body: JSON.stringify(body) });
      all.push(...(page.issues || []));
      nextPageToken = page.isLast ? undefined : page.nextPageToken;
    } while (nextPageToken);
    return all;
  }

  // ---- 2. Fetch full changelog for one issue (paginated) ----
  async function fetchChangelog(key) {
    const histories = [];
    let startAt = 0;
    for (;;) {
      const page = await jira(BASE, AUTH, `/issue/${key}/changelog?startAt=${startAt}&maxResults=100`);
      histories.push(...(page.values || []));
      if (page.isLast || histories.length >= (page.total ?? histories.length)) break;
      startAt += page.maxResults || 100;
    }
    return histories;
  }

  // Compute QA timing from a changelog history list
  function computeCycle(histories, createdTs) {
    const transitions = [];
    for (const h of histories) {
      for (const it of h.items || []) {
        if (it.field === 'status') transitions.push({ ts: new Date(h.created).getTime(), to: it.toString, user: h.author?.displayName || 'System' });
      }
    }
    transitions.sort((a, b) => a.ts - b.ts);

    // Most RECENT move into In Progress — resets the clock when a ticket bounces back and restarts.
    const inProgress = transitions.filter((t) => t.to === 'In Progress').at(-1);
    const qaEntered = transitions.find((t) => t.to === 'QA Review');
    const qaDone = qaEntered && transitions.find((t) => t.ts > qaEntered.ts && DONE_STATUSES.includes(t.to));

    const qaCycleDays = qaEntered && qaDone ? daysBetween(qaEntered.ts, qaDone.ts) : null;
    const qaOngoingDays = qaEntered && !qaDone ? daysBetween(qaEntered.ts, todayEnd.getTime()) : null;
    const lifecycleDays = qaDone && createdTs ? daysBetween(createdTs, qaDone.ts) : null;

    const history = transitions.map((t) => ({ status: t.to, date: iso(new Date(t.ts)), user: t.user }));
    return {
      inProgressDate: inProgress ? iso(new Date(inProgress.ts)) : null,
      qaEnteredDate: qaEntered ? iso(new Date(qaEntered.ts)) : null,
      qaDoneDate: qaDone ? iso(new Date(qaDone.ts)) : null,
      qaCycleDays,
      qaOngoingDays,
      lifecycleDays,
      history,
    };
  }

  // ---- Run ----
  log(`Fetching open sprint for ${PROJECT} from ${SITE} ...`);
  const raw = await fetchSprintIssues();
  log(`  ${raw.length} issues in sprint.`);

  const issues = raw.map((it) => {
    const f = it.fields;
    const status = f.status?.name || 'To Do';
    const qaField = f[FIELD_PRIMARY_QA];
    const primaryQA = Array.isArray(qaField) && qaField.length
      ? qaField.map((u) => u.displayName).filter(Boolean).join(', ')
      : 'Unassigned';
    const updatedTs = f.updated ? new Date(f.updated).getTime() : todayEnd.getTime();
    return {
      key: it.key,
      summary: f.summary || '',
      status,
      assignee: f.assignee?.displayName || 'Unassigned',
      staleDays: Math.max(0, Math.floor((todayEnd.getTime() - updatedTs) / DAY_MS)),
      priority: f.priority?.name || 'Medium',
      type: f.issuetype?.name || 'Task',
      blocked: status === 'QA BLOCKED',
      blockerReason: status === 'QA BLOCKED' ? 'QA Blocked' : '',
      commitActivity: '🟢 Active',
      primaryQA,
      storyPoints: typeof f[FIELD_STORY_POINTS] === 'number' ? f[FIELD_STORY_POINTS] : 0,
      _createdTs: f.created ? new Date(f.created).getTime() : null,
      history: [{ status, date: iso(new Date(updatedTs)), user: f.assignee?.displayName || 'System' }],
      inProgressDate: null,
      qaEnteredDate: null,
      qaDoneDate: null,
      qaCycleDays: null,
      qaOngoingDays: null,
      lifecycleDays: null,
    };
  });

  // Enrich from changelog for every non-backlog ticket (cycle times + In Progress start date)
  const toEnrich = issues.filter((i) => ENRICH_STATUSES.includes(i.status));
  log(`  Fetching changelogs for ${toEnrich.length} active/completed tickets ...`);
  let done = 0;
  await mapPool(toEnrich, CHANGELOG_CONCURRENCY, async (issue) => {
    try {
      const histories = await fetchChangelog(issue.key);
      const c = computeCycle(histories, issue._createdTs);
      Object.assign(issue, c);
    } catch (e) {
      log(`    ! ${issue.key}: ${e.message.split('\n')[0]}`);
    }
    if (++done % 15 === 0) log(`    ${done}/${toEnrich.length}`);
  });

  // Drop internal field
  return issues.map(({ _createdTs, ...rest }) => rest);
}

export { DONE_STATUSES };
