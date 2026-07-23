/**
 * bitbucket-core.js — shared Bitbucket Cloud fetch logic.
 *
 * Exports `fetchBitbucketActivity({ days })` which returns per-developer commit
 * and pull-request activity across ALL repos in a workspace, for the last N days.
 * Used by the /api/bitbucket endpoint (Vite dev middleware + Vercel function +
 * standalone server).
 *
 * Auth: a Bitbucket Cloud Access Token (Bearer). Credentials come from the
 * environment (or the .env file next to package.json) — never the browser/repo:
 *   BITBUCKET_WORKSPACE=your-workspace-slug
 *   BITBUCKET_TOKEN=<workspace or repo Access Token with repo:read + pullrequest:read>
 *
 * Optional author mapping (git email / Bitbucket name -> dashboard person name):
 *   scripts/bitbucket-authors.json  e.g. { "kundan@growth99.com": "Kundan Kumar" }
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv } from './sync-core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE = 'https://api.bitbucket.org/2.0';
const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 14;
const REPO_CONCURRENCY = 5;

function getCreds() {
  loadDotEnv();
  const WORKSPACE = process.env.BITBUCKET_WORKSPACE;
  // Preferred: an Atlassian API token with Bitbucket scopes (works on all plans).
  // Basic auth = email:token. Falls back to JIRA_EMAIL so one scoped token can serve both.
  const EMAIL = process.env.BITBUCKET_EMAIL || process.env.JIRA_EMAIL;
  const API_TOKEN = process.env.BITBUCKET_API_TOKEN;
  // Legacy App Password auth (username:app_password).
  const USERNAME = process.env.BITBUCKET_USERNAME;
  const APP_PASSWORD = process.env.BITBUCKET_APP_PASSWORD;
  // Workspace access token (Bearer) — Premium only.
  const TOKEN = process.env.BITBUCKET_TOKEN;

  let authHeader;
  if (EMAIL && API_TOKEN) {
    authHeader = 'Basic ' + Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64');
  } else if (USERNAME && APP_PASSWORD) {
    authHeader = 'Basic ' + Buffer.from(`${USERNAME}:${APP_PASSWORD}`).toString('base64');
  } else if (TOKEN) {
    authHeader = `Bearer ${TOKEN}`;
  }

  if (!WORKSPACE || !authHeader) {
    throw new Error(
      'Missing Bitbucket credentials. Set BITBUCKET_WORKSPACE plus one of: ' +
      'BITBUCKET_API_TOKEN (an Atlassian API token with Bitbucket scopes — uses your email; recommended), ' +
      'BITBUCKET_USERNAME + BITBUCKET_APP_PASSWORD (App Password), or ' +
      'BITBUCKET_TOKEN (workspace Access Token — Premium). ' +
      'Scoped API token: id.atlassian.com/manage-profile/security/api-tokens → "Create API token with scopes".'
    );
  }
  return { WORKSPACE, authHeader };
}

// Optional email/name -> dashboard person mapping
function loadAuthorMap() {
  const p = join(__dirname, 'bitbucket-authors.json');
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    // normalize keys to lowercase for lookup
    const out = {};
    for (const [k, v] of Object.entries(raw)) out[k.toLowerCase()] = v;
    return out;
  } catch {
    return {};
  }
}

async function bb(authHeader, url) {
  const res = await fetch(url.startsWith('http') ? url : BASE + url, {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Bitbucket ${res.status} ${res.statusText} on ${url}\n${body.slice(0, 300)}`);
  }
  return res.json();
}

// Follow `next` pagination until `stop(page)` returns true or pages run out.
async function paginate(authHeader, firstUrl, onPage) {
  let url = firstUrl;
  while (url) {
    const page = await bb(authHeader, url);
    const done = onPage(page.values || []);
    if (done) break;
    url = page.next || null;
  }
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

// Parse "Name <email>" from a commit author.raw string.
function parseRawAuthor(raw) {
  const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(raw || '');
  if (m) return { name: (m[1] || '').trim(), email: (m[2] || '').trim().toLowerCase() };
  return { name: (raw || '').trim(), email: '' };
}

// Resolve a commit/PR author to a display key, honoring the optional map.
function resolveAuthor(authorMap, { displayName, email }) {
  const byEmail = email && authorMap[email.toLowerCase()];
  if (byEmail) return byEmail;
  const byName = displayName && authorMap[displayName.toLowerCase()];
  if (byName) return byName;
  return displayName || email || 'Unknown';
}

const iso = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * Fetch per-developer commit + PR activity for the workspace.
 * @param {{ days?: number }} [opts]
 * @param {(msg: string) => void} [log]
 */
export async function fetchBitbucketActivity(opts = {}, log = () => {}) {
  const { WORKSPACE, authHeader } = getCreds();
  const authorMap = loadAuthorMap();
  const days = Math.max(1, Math.min(90, opts.days || DEFAULT_DAYS));
  const since = new Date(Date.now() - days * DAY_MS);
  const sinceIso = since.toISOString();

  // Build the list of dates in the window (oldest → newest) for the report grid.
  const dateList = [];
  for (let k = days - 1; k >= 0; k--) dateList.push(iso(Date.now() - k * DAY_MS));

  // ---- 1. List repos, keep only those updated within the window ----
  log(`Listing repos in ${WORKSPACE} ...`);
  const repos = [];
  await paginate(
    authHeader,
    `/repositories/${WORKSPACE}?pagelen=100&sort=-updated_on&fields=next,values.slug,values.updated_on`,
    (values) => {
      for (const r of values) {
        repos.push(r.slug);
        // Sorted newest-first: once a repo is older than the window, the rest are too.
        if (r.updated_on && new Date(r.updated_on) < since) return true;
      }
      return false;
    }
  );
  log(`  ${repos.length} repo(s) with activity in the last ${days}d.`);

  // Per-person accumulator
  const people = new Map(); // name -> { commits, commitsByDay, prsOpen, prsMerged }
  const bump = (name) => {
    if (!people.has(name)) {
      people.set(name, { name, commits: 0, commitsByDay: {}, prsOpen: 0, prsMerged: 0 });
    }
    return people.get(name);
  };
  const byDay = Object.fromEntries(dateList.map((d) => [d, 0]));

  // ---- 2. Per repo: commits + PRs (concurrently) ----
  await mapPool(repos, REPO_CONCURRENCY, async (repo) => {
    // Commits — newest first; stop paginating once older than the window.
    try {
      await paginate(
        authHeader,
        `/repositories/${WORKSPACE}/${repo}/commits?pagelen=100&fields=next,values.date,values.author.raw,values.author.user.display_name`,
        (values) => {
          for (const c of values) {
            const ts = c.date ? new Date(c.date) : null;
            if (!ts) continue;
            if (ts < since) return true; // reached older commits
            const raw = parseRawAuthor(c.author?.raw);
            const displayName = c.author?.user?.display_name || raw.name;
            const who = resolveAuthor(authorMap, { displayName, email: raw.email });
            const day = iso(ts);
            const p = bump(who);
            p.commits += 1;
            p.commitsByDay[day] = (p.commitsByDay[day] || 0) + 1;
            if (day in byDay) byDay[day] += 1;
          }
          return false;
        }
      );
    } catch (e) {
      log(`  ! commits ${repo}: ${e.message.split('\n')[0]}`);
    }

    // Pull requests — open + merged, updated within the window.
    try {
      const q = encodeURIComponent(`updated_on >= ${sinceIso}`);
      await paginate(
        authHeader,
        `/repositories/${WORKSPACE}/${repo}/pullrequests?state=OPEN&state=MERGED&pagelen=50&q=${q}&fields=next,values.state,values.author.display_name,values.author.nickname,values.updated_on`,
        (values) => {
          for (const pr of values) {
            const displayName = pr.author?.display_name || pr.author?.nickname || 'Unknown';
            const who = resolveAuthor(authorMap, { displayName, email: '' });
            const p = bump(who);
            if (pr.state === 'OPEN') p.prsOpen += 1;
            else if (pr.state === 'MERGED') p.prsMerged += 1;
          }
          return false;
        }
      );
    } catch (e) {
      log(`  ! PRs ${repo}: ${e.message.split('\n')[0]}`);
    }
  });

  const developers = [...people.values()].sort((a, b) => b.commits - a.commits);
  log(`  Done: ${developers.length} contributor(s), ${Object.values(byDay).reduce((a, b) => a + b, 0)} commits.`);

  return {
    workspace: WORKSPACE,
    days,
    dates: dateList,
    developers,
    commitsByDay: byDay,
    repoCount: repos.length,
    generatedAt: new Date().toISOString(),
  };
}
