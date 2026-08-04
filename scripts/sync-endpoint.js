/**
 * sync-endpoint.js — shared HTTP handler for GET /api/sync.
 *
 * Runs the live Jira fetch (scripts/sync-core.js) and returns the fresh issue
 * array as JSON. Used by both the Vite dev middleware (vite.config.js) and the
 * standalone production server (server.js). The Jira token stays server-side.
 *
 * Results are cached briefly so rapid repeat clicks don't hammer Jira.
 */

import { fetchSprintData } from './sync-core.js';
import { fetchBitbucketActivity } from './bitbucket-core.js';
import { handleCheckin, handleResponses, handleRespond } from './checkin-core.js';

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });
}

const CACHE_MS = 30_000; // serve a cached result for 30s
let cache = { at: 0, data: null };
let inflight = null;

// Bitbucket is heavier (many repos) — cache longer and key by date window.
const BB_CACHE_MS = 5 * 60_000;
const bbCache = new Map(); // key -> { at, data }
const bbInflight = new Map(); // key -> Promise

/**
 * Handle a /api/sync request. Node http-style (req, res).
 * @param {import('node:http').ServerResponse} res
 * @param {{ force?: boolean }} [opts]
 */
export async function handleSync(res, opts = {}) {
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
  };

  try {
    const now = Date.now();
    const fresh = !opts.force && cache.data && now - cache.at < CACHE_MS;
    if (fresh) {
      return send(200, { ok: true, cached: true, issues: cache.data });
    }
    // De-dupe concurrent requests into a single Jira fetch.
    if (!inflight) {
      inflight = fetchSprintData((msg) => console.log('[sync]', msg))
        .then((data) => {
          cache = { at: Date.now(), data };
          return data;
        })
        .finally(() => { inflight = null; });
    }
    const data = await inflight;
    return send(200, { ok: true, cached: false, issues: data });
  } catch (e) {
    console.error('[sync] failed:', e.message);
    return send(500, { ok: false, error: e.message });
  }
}

/**
 * Handle a /api/bitbucket request. Returns per-developer commit + PR activity.
 * @param {import('node:http').ServerResponse} res
 * @param {{ from?: string, to?: string, days?: number, force?: boolean }} [opts]
 */
export async function handleBitbucket(res, opts = {}) {
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
  };

  const fetchOpts = (opts.from && opts.to)
    ? { from: opts.from, to: opts.to }
    : { days: Math.max(1, Math.min(90, opts.days || 7)) };
  const key = fetchOpts.from ? `${fetchOpts.from}|${fetchOpts.to}` : `d${fetchOpts.days}`;
  try {
    const cached = bbCache.get(key);
    if (!opts.force && cached && Date.now() - cached.at < BB_CACHE_MS) {
      return send(200, { ok: true, cached: true, ...cached.data });
    }
    if (!bbInflight.has(key)) {
      const p = fetchBitbucketActivity(fetchOpts, (msg) => console.log('[bitbucket]', msg))
        .then((data) => {
          bbCache.set(key, { at: Date.now(), data });
          return data;
        })
        .finally(() => { bbInflight.delete(key); });
      bbInflight.set(key, p);
    }
    const data = await bbInflight.get(key);
    return send(200, { ok: true, cached: false, ...data });
  } catch (e) {
    console.error('[bitbucket] failed:', e.message);
    return send(500, { ok: false, error: e.message });
  }
}

const DATE_RE = /[?&]from=(\d{4}-\d{2}-\d{2})[^&]*&to=(\d{4}-\d{2}-\d{2})/;
function parseRange(url) {
  const m = DATE_RE.exec(url || '');
  if (m) return { from: m[1], to: m[2] };
  const d = /[?&]days=(\d+)/.exec(url || '');
  return { days: d ? Number(d[1]) : undefined };
}

/**
 * Vite plugin: mounts GET /api/sync and GET /api/bitbucket on the dev server.
 */
export function syncApiPlugin() {
  return {
    name: 'sync-api',
    configureServer(server) {
      server.middlewares.use('/api/sync', (req, res, next) => {
        if (req.method !== 'GET') return next();
        const force = /[?&]force=1\b/.test(req.url || '');
        handleSync(res, { force });
      });
      server.middlewares.use('/api/bitbucket', (req, res, next) => {
        if (req.method !== 'GET') return next();
        const force = /[?&]force=1\b/.test(req.url || '');
        handleBitbucket(res, { force, ...parseRange(req.url) });
      });
      server.middlewares.use('/api/checkin-responses', (req, res, next) => {
        if (req.method !== 'GET') return next();
        handleResponses(res);
      });
      server.middlewares.use('/api/checkin-respond', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        handleRespond(res, await readBody(req));
      });
      server.middlewares.use('/api/checkin', (req, res, next) => {
        if (req.method !== 'GET') return next();
        const dryRun = /[?&]preview=1\b/.test(req.url || '');
        handleCheckin(res, { dryRun });
      });
    },
  };
}
