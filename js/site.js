/* ============================================================
   Owen Smith — Portfolio  ·  site.js
   Data-driven render + carousels + lightbox + hero stats,
   plus the full local-studio / GitHub authoring backend
   (ported intact from the original site).
   ============================================================ */
(function () {
  "use strict";

  // ---------- Config ----------
  const palette = ["#8a3a1f", "#a8551f", "#6b4423", "#4a4a52", "#7d5a3c", "#2b2018", "#9c5b2a", "#5e5e68"];
  const isVideo = (src) => /\.(mp4|webm|ogg|m4v)$/i.test(src);
  const CYCLE_MS = 5200, STAGGER_MS = 240, SKIP_CYCLES = 2;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PASS_HASH = "02b035a06145202e2f913590c2c6b12899da968b042b6803430bace1f86c93da";
  const ORDER_KEY = "portfolio.order.v1";
  const ZOOM_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';
  // tiny padlock for the browser mockup's address bar
  const LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  // plausible URLs shown in browser mockups (display-only); falls back to a slug host
  const BROWSER_URLS = {
    "pierscope-companion-viewer": "pierscope.app/viewer",
    "portfolio2": "owenesmith.com",
    "kumiko-generator": "owenesmith.com/kumiko",
    "clarity1": "clarity.so",
    "inkpress1": "inkpress.app",
    "marble-track-generator": "owenesmith.com/marble",
  };
  const browserUrlFor = (p) => BROWSER_URLS[p.id] || ("owenesmith.com/" + String(p.id || "").replace(/[^a-z0-9]+/gi, "-"));
  // curated, honest materials list drawn from the work itself
  const MATERIALS = ["Walnut", "Maple", "Purpleheart", "Padauk", "Oak", "Steel", "Slate", "Cork", "Glass", "Veneer", "Brass"];

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pretty = (o) => JSON.stringify(o, null, 2) + "\n";
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // grouping helpers (mirror generate.mjs)
  const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const baseOf = (name) => name.replace(/\.[^.]+$/, '').replace(/-\d+$/, '');
  const suffixOf = (name) => { const m = name.replace(/\.[^.]+$/, '').match(/-(\d+)$/); return m ? +m[1] : -1; };
  const titleFromBase = (b) => b.replace(/-+/g, ' ').trim();

  // ---------- State ----------
  let API_OK = false;
  let MANIFEST = { physical: [], digital: [] };
  let CONTENT = { items: {}, order: { physical: [], digital: [] } };
  let editMode = false, carousels = [], conductorTimer = null;
  const previewUrls = {};
  const gridP = document.getElementById('grid');
  const gridD = document.getElementById('digital-grid');

  // ---------- GitHub backend ----------
  const GH = {
    owner: 'owenesmith', repo: 'portfolio',
    get branch() { return localStorage.getItem('gh.branch') || 'main'; },
    token: () => localStorage.getItem('gh.token') || '',
    connected: () => !!localStorage.getItem('gh.token'),
    async api(p, opts = {}) {
      const r = await fetch('https://api.github.com' + p, { cache: 'no-store', ...opts, headers: { Authorization: 'Bearer ' + GH.token(), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) } });
      if (!r.ok) throw new Error('GitHub ' + r.status + ': ' + (await r.text()).slice(0, 160));
      return r.status === 204 ? {} : r.json();
    },
  };
  async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  async function ghCommit(files, message) {
    const { owner, repo, branch } = GH;
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const ref = await GH.api(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
        const headSha = ref.object.sha;
        const headCommit = await GH.api(`/repos/${owner}/${repo}/git/commits/${headSha}`);
        const tree = [];
        for (const f of files) {
          if (f.delete) {
            tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
          } else if (f.blobBase64 != null) {
            const blob = await GH.api(`/repos/${owner}/${repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: f.blobBase64, encoding: 'base64' }) });
            tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
          } else {
            tree.push({ path: f.path, mode: '100644', type: 'blob', content: f.text });
          }
        }
        const newTree = await GH.api(`/repos/${owner}/${repo}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: headCommit.tree.sha, tree }) });
        const commit = await GH.api(`/repos/${owner}/${repo}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: newTree.sha, parents: [headSha] }) });
        await GH.api(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
        return commit.sha;
      } catch (e) {
        lastErr = e;
        if (/fast forward|\b422\b|\b409\b/.test(e.message) && attempt < 3) { await sleep(700); continue; }
        throw e;
      }
    }
    throw lastErr;
  }
  async function optimizeImage(file, maxEdge = 1400, quality = 0.82) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    return await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  }

  // ---------- Load data ----------
  async function loadData() {
    API_OK = false;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    if (local) {
      try { const r = await fetch('/api/state', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); API_OK = true; CONTENT = j.content || CONTENT; MANIFEST = j.manifest; } } catch (e) {}
    }
    if (!API_OK) {
      MANIFEST = await (await fetch('manifest.json', { cache: 'no-store' })).json();
      try { const c = await fetch('content.json', { cache: 'no-store' }); if (c.ok) CONTENT = await c.json(); } catch (e) {}
      applyLocalOrder();
    }
    document.body.classList.toggle('api-on', API_OK);
  }
  function applyLocalOrder() {
    let saved = null; try { saved = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null'); } catch (e) {}
    if (!Array.isArray(saved)) return;
    const rank = id => { const i = saved.indexOf(id); return i < 0 ? 1e9 : i; };
    MANIFEST.physical = MANIFEST.physical.slice().sort((a, b) => rank(a.id) - rank(b.id));
  }
  const knownIds = () => new Set([...(CONTENT.order?.physical || []), ...(CONTENT.order?.digital || [])]);
  const canEdit = () => API_OK || GH.connected();

  // ---------- Hero stats + editable subtitle / list-stats ----------
  const DEFAULT_SUBTITLE = "A collection of some of my favorite builds, designed and built by me.";
  // Seeded defaults used until content.json's `site` block overrides them. Electronics &
  // Languages are starter values — edit them in edit mode (✎ beside each section).
  function defaultSite() {
    return {
      subtitle: DEFAULT_SUBTITLE,
      lists: [
        { title: "Materials", items: MATERIALS.slice() },
        { title: "Electronics", items: ["Arduino", "ESP32", "Stepper Motors", "LED Lighting", "Bluetooth LE", "TFT Displays"] },
        { title: "Languages", items: ["Python", "JavaScript", "C++", "Swift", "HTML / CSS"] },
      ],
    };
  }
  function getSite() {
    const d = defaultSite();
    const s = (CONTENT && CONTENT.site && typeof CONTENT.site === 'object') ? CONTENT.site : {};
    const lists = (Array.isArray(s.lists) && s.lists.length)
      ? s.lists.map((l) => ({ title: String((l && l.title) || ''), items: Array.isArray(l && l.items) ? l.items.map(String) : [] }))
      : d.lists;
    return { subtitle: typeof s.subtitle === 'string' ? s.subtitle : d.subtitle, lists };
  }
  function renderStats() {
    const elBuilds = document.getElementById('stat-builds');
    if (elBuilds) elBuilds.textContent = MANIFEST.physical.length + MANIFEST.digital.length;
    renderSiteText();
  }
  // Subtitle + the dot-separated list-stats (Materials / Electronics / Languages).
  // The lists render here (rather than living in the HTML) so the same nodes can be
  // rebuilt after an edit. Items are always joined with the standard " · " separator.
  function renderSiteText() {
    const site = getSite();
    const sub = document.getElementById('site-sub');
    if (sub) sub.textContent = site.subtitle;
    const stats = document.querySelector('.stats');
    if (!stats) return;
    const existing = stats.querySelector('.stat-lists');
    if (existing) existing.remove();
    const col = document.createElement('div');
    col.className = 'stat-lists';
    site.lists.forEach((list, idx) => {
      const el = document.createElement('div');
      el.className = 'stat stat--list';
      el.innerHTML = `<span class="stat-num">${list.items.map(esc).join('  ·  ')}</span>`
        + `<span class="stat-label">${esc(list.title)}</span>`
        + `<button class="hero-edit" type="button" aria-label="Edit ${esc(list.title)} list">✎</button>`;
      el.querySelector('.hero-edit').addEventListener('click', () => openListEditor(idx));
      col.appendChild(el);
    });
    stats.appendChild(col);
  }

  // ---------- Conductor (gentle auto-rotate) ----------
  // A carousel auto-advances only while it is actually on screen: an IntersectionObserver
  // flips ctrl.inView, and each wave skips anything off-screen, hovered, or in a hidden tab.
  // This is what makes it work on mobile — there's no hover there to drive pausing, so
  // viewport visibility is the gate (on desktop too).
  let carouselIO = null;
  function ensureCarouselIO() {
    if (carouselIO || !('IntersectionObserver' in window)) return;
    carouselIO = new IntersectionObserver((entries) => {
      entries.forEach((en) => { const c = en.target._carousel; if (c) c.inView = en.isIntersecting; });
    }, { threshold: 0.25 });
  }
  function observeCarousel(frame, ctrl) {
    if (!('IntersectionObserver' in window)) { ctrl.inView = true; return; } // no IO support → always eligible
    ensureCarouselIO();
    frame._carousel = ctrl;
    carouselIO.observe(frame);
  }
  function runWave() { carousels.forEach((c, i) => setTimeout(() => { if (!c.inView || c.paused || document.hidden) return; if (c.skip > 0) { c.skip--; return; } c.advance(); }, i * STAGGER_MS)); }
  function startConductor() { stopConductor(); if (editMode || reduceMotion || !carousels.length) return; conductorTimer = setInterval(runWave, CYCLE_MS); }
  function stopConductor() { if (conductorTimer) { clearInterval(conductorTimer); conductorTimer = null; } }
  document.addEventListener('visibilitychange', () => { document.hidden ? stopConductor() : startConductor(); });

  // ---------- Device mockups (phone / browser) ----------
  // Wraps the media in a phone bezel or browser window. The screenshot inside
  // is centered and contain-scaled (largest fit, never cropped).
  function mockupWrap(p, inner) {
    if (p.frame === 'phone') {
      return `<div class="mockup mockup--phone">`
        + `<span class="mp-btn mp-vol-up"></span><span class="mp-btn mp-vol-dn"></span><span class="mp-btn mp-power"></span>`
        + `<div class="mockup-screen"><span class="mp-island"></span>${inner}</div>`
        + `</div>`;
    }
    if (p.frame === 'browser') {
      return `<div class="mockup mockup--browser">`
        + `<div class="mockup-bar">`
        + `<span class="mb-dots"><span class="mb-dot"></span><span class="mb-dot"></span><span class="mb-dot"></span></span>`
        + `<span class="mb-url">${LOCK_SVG}<span class="mb-url-text">${esc(browserUrlFor(p))}</span></span>`
        + `</div>`
        + `<div class="mockup-screen">${inner}</div>`
        + `</div>`;
    }
    if (p.frame === 'phone-image') {
      // the screenshot already includes its own device mockup — show it bare (no CSS frame)
      return `<div class="mockup mockup--device">${inner}</div>`;
    }
    return inner;
  }

  // ---------- Build a card ----------
  function buildCard(p, i, section, isNew) {
    const card = document.createElement('article');
    card.className = 'card' + (isNew ? ' is-new' : '');
    card.dataset.title = p.title; card.dataset.id = p.id; card.dataset.section = section;
    card.style.setProperty('--card-accent', p.color || palette[i % palette.length]);
    const multi = p.photos.length > 1;
    const media = p.photos.map((src, idx) => {
      const shown = previewUrls[src] || src; const a = idx === 0 ? ' active' : '';
      return isVideo(src)
        ? `<video class="media${a}" src="${esc(shown)}" muted loop playsinline preload="metadata" draggable="false" aria-label="${esc(p.title)} — clip ${idx + 1}"></video>`
        : `<img class="media${a}" src="${esc(shown)}" alt="${esc(p.title)} — photo ${idx + 1}" loading="lazy" draggable="false">`;
    }).join('');
    const dots = multi ? `<div class="dots">${p.photos.map((_, idx) => `<span class="dot ${idx === 0 ? 'active' : ''}"></span>`).join('')}</div>` : '';
    const arrows = multi ? `<button class="nav prev" aria-label="Previous">‹</button><button class="nav next" aria-label="Next">›</button>` : '';
    const cue = `<span class="view-cue">${ZOOM_SVG} View</span>`;
    const wip = p.inProgress ? `<span class="wip-tag">In&nbsp;Progress</span>` : '';
    const descBlock = p.desc ? `<div class="desc-wrap"><button class="readmore" type="button" aria-expanded="false">Read more</button><div class="desc-panel"><p class="desc">${esc(p.desc)}</p></div></div>` : '';
    card.innerHTML = `
      <div class="frame frame--${p.frame || 'none'}" role="button" tabindex="0" aria-label="Open ${esc(p.title)}">${isNew ? '<span class="newbadge">New</span>' : ''}${wip}${mockupWrap(p, media)}${cue}${arrows}${dots}</div>
      <div class="meta"><span class="index-num">${String(i + 1).padStart(2, '0')}</span><h2 class="title">${esc(p.title)}</h2><button class="editbtn" type="button">✎ Edit</button></div>
      ${descBlock}`;

    const frame = card.querySelector('.frame');
    const items = frame.querySelectorAll('.media');
    const dotEls = frame.querySelectorAll('.dot');
    let pos = 0, suppressTap = false;
    const syncVideo = () => items.forEach((el, idx) => { if (el.tagName === 'VIDEO') { idx === pos ? el.play().catch(() => {}) : (el.pause(), el.currentTime = 0); } });
    syncVideo();
    const setPos = (n) => { items[pos].classList.remove('active'); if (dotEls[pos]) dotEls[pos].classList.remove('active'); pos = (n + items.length) % items.length; items[pos].classList.add('active'); if (dotEls[pos]) dotEls[pos].classList.add('active'); syncVideo(); };
    if (multi) {
      card.classList.add('is-carousel');
      const ctrl = { paused: false, skip: 0, inView: false, advance: () => setPos(pos + 1) };
      carousels.push(ctrl);
      observeCarousel(frame, ctrl);
      card.addEventListener('mouseenter', () => { ctrl.paused = true; });
      card.addEventListener('mouseleave', () => { ctrl.paused = false; });
      frame.querySelector('.prev').addEventListener('click', (e) => { e.stopPropagation(); setPos(pos - 1); ctrl.skip = SKIP_CYCLES; });
      frame.querySelector('.next').addEventListener('click', (e) => { e.stopPropagation(); setPos(pos + 1); ctrl.skip = SKIP_CYCLES; });
      // Touch swipe: a horizontal drag flips photos; vertical drags stay free for page scroll
      // (passive listeners). A drag also suppresses the tap so it doesn't open the lightbox.
      let sx = 0, sy = 0, dx = 0, dy = 0, tracking = false;
      frame.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) { tracking = false; return; }
        sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; dy = 0; tracking = true;
      }, { passive: true });
      frame.addEventListener('touchmove', (e) => {
        if (!tracking) return;
        dx = e.touches[0].clientX - sx; dy = e.touches[0].clientY - sy;
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) suppressTap = true;
      }, { passive: true });
      frame.addEventListener('touchend', () => {
        if (!tracking) return; tracking = false;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
          setPos(pos + (dx < 0 ? 1 : -1)); ctrl.skip = SKIP_CYCLES; suppressTap = true;
        }
      }, { passive: true });
    }
    // open lightbox (not while editing, and not as the tail of a swipe)
    const open = () => { const blocked = editMode || suppressTap; suppressTap = false; if (blocked) return; openLightbox(p, pos); };
    frame.addEventListener('click', open);
    frame.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    if (p.desc) {
      const btn = card.querySelector('.readmore'), panel = card.querySelector('.desc-panel');
      let pinned = false;
      const expand = () => { panel.style.maxHeight = panel.scrollHeight + 'px'; };
      const collapse = () => { panel.style.maxHeight = '0px'; };
      // pops open on hover (as the image enlarges); collapses on leave — unless pinned
      card.addEventListener('mouseenter', () => { if (!pinned) expand(); });
      card.addEventListener('mouseleave', () => { if (!pinned) collapse(); });
      // clicking "Read more" pins it open until clicked again ("Close")
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        pinned = !pinned;
        panel.style.maxHeight = pinned ? panel.scrollHeight + 'px' : '0px';
        btn.setAttribute('aria-expanded', String(pinned));
        btn.textContent = pinned ? 'Close' : 'Read more';
      });
    }
    card.querySelector('.editbtn').addEventListener('click', (e) => { e.stopPropagation(); openEditor(card, p, section); });
    if (editMode) makeDraggable(card);
    return card;
  }
  function render() {
    carousels = [];
    if (carouselIO) carouselIO.disconnect();
    const known = knownIds();
    gridP.innerHTML = '';
    MANIFEST.physical.forEach((p, i) => gridP.appendChild(buildCard(p, i, 'physical', editMode && canEdit() && !known.has(p.id))));
    const phonesEl = document.getElementById('digital-phones');
    if (phonesEl) phonesEl.innerHTML = '';
    if (MANIFEST.digital && MANIFEST.digital.length) {
      gridD.innerHTML = '';
      // phones lead as the hero row; everything else (browser frames) fills the grid below
      MANIFEST.digital.forEach((p, i) => {
        const card = buildCard(p, i, 'digital', editMode && canEdit() && !known.has(p.id));
        const inHero = (p.frame === 'phone' || p.frame === 'phone-image') && phonesEl;
        (inHero ? phonesEl : gridD).appendChild(card);
      });
    } else {
      gridD.innerHTML = editMode
        ? '<p class="empty-hint">No digital work yet — add an image (or “+ New work”), then ✎ Edit it and set its Section to “Digital”.</p>'
        : '';
    }
    const cnt = document.getElementById('phys-count');
    if (cnt) cnt.textContent = String(MANIFEST.physical.length).padStart(2, '0') + ' works';
    const dcnt = document.getElementById('dig-count');
    if (dcnt) dcnt.textContent = MANIFEST.digital.length ? String(MANIFEST.digital.length).padStart(2, '0') + ' works' : '';
    renderStats();
    startConductor();
  }

  // ---------- Lightbox ----------
  const lb = document.getElementById('lightbox');
  const lbMedia = document.getElementById('lb-media');
  const lbTitle = document.getElementById('lb-title');
  const lbIndex = document.getElementById('lb-index');
  const lbCounter = document.getElementById('lb-counter');
  const lbDots = document.getElementById('lb-dots');
  let lbPhotos = [], lbPos = 0, lbReturnFocus = null;

  function lbShow(n) {
    const nodes = lbMedia.querySelectorAll('img, video');
    if (!nodes.length) return;
    nodes[lbPos] && nodes[lbPos].classList.remove('active');
    lbPos = (n + lbPhotos.length) % lbPhotos.length;
    [...nodes].forEach((el, idx) => {
      el.classList.toggle('active', idx === lbPos);
      if (el.tagName === 'VIDEO') { idx === lbPos ? el.play().catch(() => {}) : (el.pause(), el.currentTime = 0); }
    });
    [...lbDots.children].forEach((d, idx) => d.classList.toggle('active', idx === lbPos));
    lbCounter.textContent = lbPhotos.length > 1 ? `${lbPos + 1} / ${lbPhotos.length}` : '';
  }
  function openLightbox(p, startPos) {
    lbPhotos = p.photos.slice();
    const lbmedia = lbPhotos.map((src) => {
      const shown = previewUrls[src] || src;
      return isVideo(src)
        ? `<video src="${esc(shown)}" muted loop playsinline controls></video>`
        : `<img src="${esc(shown)}" alt="${esc(p.title)}">`;
    }).join('');
    lbMedia.innerHTML = mockupWrap(p, lbmedia);
    lbDots.innerHTML = lbPhotos.length > 1 ? lbPhotos.map(() => '<span class="dot"></span>').join('') : '';
    lbTitle.textContent = p.title;
    const idx = MANIFEST.physical.findIndex(x => x.id === p.id);
    lbIndex.textContent = idx >= 0 ? String(idx + 1).padStart(2, '0') : '';
    lbPos = 0; lbShow(startPos || 0);
    document.body.classList.add('lb-lock');
    lb.classList.add('open');
    lb.setAttribute('aria-hidden', 'false');
    lbReturnFocus = document.activeElement;
    document.getElementById('lb-close').focus();
    stopConductor();
    const single = lbPhotos.length < 2;
    document.getElementById('lb-prev').hidden = single;
    document.getElementById('lb-next').hidden = single;
  }
  function closeLightbox() {
    lb.classList.remove('open');
    lb.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lb-lock');
    [...lbMedia.children].forEach(el => { if (el.tagName === 'VIDEO') el.pause(); });
    setTimeout(() => { lbMedia.innerHTML = ''; }, 400);
    if (lbReturnFocus && lbReturnFocus.focus) lbReturnFocus.focus();
    startConductor();
  }
  document.getElementById('lb-close').addEventListener('click', closeLightbox);
  document.getElementById('lb-prev').addEventListener('click', () => lbShow(lbPos - 1));
  document.getElementById('lb-next').addEventListener('click', () => lbShow(lbPos + 1));
  // close on any click that isn't the image/clip or a nav/close control
  lb.addEventListener('click', (e) => {
    const t = e.target;
    const onMedia = t.tagName === 'IMG' || t.tagName === 'VIDEO';
    const onControl = t.closest('.lb-btn') || t.closest('.lb-close');
    if (!onMedia && !onControl) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') lbShow(lbPos - 1);
    else if (e.key === 'ArrowRight') lbShow(lbPos + 1);
  });
  // Swipe the open lightbox on touch — mirrors the ‹ › buttons and arrow keys.
  (function lbSwipe() {
    const wrap = document.querySelector('.lb-media-wrap');
    if (!wrap) return;
    let sx = 0, sy = 0, dx = 0, dy = 0, on = false;
    wrap.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) { on = false; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; dy = 0; on = true; }, { passive: true });
    wrap.addEventListener('touchmove', (e) => { if (!on) return; dx = e.touches[0].clientX - sx; dy = e.touches[0].clientY - sy; }, { passive: true });
    wrap.addEventListener('touchend', () => { if (!on) return; on = false; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) lbShow(lbPos + (dx < 0 ? 1 : -1)); }, { passive: true });
  })();

  // ---------- Persistence ----------
  async function persist(message, extraFiles = []) {
    if (API_OK) {
      try { const r = await fetch('/api/content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CONTENT) }); if (!r.ok) throw new Error(await r.text()); await loadData(); render(); flashMsg(message + ' — saved.'); }
      catch (e) { flashMsg('Save failed: ' + e.message); }
    } else if (GH.connected()) {
      try {
        flashMsg('Committing to GitHub…');
        await ghCommit([{ path: 'content.json', text: pretty(CONTENT) }, { path: 'manifest.json', text: pretty(MANIFEST) }, ...extraFiles], message);
        render(); flashMsg('Committed ✓ — live on owenesmith.com in ~1 min.');
      } catch (e) { flashMsg('GitHub commit failed: ' + e.message); }
    } else {
      localStorage.setItem(ORDER_KEY, JSON.stringify(MANIFEST.physical.map(p => p.id)));
      render(); flashMsg('Preview only — Connect GitHub (top bar) to save to the live site.');
    }
  }

  // ---------- Inline editor ----------
  let openEditorEl = null;
  function openEditor(card, p, section) {
    if (!canEdit()) { flashMsg('Connect GitHub (top bar) or run the local studio to edit.'); return; }
    if (openEditorEl) openEditorEl.remove();
    const ed = document.createElement('div'); ed.className = 'editor';
    const thumbs = p.photos.map((src) => {
      const shown = previewUrls[src] || src;
      const media = isVideo(src) ? `<video src="${esc(shown)}" muted playsinline></video>` : `<img src="${esc(shown)}" alt="">`;
      return `<div class="ed-thumb" data-path="${esc(src)}">${media}<button type="button" class="ed-rep" title="Replace">⟲</button><button type="button" class="ed-rm" title="Remove">✕</button></div>`;
    }).join('');
    ed.innerHTML = `
      <input class="ed-title" value="${esc(p.title)}" placeholder="Title">
      <textarea class="ed-desc" placeholder="Description (optional)">${esc(p.desc)}</textarea>
      <div class="ed-row"><label>Section</label>
        <select class="ed-section"><option value="physical"${section === 'physical' ? ' selected' : ''}>Physical</option><option value="digital"${section === 'digital' ? ' selected' : ''}>Digital</option></select>
        <label>Frame</label>
        <select class="ed-frame"><option value="none"${(!p.frame || p.frame === 'none') ? ' selected' : ''}>No frame</option><option value="phone"${p.frame === 'phone' ? ' selected' : ''}>Phone</option><option value="phone-image"${p.frame === 'phone-image' ? ' selected' : ''}>Phone (pre-rendered image)</option><option value="browser"${p.frame === 'browser' ? ' selected' : ''}>Browser window</option></select>
        <label class="ed-wip"><input type="checkbox" class="ed-inprogress"${p.inProgress ? ' checked' : ''}> In&nbsp;Progress</label>
        <button class="ed-save" type="button">Save</button><button class="ed-cancel" type="button">Cancel</button><button class="ed-hide" type="button">Hide</button>
      </div>
      <div class="ed-label">Images <span class="ed-hint">⟲ replace · ✕ remove</span></div>
      <div class="ed-images">${thumbs}<button type="button" class="ed-add" title="Add image(s) to this project">+ Add</button></div>
      <input type="file" class="ed-file-add" accept="image/*" multiple hidden>
      <input type="file" class="ed-file-rep" accept="image/*" hidden>`;
    card.appendChild(ed); openEditorEl = ed;
    ed.querySelector('.ed-cancel').addEventListener('click', () => { ed.remove(); openEditorEl = null; });
    ed.querySelector('.ed-save').addEventListener('click', async () => {
      const title = ed.querySelector('.ed-title').value.trim(), desc = ed.querySelector('.ed-desc').value.trim(), newSection = ed.querySelector('.ed-section').value;
      const wip = ed.querySelector('.ed-inprogress').checked;
      const frame = ed.querySelector('.ed-frame').value;
      CONTENT.items = CONTENT.items || {};
      CONTENT.items[p.id] = { title: title || undefined, desc: desc || undefined, section: newSection, color: (CONTENT.items[p.id] || {}).color || undefined, inProgress: wip || undefined, frame: (frame !== 'none') ? frame : undefined };
      ensureOrder(p.id, newSection);
      moveProject(p.id, section, newSection); const proj = findProject(p.id); if (proj) { proj.title = title || titleFromBase(baseOf(p.photos[0].split('/').pop())); proj.desc = desc; proj.section = newSection; proj.inProgress = wip; proj.frame = frame; }
      openEditorEl = null;
      await persist('Edit “' + (title || p.title) + '”');
    });
    ed.querySelector('.ed-hide').addEventListener('click', async () => {
      if (!confirm('Hide “' + p.title + '” from the site?')) return;
      CONTENT.items = CONTENT.items || {}; CONTENT.items[p.id] = { ...(CONTENT.items[p.id] || {}), hidden: true };
      for (const s of ['physical', 'digital']) MANIFEST[s] = MANIFEST[s].filter(x => x.id !== p.id);
      openEditorEl = null;
      await persist('Hide “' + p.title + '”');
    });
    // image management: add / replace / remove
    let repPath = null;
    const fileAdd = ed.querySelector('.ed-file-add'), fileRep = ed.querySelector('.ed-file-rep');
    ed.querySelector('.ed-add').addEventListener('click', () => fileAdd.click());
    fileAdd.addEventListener('change', () => { if (fileAdd.files.length) addPhotosToProject(p, fileAdd.files); fileAdd.value = ''; });
    ed.querySelectorAll('.ed-rep').forEach(b => b.addEventListener('click', () => { repPath = b.closest('.ed-thumb').dataset.path; fileRep.click(); }));
    fileRep.addEventListener('change', () => { if (fileRep.files[0] && repPath) replacePhoto(p, repPath, fileRep.files[0]); fileRep.value = ''; });
    ed.querySelectorAll('.ed-rm').forEach(b => b.addEventListener('click', () => removePhoto(p, b.closest('.ed-thumb').dataset.path)));
  }
  const findProject = (id) => [...MANIFEST.physical, ...MANIFEST.digital].find(p => p.id === id);
  function moveProject(id, from, to) {
    if (from === to) return;
    const idx = MANIFEST[from].findIndex(p => p.id === id); if (idx < 0) return;
    const [proj] = MANIFEST[from].splice(idx, 1); MANIFEST[to].push(proj);
  }
  function ensureOrder(id, section) {
    CONTENT.order = CONTENT.order || { physical: [], digital: [] };
    // only drop it from the OTHER section (a section change); keep its position in this one
    const other = section === 'physical' ? 'digital' : 'physical';
    CONTENT.order[other] = (CONTENT.order[other] || []).filter(x => x !== id);
    CONTENT.order[section] = CONTENT.order[section] || [];
    if (!CONTENT.order[section].includes(id)) CONTENT.order[section].push(id);
  }

  // ---------- Hero text editor (subtitle + list-stats) ----------
  // Hooks into the SAME edit mode and persistence as image/card edits: the edited text lives
  // on CONTENT.site and is saved by persist() (→ /api/content locally, or a content.json commit
  // on GitHub) — no separate auth or storage. The list editor enforces the standard format:
  // you edit plain item text and " · " separators are applied on render; anything pasted with
  // commas/dots/newlines is split into separate items on save.
  let heroEditorEl = null;
  function closeHeroEditor() { if (heroEditorEl) { heroEditorEl.remove(); heroEditorEl = null; } }
  function heroItemRow(val) {
    return `<div class="ed-item"><input class="ed-item-input" value="${esc(val || '')}" placeholder="Item"><button type="button" class="ed-item-rm" aria-label="Remove item">✕</button></div>`;
  }
  function openSubtitleEditor() {
    if (!canEdit()) { flashMsg('Connect GitHub (top bar) or run the local studio to edit.'); return; }
    closeHeroEditor();
    const ed = document.createElement('div'); ed.className = 'editor hero-editor';
    ed.innerHTML = `
      <div class="ed-label">Subtitle</div>
      <textarea class="ed-subtitle" rows="2">${esc(getSite().subtitle)}</textarea>
      <div class="ed-row"><button class="ed-save" type="button">Save</button><button class="ed-cancel" type="button">Cancel</button></div>`;
    document.querySelector('.hero-inner').appendChild(ed); heroEditorEl = ed;
    ed.querySelector('.ed-subtitle').focus();
    ed.querySelector('.ed-cancel').addEventListener('click', closeHeroEditor);
    ed.querySelector('.ed-save').addEventListener('click', async () => {
      const v = ed.querySelector('.ed-subtitle').value.trim();
      const site = getSite(); site.subtitle = v || DEFAULT_SUBTITLE;
      CONTENT.site = site; closeHeroEditor();
      await persist('Edit subtitle');
    });
  }
  function openListEditor(idx) {
    if (!canEdit()) { flashMsg('Connect GitHub (top bar) or run the local studio to edit.'); return; }
    closeHeroEditor();
    const site = getSite(); const list = site.lists[idx] || { title: '', items: [] };
    const ed = document.createElement('div'); ed.className = 'editor hero-editor';
    ed.innerHTML = `
      <input class="ed-list-title" value="${esc(list.title)}" placeholder="Section title">
      <div class="ed-label">Items <span class="ed-hint">dots are added automatically — just edit the text</span></div>
      <div class="ed-list-items">${list.items.map(heroItemRow).join('')}</div>
      <button class="ed-add-item" type="button">+ Item</button>
      <div class="ed-row"><button class="ed-save" type="button">Save</button><button class="ed-cancel" type="button">Cancel</button></div>`;
    document.querySelector('.hero-inner').appendChild(ed); heroEditorEl = ed;
    const itemsWrap = ed.querySelector('.ed-list-items');
    const wireRm = (btn) => btn.addEventListener('click', () => btn.closest('.ed-item').remove());
    itemsWrap.querySelectorAll('.ed-item-rm').forEach(wireRm);
    ed.querySelector('.ed-add-item').addEventListener('click', () => {
      const tmp = document.createElement('div'); tmp.innerHTML = heroItemRow('');
      const row = tmp.firstElementChild; itemsWrap.appendChild(row);
      wireRm(row.querySelector('.ed-item-rm')); row.querySelector('.ed-item-input').focus();
    });
    ed.querySelector('.ed-cancel').addEventListener('click', closeHeroEditor);
    ed.querySelector('.ed-save').addEventListener('click', async () => {
      const title = ed.querySelector('.ed-list-title').value.trim() || list.title || 'Section';
      const items = [...ed.querySelectorAll('.ed-item-input')]
        .flatMap((i) => i.value.split(/[,\n·]+/))
        .map((s) => s.trim()).filter(Boolean);
      site.lists[idx] = { title, items };
      CONTENT.site = site; closeHeroEditor();
      await persist('Edit ' + title + ' list');
    });
  }

  // ---------- Drag to reorder ----------
  let dragId = null;
  function makeDraggable(card) {
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', (e) => { dragId = card.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { dragId = null; document.querySelectorAll('.card').forEach(c => c.classList.remove('dragging', 'drop-before', 'drop-after')); });
    card.addEventListener('dragover', (e) => { if (!dragId || card.dataset.id === dragId || card.dataset.section !== draggedSection()) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const list = MANIFEST[card.dataset.section]; const from = list.findIndex(p => p.id === dragId), to = list.findIndex(p => p.id === card.dataset.id); card.classList.toggle('drop-after', from < to); card.classList.toggle('drop-before', from > to); });
    card.addEventListener('dragleave', () => card.classList.remove('drop-before', 'drop-after'));
    card.addEventListener('drop', (e) => {
      e.preventDefault(); const section = card.dataset.section;
      if (!dragId || card.dataset.id === dragId || section !== draggedSection()) return;
      const list = MANIFEST[section]; const from = list.findIndex(p => p.id === dragId), to = list.findIndex(p => p.id === card.dataset.id);
      const [moved] = list.splice(from, 1); const at = list.findIndex(p => p.id === card.dataset.id);
      list.splice(from < to ? at + 1 : at, 0, moved);
      CONTENT.order = CONTENT.order || {}; CONTENT.order[section] = list.map(p => p.id);
      persist('Reorder ' + section);
    });
  }
  function draggedSection() { for (const s of ['physical', 'digital']) if (MANIFEST[s].some(p => p.id === dragId)) return s; return 'physical'; }

  // ---------- Add images (drop anywhere) ----------
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const dropOverlay = document.getElementById('drop-overlay');
  const zones = dropOverlay ? [...dropOverlay.querySelectorAll('.drop-zone')] : [];
  const armed = (e) => editMode && canEdit() && hasFiles(e);
  const showOverlay = () => { if (dropOverlay) dropOverlay.hidden = false; };
  const hideOverlay = () => { if (dropOverlay) { dropOverlay.hidden = true; zones.forEach(z => z.classList.remove('over')); } };
  const sectionForY = (y) => (y < window.innerHeight / 2) ? 'physical' : 'digital';

  // Window: reveal the overlay when a file-drag enters; keep drops allowed; clean up on exit.
  window.addEventListener('dragenter', (e) => { if (armed(e)) showOverlay(); });
  window.addEventListener('dragover', (e) => { if (armed(e)) e.preventDefault(); });
  window.addEventListener('dragend', hideOverlay);
  window.addEventListener('dragleave', (e) => { if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) hideOverlay(); });
  // Fallback (drop that lands before a zone catches it) — route by cursor height.
  window.addEventListener('drop', async (e) => {
    e.preventDefault(); hideOverlay();
    if (!(editMode && canEdit())) return;
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) await uploadFiles(files, sectionForY(e.clientY));
  });

  // The two halves are real drop targets (top = Physical, bottom = Digital).
  zones.forEach((zone) => {
    zone.addEventListener('dragover', (e) => { if (!armed(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; zones.forEach(z => z.classList.toggle('over', z === zone)); });
    zone.addEventListener('dragenter', (e) => { if (armed(e)) { e.preventDefault(); zones.forEach(z => z.classList.toggle('over', z === zone)); } });
    zone.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const files = [...(e.dataTransfer?.files || [])];
      hideOverlay();
      if (editMode && canEdit() && files.length) await uploadFiles(files, zone.dataset.section);
    });
  });
  function normalizeName(name) {
    let base = name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-');
    const ext = /\.(mp4|m4v|webm)$/i.test(name) ? name.match(/\.[^.]+$/)[0] : '.jpeg';
    return base + ext;
  }
  function integrateImage(path, section = 'physical') {
    const file = path.split('/').pop(); const slug = slugify(baseOf(file));
    let proj = findProject(slug);
    if (proj) { if (!proj.photos.includes(path)) { proj.photos.push(path); proj.photos.sort((a, b) => suffixOf(a.split('/').pop()) - suffixOf(b.split('/').pop())); } }
    else {
      proj = { id: slug, title: titleFromBase(baseOf(file)), desc: '', color: null, section, inProgress: false, photos: [path] };
      MANIFEST[section].push(proj);
      if (section !== 'physical') { CONTENT.items = CONTENT.items || {}; CONTENT.items[slug] = { ...(CONTENT.items[slug] || {}), section }; }
      ensureOrder(slug, section);
    }
    return proj;
  }
  async function uploadFiles(fileList, section = 'physical') {
    const files = [...fileList].filter(f => /\.(jpe?g|png|webp|mov|mp4|m4v)$/i.test(f.name));
    if (!files.length) { flashMsg('No image files in that drop.'); return; }
    const where = section === 'digital' ? 'Digital' : 'Physical';
    if (API_OK) {
      flashMsg('Adding ' + files.length + ' to ' + where + '…');
      for (const f of files) { try { await fetch('/api/upload/' + encodeURIComponent(f.name), { method: 'PUT', body: await f.arrayBuffer() }); } catch (e) { flashMsg('Upload failed: ' + e.message); } }
      if (section !== 'physical') {
        CONTENT.items = CONTENT.items || {};
        for (const f of files) { const slug = slugify(baseOf(f.name)); CONTENT.items[slug] = { ...(CONTENT.items[slug] || {}), section }; ensureOrder(slug, section); }
        try { await fetch('/api/content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CONTENT) }); } catch (e) {}
      }
      await loadData(); render(); flashMsg(files.length + ' added to ' + where + ' — click ✎ Edit to name & describe.');
    } else if (GH.connected()) {
      try {
        flashMsg('Optimizing & committing ' + files.length + ' image(s) to ' + where + '…');
        const extra = [];
        for (const f of files) {
          const isVid = /\.(mp4|m4v|webm)$/i.test(f.name);
          if (isVid) { flashMsg('Videos must be added via the local studio (node studio.mjs).'); continue; }
          const blob = await optimizeImage(f);
          const name = normalizeName(f.name); const path = 'img/' + name;
          previewUrls[path] = URL.createObjectURL(blob);
          integrateImage(path, section);
          extra.push({ path, blobBase64: await blobToBase64(blob) });
        }
        if (extra.length) await persist('Add ' + extra.length + ' image(s) to ' + where, extra);
      } catch (e) { flashMsg('Add failed: ' + e.message); }
    } else { flashMsg('Connect GitHub (top bar) to add images to the live site.'); }
  }

  // ---------- Per-project image management (add / replace / remove) ----------
  const projectBase = (project) => project.photos.length ? baseOf(project.photos[0].split('/').pop()) : project.title.replace(/[^A-Za-z0-9]+/g, '-');
  function nextNames(project, count) {
    const base = projectBase(project);
    let max = 0;
    for (const ph of project.photos) { const s = suffixOf(ph.split('/').pop()); max = Math.max(max, s < 0 ? 1 : s); }
    return Array.from({ length: count }, (_, k) => `${base}-${max + 1 + k}.jpeg`);
  }
  function reopenEditor(id) {
    const proj = findProject(id); if (!proj) return;
    const card = [...document.querySelectorAll('.card')].find(c => c.dataset.id === id);
    if (card) openEditor(card, proj, proj.section);
  }
  async function addPhotosToProject(project, fileList) {
    const files = [...fileList].filter(f => /\.(jpe?g|png|webp)$/i.test(f.name));
    if (!files.length) { flashMsg('Pick image files (jpg/png/webp).'); return; }
    const names = nextNames(project, files.length);
    try {
      flashMsg('Adding ' + files.length + ' photo(s)…');
      const blobs = []; for (const f of files) blobs.push(await optimizeImage(f));
      if (API_OK) {
        for (let k = 0; k < blobs.length; k++) await fetch('/api/upload/' + encodeURIComponent(names[k]), { method: 'PUT', body: blobs[k] });
        await loadData(); render(); reopenEditor(project.id); flashMsg('Added ' + files.length + ' photo(s).');
      } else if (GH.connected()) {
        const extra = []; const proj = findProject(project.id);
        for (let k = 0; k < blobs.length; k++) { const p = 'img/' + names[k]; previewUrls[p] = URL.createObjectURL(blobs[k]); proj.photos.push(p); extra.push({ path: p, blobBase64: await blobToBase64(blobs[k]) }); }
        proj.photos.sort((a, b) => suffixOf(a.split('/').pop()) - suffixOf(b.split('/').pop()));
        await persist('Add ' + files.length + ' photo(s) to ' + project.title, extra); reopenEditor(project.id);
      } else flashMsg('Connect GitHub (top bar) to add images.');
    } catch (e) { flashMsg('Add failed: ' + e.message); }
  }
  async function replacePhoto(project, path, file) {
    if (!file || !/\.(jpe?g|png|webp)$/i.test(file.name)) { flashMsg('Pick an image file.'); return; }
    try {
      flashMsg('Replacing…');
      const blob = await optimizeImage(file);
      if (API_OK) {
        await fetch('/api/upload/' + encodeURIComponent(path.split('/').pop()), { method: 'PUT', body: blob });
        await loadData(); render(); reopenEditor(project.id); flashMsg('Replaced.');
      } else if (GH.connected()) {
        previewUrls[path] = URL.createObjectURL(blob);
        await persist('Replace ' + path, [{ path, blobBase64: await blobToBase64(blob) }]); reopenEditor(project.id);
      } else flashMsg('Connect GitHub (top bar) to replace images.');
    } catch (e) { flashMsg('Replace failed: ' + e.message); }
  }
  async function removePhoto(project, path) {
    const proj = findProject(project.id); if (!proj) return;
    if (proj.photos.length <= 1 && !confirm('Remove the last photo and the whole “' + project.title + '” project?')) return;
    proj.photos = proj.photos.filter(p => p !== path);
    const emptied = proj.photos.length === 0;
    if (emptied) {
      for (const s of ['physical', 'digital']) MANIFEST[s] = MANIFEST[s].filter(x => x.id !== project.id);
      if (CONTENT.order) for (const s of ['physical', 'digital']) CONTENT.order[s] = (CONTENT.order[s] || []).filter(x => x !== project.id);
    }
    try {
      flashMsg('Removing…');
      if (API_OK) {
        await fetch('/api/image/' + encodeURIComponent(path.split('/').pop()), { method: 'DELETE' });
        await fetch('/api/content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CONTENT) });
        await loadData(); render(); if (!emptied) reopenEditor(project.id); flashMsg('Removed.');
      } else if (GH.connected()) {
        await persist('Remove ' + path, [{ path, delete: true }]); if (!emptied) reopenEditor(project.id);
      } else flashMsg('Connect GitHub (top bar) to remove images.');
    } catch (e) { flashMsg('Remove failed: ' + e.message); }
  }

  // ---------- Login / edit mode ----------
  const loginBtn = document.getElementById('login-btn'), loginForm = document.getElementById('login-form');
  const loginPass = document.getElementById('login-pass'), loginError = document.getElementById('login-error');
  const editBar = document.getElementById('edit-bar'), editMsg = editBar.querySelector('.edit-bar__msg');
  loginBtn.addEventListener('click', () => { loginForm.hidden = !loginForm.hidden; loginError.hidden = true; if (!loginForm.hidden) loginPass.focus(); });
  loginPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
  document.getElementById('login-submit').addEventListener('click', tryLogin);
  async function sha256hex(str) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  async function tryLogin() {
    loginError.hidden = true; let hash;
    try { hash = await sha256hex(loginPass.value); } catch (e) { loginError.textContent = 'Login needs https or localhost'; loginError.hidden = false; return; }
    if (hash === PASS_HASH) { loginPass.value = ''; loginForm.hidden = true; enterEditMode(); } else { loginError.textContent = 'Incorrect password'; loginError.hidden = false; }
  }
  function chrome() {
    const ghConn = GH.connected();
    document.body.classList.toggle('gh-on', ghConn && !API_OK);
    document.getElementById('gh-area').hidden = API_OK;
    document.getElementById('publish-btn').hidden = !API_OK;
    document.getElementById('copy-order').hidden = API_OK || ghConn;
    document.getElementById('reset-order').hidden = API_OK || ghConn;
    document.getElementById('gh-connect').hidden = ghConn;
    document.getElementById('gh-disconnect').hidden = !ghConn;
    document.getElementById('add-img-btn').hidden = !(API_OK || ghConn);
    document.getElementById('gh-status').innerHTML = `<span class="gh-dot ${ghConn ? 'on' : ''}"></span>GitHub: ${ghConn ? 'connected' : 'not connected'}`;
    editMsg.textContent = API_OK
      ? 'Editing locally — drag to reorder · ✎ to edit/add/replace images · + New work · then Publish.'
      : (ghConn ? 'Editing the live site — changes commit to GitHub on save (live in ~1 min).'
                : 'Connect GitHub to edit the live site (drag/✎/drop), or run node studio.mjs locally.');
  }
  function enterEditMode() { editMode = true; document.body.classList.add('edit-mode'); editBar.hidden = false; loginBtn.hidden = true; chrome(); render(); }
  function exitEditMode() { editMode = false; document.body.classList.remove('edit-mode'); editBar.hidden = true; loginBtn.hidden = false; if (openEditorEl) { openEditorEl.remove(); openEditorEl = null; } closeHeroEditor(); render(); }
  document.getElementById('logout-btn').addEventListener('click', exitEditMode);
  { const editSub = document.getElementById('edit-sub'); if (editSub) editSub.addEventListener('click', openSubtitleEditor); }
  document.getElementById('reset-order').addEventListener('click', () => { localStorage.removeItem(ORDER_KEY); loadData().then(render); flashMsg('Reset to default order.'); });
  document.getElementById('copy-order').addEventListener('click', async () => { const t = MANIFEST.physical.map((p, i) => `${i + 1}. ${p.title}`).join('\n'); try { await navigator.clipboard.writeText(t); flashMsg('Order copied.'); } catch (e) { window.prompt('Order:', MANIFEST.physical.map(p => p.title).join(' | ')); } });
  document.getElementById('publish-btn').addEventListener('click', async () => {
    flashMsg('Publishing to GitHub…');
    try { const r = await fetch('/api/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Update portfolio content' }) }); const j = await r.json(); flashMsg(j.ok ? ('Published ✓ ' + (j.detail || '')) : ('Publish failed: ' + (j.error || ''))); } catch (e) { flashMsg('Publish failed: ' + e.message); }
  });
  // + New work — create new project(s) from picked images (filename becomes the title)
  document.getElementById('add-img-btn').addEventListener('click', () => document.getElementById('add-img-file').click());
  document.getElementById('add-img-file').addEventListener('change', (e) => { if (e.target.files.length) uploadFiles(e.target.files); e.target.value = ''; });

  // GitHub connect controls
  document.getElementById('gh-connect').addEventListener('click', () => { const f = document.getElementById('gh-form'); f.hidden = !f.hidden; if (!f.hidden) document.getElementById('gh-token').focus(); });
  document.getElementById('gh-disconnect').addEventListener('click', () => { localStorage.removeItem('gh.token'); chrome(); render(); flashMsg('GitHub disconnected.'); });
  document.getElementById('gh-token').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('gh-token-save').click(); });
  document.getElementById('gh-token-save').addEventListener('click', async () => {
    const tok = document.getElementById('gh-token').value.trim(); if (!tok) return;
    localStorage.setItem('gh.token', tok);
    flashMsg('Checking token…');
    try { await GH.api(`/repos/${GH.owner}/${GH.repo}`); document.getElementById('gh-token').value = ''; document.getElementById('gh-form').hidden = true; chrome(); render(); flashMsg('GitHub connected ✓ — you can now edit the live site.'); }
    catch (e) { localStorage.removeItem('gh.token'); chrome(); flashMsg('Token rejected: ' + e.message); }
  });

  let flashTimer;
  function flashMsg(msg) { editMsg.textContent = msg; clearTimeout(flashTimer); flashTimer = setTimeout(chrome, 4000); }

  // ---------- Scroll-spy for the section nav ----------
  function initScrollSpy() {
    const links = document.querySelectorAll('.toggle a');
    const sections = ['physical', 'digital'].map(id => document.getElementById(id)).filter(Boolean);
    if (!('IntersectionObserver' in window) || !sections.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          const id = en.target.id;
          links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
        }
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    sections.forEach(s => io.observe(s));
  }

  // ---------- Scroll-driven Physical→Digital background shift ----------
  // Reads POSITION every frame (rAF-throttled), so it tracks both manual scroll
  // and the native smooth-scroll fired by the "Digital" nav anchor, and reverses
  // when scrolling back up. Writes one custom property; CSS derives color + grid.
  function initBgShift() {
    const digital = document.getElementById('digital');
    if (!digital) return;
    const root = document.documentElement;

    // Fine grid overlay (injected here so the markup is left untouched).
    const grid = document.createElement('div');
    grid.className = 'digital-bg';
    grid.setAttribute('aria-hidden', 'true');
    document.body.prepend(grid);

    let ticking = false;
    function measure() {
      ticking = false;
      // Reads first (no interleaved writes → no layout thrash).
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const boundary = digital.getBoundingClientRect().top; // viewport-relative top of #digital
      // p = 0.5 when the boundary sits at the viewport CENTER; the fade spans ~one
      // viewport total (≈ half a viewport on each side). Boundary above center → techy.
      const travel = vh;                            // total fade distance; tune for feel
      let p = 0.5 + (vh / 2 - boundary) / travel;
      p = p < 0 ? 0 : p > 1 ? 1 : p;                // clamp [0,1]
      // Writes (batched after the reads above).
      root.style.setProperty('--digital', p.toFixed(4));
      // Peaks at the crossover, 0 at either rest state — gates a faint legibility
      // halo so text never washes out as it and the bg pass through mid-grey together.
      root.style.setProperty('--digital-mid', (1 - Math.abs(2 * p - 1)).toFixed(4));
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(measure);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    measure(); // correct on load (incl. deep-link straight to #digital)
  }

  // ---------- Smooth section-nav scrolling ----------
  // Animated in JS rather than via CSS scroll-behavior:smooth, because iOS Safari doesn't
  // reliably animate native fragment jumps (they snap). A short easeOutCubic glide feels fast
  // and identical on every platform; window.scrollTo runs per-frame (CSS smooth is now `auto`),
  // and each step fires a scroll event so the Physical→Digital background shift tracks along.
  function curY() { return window.pageYOffset || document.documentElement.scrollTop || 0; }
  function smoothScrollTo(toY, duration) {
    const startY = curY();
    const max = Math.max(0, (document.documentElement.scrollHeight || 0) - window.innerHeight);
    const dest = Math.min(Math.max(0, toY), max);
    const dist = dest - startY;
    if (Math.abs(dist) < 2) { window.scrollTo(0, dest); return; }
    const ease = (t) => 1 - Math.pow(1 - t, 3); // quick start, soft settle
    let start = null;
    function step(ts) {
      if (start == null) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      window.scrollTo(0, startY + dist * ease(t));
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function initSmoothNav() {
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href').slice(1);
        if (!id) return;
        const target = document.getElementById(id);
        if (!target) return;
        e.preventDefault();
        const top = Math.max(0, target.getBoundingClientRect().top + curY() - 16); // ~scroll-margin
        if (reduceMotion) { window.scrollTo(0, top); }
        else { smoothScrollTo(top, Math.min(680, Math.max(360, Math.abs(top - curY()) * 0.32))); }
        history.replaceState(null, '', '#' + id);
      });
    });
  }

  // ---------- Init ----------
  (async () => {
    await loadData();
    render();
    initScrollSpy();
    initBgShift();
    initSmoothNav();
    const y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
  })();
})();
