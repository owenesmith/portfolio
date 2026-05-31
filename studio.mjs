#!/usr/bin/env node
// ============================================================
// studio.mjs — local authoring server for the portfolio.
// Run:  node studio.mjs   then open  http://localhost:8765
//
// While it's running, log in on the site to:
//   • drop images anywhere on the page (or into img/) to add them
//   • click "✎ Edit" to set a title / description / section
//   • drag cards to reorder
//   • click "Publish to GitHub" to commit & push
//
// It serves the static site AND a tiny API. The PUBLISHED site stays
// fully static (it just reads manifest.json) — this server is only for
// authoring locally. Binds to localhost only.
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const IMG = path.join(ROOT, 'img');
const PORT = process.env.PORT ? Number(process.env.PORT) : 8765;
const HOST = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4v': 'video/x-m4v',
  '.ico': 'image/x-icon', '.txt': 'text/plain', '.md': 'text/markdown',
};
const UPLOAD_OK = /\.(jpe?g|png|webp|mov|mp4|m4v)$/i;
const MAX_UPLOAD = 80 * 1024 * 1024;

const regenerate = () => execFileSync('node', [path.join(ROOT, 'generate.mjs')], { cwd: ROOT }).toString();
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return fallback; } };

function sendJson(res, code, obj) { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(b); }
function readBody(req, limit = MAX_UPLOAD) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const route = url.pathname;

  if (req.method === 'GET' && route === '/api/state') {
    return sendJson(res, 200, { ok: true, manifest: readJson('manifest.json', { physical: [], digital: [] }), content: readJson('content.json', { items: {}, order: { physical: [], digital: [] } }) });
  }

  if (req.method === 'GET' && route === '/api/status') {
    try { return sendJson(res, 200, { ok: true, status: execFileSync('git', ['status', '--short'], { cwd: ROOT }).toString() }); }
    catch (e) { return sendJson(res, 500, { ok: false, error: String(e.message) }); }
  }

  if (req.method === 'POST' && route === '/api/content') {
    try {
      const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString() || '{}');
      if (typeof body !== 'object' || Array.isArray(body)) throw new Error('bad content');
      body.items = body.items || {}; body.order = body.order || { physical: [], digital: [] };
      fs.writeFileSync(path.join(ROOT, 'content.json'), JSON.stringify(body, null, 2) + '\n');
      regenerate();
      return sendJson(res, 200, { ok: true, manifest: readJson('manifest.json', {}) });
    } catch (e) { return sendJson(res, 400, { ok: false, error: String(e.message) }); }
  }

  if (req.method === 'PUT' && route.startsWith('/api/upload/')) {
    try {
      const name = path.basename(decodeURIComponent(route.slice('/api/upload/'.length)));
      if (!UPLOAD_OK.test(name)) throw new Error('unsupported file type: ' + name);
      const buf = await readBody(req);
      fs.mkdirSync(IMG, { recursive: true });
      fs.writeFileSync(path.join(IMG, name), buf);
      regenerate();
      return sendJson(res, 200, { ok: true, name });
    } catch (e) { return sendJson(res, 400, { ok: false, error: String(e.message) }); }
  }

  if (req.method === 'DELETE' && route.startsWith('/api/image/')) {
    try {
      const name = path.basename(decodeURIComponent(route.slice('/api/image/'.length)));
      const f = path.join(IMG, name);
      if (fs.existsSync(f)) fs.rmSync(f);
      regenerate();
      return sendJson(res, 200, { ok: true, name });
    } catch (e) { return sendJson(res, 400, { ok: false, error: String(e.message) }); }
  }

  if (req.method === 'POST' && route === '/api/publish') {
    try {
      const body = JSON.parse((await readBody(req, 1024 * 1024)).toString() || '{}');
      const msg = (body.message || 'Update portfolio').slice(0, 200);
      regenerate();
      execFileSync('git', ['add', '-A'], { cwd: ROOT });
      let committed = true;
      try { execFileSync('git', ['commit', '-m', msg], { cwd: ROOT, stdio: 'pipe' }); }
      catch (e) { committed = false; }            // nothing to commit
      const push = execFileSync('git', ['push'], { cwd: ROOT, stdio: 'pipe' }).toString();
      return sendJson(res, 200, { ok: true, detail: committed ? 'committed & pushed' : 'already up to date', push });
    } catch (e) { return sendJson(res, 500, { ok: false, error: String(e.stderr || e.message) }); }
  }

  return sendJson(res, 404, { ok: false, error: 'unknown api route' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const noCache = /\.(json|html)$/i.test(filePath);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': noCache ? 'no-store' : 'max-age=300' });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url).catch((e) => sendJson(res, 500, { ok: false, error: String(e.message) }));
  serveStatic(req, res, url);
});

// Regenerate the manifest on startup and whenever img/ changes (debounced),
// so dropping files into the folder makes them appear.
try { regenerate(); } catch (e) { console.error('Initial generate failed:', e.message); }
let watchTimer = null;
try {
  fs.watch(IMG, (evt, file) => {
    if (file && (file.startsWith('.') || /\.opt\.[^.]+$/.test(file))) return;
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => { try { regenerate(); console.log('img/ changed → manifest regenerated'); } catch (e) { console.error('regen error:', e.message); } }, 400);
  });
} catch (e) { /* watch optional */ }

server.listen(PORT, HOST, () => {
  console.log(`\n  Portfolio studio running:  http://localhost:${PORT}`);
  console.log('  Log in on the site to add images, edit text, reorder, and publish.\n');
});
