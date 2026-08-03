#!/usr/bin/env node
/**
 * fetch-sprint.js — CLI wrapper: pulls the current open sprint from Jira and
 * writes src/issues.json.  Run:  npm run sync
 *
 * The actual Jira fetch lives in scripts/sync-core.js (shared with the
 * /api/sync endpoint). This file just writes the result to disk.
 *
 * Auth: a Jira API token via a .env file next to package.json, or real env vars:
 *   JIRA_SITE=growth99.atlassian.net
 *   JIRA_EMAIL=you@growth99.com
 *   JIRA_API_TOKEN=xxxxxxxxxxxxxxxxxxxx
 * Create a token: https://id.atlassian.com/manage-profile/security/api-tokens
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchSprintData, DONE_STATUSES } from './sync-core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, '..', 'src', 'issues.json');
const META_FILE = join(__dirname, '..', 'src', 'dataMeta.json');

// Current sprint label shown in the dashboard's "Data health" banner. Keep in
// step with SPRINT_START / SPRINT_END_DAY in src/App.jsx when the sprint rolls.
const SPRINT_LABEL = '#39 FY Product Aug 1–15 2026';

(async () => {
  const out = await fetchSprintData((msg) => console.log(msg));
  writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  // Stamp freshness metadata so the "Synced N days ago" banner is accurate.
  const now = new Date();
  writeFileSync(META_FILE, JSON.stringify({
    syncedAt: now.toISOString().slice(0, 10),
    syncedAtTime: now.toISOString(),
    sprint: SPRINT_LABEL,
    source: 'Jira REST (project = G99PRODUCT AND sprint in openSprints())',
  }) + '\n');

  const cyc = out.map((i) => i.qaCycleDays).filter((t) => t != null);
  const avg = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : 'N/A');
  console.log(`\n✔ Wrote ${out.length} issues to src/issues.json`);
  console.log(`  QA cycle measured on ${cyc.length} tickets · avg ${avg(cyc)}d`);
  console.log(`  Blocked: ${out.filter((i) => i.blocked).length} · In QA: ${out.filter((i) => i.status === 'QA Review').length} · Done-ish: ${out.filter((i) => DONE_STATUSES.includes(i.status)).length}\n`);
})().catch((e) => {
  console.error('\n✖ Sync failed:', e.message, '\n');
  process.exit(1);
});
