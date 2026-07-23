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

(async () => {
  const out = await fetchSprintData((msg) => console.log(msg));
  writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  const cyc = out.map((i) => i.qaCycleDays).filter((t) => t != null);
  const avg = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : 'N/A');
  console.log(`\n✔ Wrote ${out.length} issues to src/issues.json`);
  console.log(`  QA cycle measured on ${cyc.length} tickets · avg ${avg(cyc)}d`);
  console.log(`  Blocked: ${out.filter((i) => i.blocked).length} · In QA: ${out.filter((i) => i.status === 'QA Review').length} · Done-ish: ${out.filter((i) => DONE_STATUSES.includes(i.status)).length}\n`);
})().catch((e) => {
  console.error('\n✖ Sync failed:', e.message, '\n');
  process.exit(1);
});
