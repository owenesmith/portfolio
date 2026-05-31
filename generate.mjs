#!/usr/bin/env node
// ============================================================
// generate.mjs — scans img/, groups photos into projects by filename,
// optimizes any new/large media, merges metadata from content.json, and
// writes manifest.json (which the site reads). Run it after dropping new
// images into img/:   node generate.mjs
//
// Naming convention: <Project Words>[-N].<ext>
//   Cutting-Board-1.jpeg + Cutting-Board-2.jpeg  -> one "Cutting Board" project
//   Balance-Scale.jpeg                           -> one "Balance Scale" project
// Photos within a project are ordered by their trailing -N.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const IMG = path.join(ROOT, 'img');
const ORIG = path.join(IMG, '_originals');
const CONTENT_FILE = path.join(ROOT, 'content.json');
const MANIFEST_FILE = path.join(ROOT, 'manifest.json');

const IMAGE_EXT = new Set(['.jpeg', '.jpg', '.png', '.webp']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.m4v']);
const MOV_EXT = new Set(['.mov', '.qt']);
const MAX_EDGE = 1400;        // longest side after optimize
const OPTIMIZE_IF_EDGE_OVER = 1500;
const OPTIMIZE_IF_BYTES_OVER = 1_200_000;

const log = (...a) => console.log(...a);
const has = (cmd) => { try { execFileSync('command', ['-v', cmd], { stdio: 'ignore', shell: '/bin/zsh' }); return true; } catch { return false; } };

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function baseOf(filename) {            // strip extension + trailing -N
  const noExt = filename.replace(/\.[^.]+$/, '');
  return noExt.replace(/-\d+$/, '');
}
function suffixOf(filename) {          // trailing -N number, else -1 (sorts first)
  const m = filename.replace(/\.[^.]+$/, '').match(/-(\d+)$/);
  return m ? parseInt(m[1], 10) : -1;
}
function titleFromBase(base) {
  return base.replace(/-+/g, ' ').trim();
}

function listMedia() {
  return fs.readdirSync(IMG).filter((f) => {
    if (f.startsWith('.')) return false;
    const ext = path.extname(f).toLowerCase();
    return IMAGE_EXT.has(ext) || VIDEO_EXT.has(ext) || MOV_EXT.has(ext);
  });
}

function dims(file) {
  try {
    const out = execFileSync('magick', ['identify', '-format', '%w %h', file + '[0]']).toString().trim();
    const [w, h] = out.split(/\s+/).map(Number);
    return { w, h };
  } catch { return { w: 0, h: 0 }; }
}

function backup(file) {
  fs.mkdirSync(ORIG, { recursive: true });
  const dest = path.join(ORIG, path.basename(file));
  if (!fs.existsSync(dest)) fs.copyFileSync(file, dest);
}

// ---- 1. Normalize media: convert .mov -> .mp4, optimize large images ----
function normalize() {
  let changed = 0;
  for (const f of listMedia()) {
    const src = path.join(IMG, f);
    const ext = path.extname(f).toLowerCase();

    if (MOV_EXT.has(ext)) {
      const outName = baseOfFull(f) + '.mp4';
      const out = path.join(IMG, outName);
      log(`  converting clip ${f} -> ${outName}`);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-an',
        '-vf', 'scale=720:-2,fps=30', '-c:v', 'libx264', '-profile:v', 'high',
        '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart', out]);
      backup(src); fs.rmSync(src);
      changed++;
      continue;
    }

    if (IMAGE_EXT.has(ext)) {
      const { w, h } = dims(src);
      const bytes = fs.statSync(src).size;
      if (Math.max(w, h) > OPTIMIZE_IF_EDGE_OVER || bytes > OPTIMIZE_IF_BYTES_OVER) {
        const tmp = src.replace(/(\.[^.]+)$/, '.opt$1');
        execFileSync('magick', [src, '-auto-orient', '-resize', `${MAX_EDGE}x${MAX_EDGE}>`,
          '-strip', '-interlace', 'JPEG', '-quality', '82', tmp]);
        // Only adopt the result if it actually shrank. A file already as small as
        // it'll get (e.g. a tight PNG just over the byte limit) would otherwise be
        // rewritten on every run — which retriggers studio's img/ watcher in an
        // endless optimize → regenerate → optimize loop.
        if (fs.statSync(tmp).size < bytes) {
          log(`  optimizing ${f} (${w}x${h}, ${(bytes / 1e6).toFixed(1)}MB)`);
          backup(src);
          fs.renameSync(tmp, src);
          changed++;
        } else {
          fs.rmSync(tmp);
        }
      }
    }
  }
  return changed;
}
function baseOfFull(filename) { return filename.replace(/\.[^.]+$/, ''); } // keep -N for clips

// ---- 2. Group into projects ----
function buildProjects(content) {
  const groups = new Map();   // slug -> { base, files: [] }
  for (const f of listMedia()) {
    const base = baseOf(f);
    const slug = slugify(base);
    if (!groups.has(slug)) groups.set(slug, { base, files: [] });
    groups.get(slug).files.push(f);
  }
  const items = content.items || {};
  const projects = {};
  for (const [slug, g] of groups) {
    const meta = items[slug] || {};
    if (meta.hidden) continue;
    const photos = g.files
      .sort((a, b) => suffixOf(a) - suffixOf(b) || a.localeCompare(b))
      .map((f) => `img/${f}`);
    projects[slug] = {
      id: slug,
      title: meta.title || titleFromBase(g.base),
      desc: meta.desc || '',
      color: meta.color || null,
      section: meta.section === 'digital' ? 'digital' : 'physical',
      inProgress: !!meta.inProgress,
      // 'phone'/'browser' draw a CSS device frame; 'phone-image' shows an image that
      // already contains its own device mockup (no CSS frame, just placed in the hero row)
      frame: ['phone', 'browser', 'phone-image'].includes(meta.frame) ? meta.frame : 'none',
      photos,
    };
  }
  return projects;
}

// ---- 3. Order within each section ----
function order(projects, content) {
  const out = { physical: [], digital: [] };
  const savedOrder = content.order || {};
  const placed = new Set();
  for (const section of ['physical', 'digital']) {
    const want = Array.isArray(savedOrder[section]) ? savedOrder[section] : [];
    for (const slug of want) {
      const p = projects[slug];
      if (p && p.section === section && !placed.has(slug)) { out[section].push(p); placed.add(slug); }
    }
  }
  // append any not-yet-placed projects (newly dropped), grouped by their section
  const leftovers = Object.values(projects).filter((p) => !placed.has(p.id)).sort((a, b) => a.title.localeCompare(b.title));
  for (const p of leftovers) out[p.section].push(p);
  return out;
}

function generate() {
  if (!fs.existsSync(IMG)) { console.error('No img/ folder'); process.exit(1); }
  const content = fs.existsSync(CONTENT_FILE) ? JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8')) : { items: {}, order: {} };

  log('Scanning img/ …');
  const changed = normalize();
  if (changed) log(`Normalized ${changed} file(s).`);

  const projects = buildProjects(content);
  const manifest = order(projects, content);

  const newOnes = [...manifest.physical, ...manifest.digital].filter(
    (p) => !(content.order?.physical || []).includes(p.id) && !(content.order?.digital || []).includes(p.id)
  );

  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + '\n');
  log(`\nWrote manifest.json: ${manifest.physical.length} physical, ${manifest.digital.length} digital.`);
  if (newOnes.length) log(`New (unconfigured) item(s): ${newOnes.map((p) => p.id).join(', ')}`);
  return { manifest, newOnes };
}

generate();
export { generate };
