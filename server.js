#!/usr/bin/env node
/**
 * server.js — standalone production server.
 *
 * Serves the built dashboard from ./dist and exposes GET /api/sync (live Jira
 * fetch). Use this for a deployed / shared instance:
 *
 *   npm run build      # produce ./dist
 *   npm run serve      # start this server (needs the same .env as `npm run sync`)
 *
 * Then open http://localhost:4173 (or PORT). The Jira token stays on the server.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { handleSync, handleBitbucket } from './scripts/sync-endpoint.js';
import { handleCheckin, handleResponses, handleRespond, handleSaveTasks } from './scripts/checkin-core.js';

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, 'dist');
const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function serveStatic(res, urlPath) {
  // Prevent path traversal; default to index.html for SPA routes.
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(DIST, clean === '/' ? 'index.html' : clean);
  if (!filePath.startsWith(DIST)) filePath = join(DIST, 'index.html');

  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // Unknown path → SPA fallback to index.html
    filePath = join(DIST, 'index.html');
  }

  try {
    const buf = await readFile(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[extname(filePath)] || 'application/octet-stream');
    res.end(buf);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const url = req.url || '/';
  if (url === '/api/sync' || url.startsWith('/api/sync?')) {
    if (req.method !== 'GET') { res.statusCode = 405; return res.end('Method not allowed'); }
    const force = /[?&]force=1\b/.test(url);
    return handleSync(res, { force });
  }
  if (url === '/api/bitbucket' || url.startsWith('/api/bitbucket?')) {
    if (req.method !== 'GET') { res.statusCode = 405; return res.end('Method not allowed'); }
    const force = /[?&]force=1\b/.test(url);
    const range = /[?&]from=(\d{4}-\d{2}-\d{2})[^&]*&to=(\d{4}-\d{2}-\d{2})/.exec(url);
    const d = /[?&]days=(\d+)/.exec(url);
    const opts = range ? { from: range[1], to: range[2] } : { days: d ? Number(d[1]) : undefined };
    return handleBitbucket(res, { force, ...opts });
  }
  if (url === '/api/checkin-responses') {
    if (req.method !== 'GET') { res.statusCode = 405; return res.end('Method not allowed'); }
    return handleResponses(res);
  }
  if (url === '/api/checkin-respond') {
    if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method not allowed'); }
    return readBody(req).then((b) => handleRespond(res, b));
  }
  if (url === '/api/checkin-tasks') {
    if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method not allowed'); }
    return readBody(req).then((b) => handleSaveTasks(res, b));
  }
  if (url === '/api/checkin' || url.startsWith('/api/checkin?')) {
    if (req.method !== 'GET') { res.statusCode = 405; return res.end('Method not allowed'); }
    const dryRun = /[?&]preview=1\b/.test(url);
    const all = /[?&]all=1\b/.test(url);
    const app = /[?&]app=1\b/.test(url);
    return handleCheckin(res, { dryRun, all, app });
  }
  return serveStatic(res, url);
});

server.listen(PORT, () => {
  console.log(`\n▶ Dashboard server running at http://localhost:${PORT}`);
  console.log(`  Serving ./dist  ·  live data at /api/sync\n`);
});
