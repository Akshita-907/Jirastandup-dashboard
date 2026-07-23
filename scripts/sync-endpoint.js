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

const CACHE_MS = 30_000; // serve a cached result for 30s
let cache = { at: 0, data: null };
let inflight = null;

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
 * Vite plugin: mounts GET /api/sync on the dev server.
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
    },
  };
}
