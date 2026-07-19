import { GeodeWorker } from './client.js';

if (!Map.prototype.getOrInsertComputed) Map.prototype.getOrInsertComputed = function (k, fn) { if (!this.has(k)) this.set(k, fn(k)); return this.get(k); };
if (!Map.prototype.getOrInsert) Map.prototype.getOrInsert = function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); };
if (!WeakMap.prototype.getOrInsertComputed) WeakMap.prototype.getOrInsertComputed = function (k, fn) { if (!this.has(k)) this.set(k, fn(k)); return this.get(k); };
if (!WeakMap.prototype.getOrInsert) WeakMap.prototype.getOrInsert = function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); };

const VERB = document.body.dataset.verb;
const REL = document.body.dataset.rel ?? '';
const ASSETS = new URL(`${REL}assets/`, location.href).href;

const WORKER_CONFIG = {
  pdfjsUrl: ASSETS + 'pdfjs/pdf.mjs',
  workerSrc: ASSETS + 'pdfjs/pdf.worker.min.mjs',
  getDocumentParams: {
    wasmUrl: ASSETS + 'pdfjs/wasm/',
    cMapUrl: ASSETS + 'pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: ASSETS + 'pdfjs/standard_fonts/',
    iccUrl: ASSETS + 'pdfjs/wasm/',
  },
  mozjpegUrl: ASSETS + 'mozjpeg/encode-shim.js',
  tesseractUrl: ASSETS + 'tesseract/tesseract.esm.min.js',
  ocr: {
    workerPath: ASSETS + 'tesseract/worker.min.js',
    corePath: ASSETS + 'tesseract/core',
    langPath: ASSETS + 'ocr-lang',
    gzip: true,
  },
};

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : n >= 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B';

function toast(msg) {
  const t = el('div', 'toast', escapeHtml(msg));
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function download(bytes, name, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = el('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const outName = (name, suffix, ext = 'pdf') =>
  name.replace(/\.pdf$/i, '') + '-' + suffix + '.' + ext;

let gw = null;
function getWorker() {
  gw ??= new GeodeWorker(ASSETS + 'geodepdf.worker.js', WORKER_CONFIG, {
    onWarn: (m) => { $('#warnmount').appendChild(el('div', 'warnbar', escapeHtml(m))); },
  });
  return gw;
}

let pdfjsP = null;
function getPdfjs() {
  pdfjsP ??= import(WORKER_CONFIG.pdfjsUrl).then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER_CONFIG.workerSrc;
    return pdfjs;
  });
  return pdfjsP;
}
const openDoc = async (bytes) => {
  const pdfjs = await getPdfjs();
  return pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, ...WORKER_CONFIG.getDocumentParams }).promise;
};

let redactUiP = null;
const getRedactUi = () => (redactUiP ??= import(ASSETS + 'redact-ui.js'));

async function runOp(op, input, opts, { area = '#receipt' } = {}) {
  if (opts && opts.__op) { const { __op, ...rest } = opts; return runOp(__op, input, rest, { area }); }
  const holder = el('div', 'pane');
  holder.appendChild(el('div', 'prog', '<i></i>'));
  const bar = holder.querySelector('i');
  const steps = el('div', 'steps', 'starting…');
  holder.appendChild(steps);
  const cancelBtn = el('button', null, 'Cancel');
  cancelBtn.style.marginTop = '8px';
  holder.appendChild(cancelBtn);
  const mount = $(area); mount.innerHTML = ''; mount.appendChild(holder);

  const { promise, cancel } = getWorker().run(op, input, opts, (p) => {
    const label =
      p.phase === 'model' ? 'loading recognition model…' :
      p.phase === 'pages' ? `page ${p.done ?? '…'}${p.total ? ' of ' + p.total : ''}…` :
      p.total ? `step ${p.done} of ${p.total}…` :
      p.done != null ? `working… (${p.done})` : 'working…';
    steps.textContent = label;
    if (p.pct != null) bar.style.width = Math.round(p.pct * 100) + '%';
    else if (p.total) bar.style.width = Math.round(((p.done ?? 0) / p.total) * 100) + '%';
  });
  cancelBtn.onclick = () => { cancel(); steps.textContent = 'cancelling…'; };

  try {
    const r = await promise;
    mount.innerHTML = '';
    return r;
  } catch (e) {
    mount.innerHTML = '';
    if (e.name === 'Cancelled') {
      const box = el('div', 'receipt');
      box.appendChild(el('p', 'head', 'Cancelled'));
      box.appendChild(el('p', null, 'The work actually stopped, and nothing was changed. Your original is untouched.'));
      mount.appendChild(box);
      return null;
    }
    const box = el('div', 'errbar');
    box.appendChild(el('strong', null, 'The engine refused: '));
    box.appendChild(document.createTextNode(e.message));
    if (e.workerStack) {
      const d = el('details'); d.appendChild(el('summary', null, 'technical detail'));
      d.appendChild(el('pre', null, escapeHtml(e.workerStack)));
      box.appendChild(d);
    }
    mount.appendChild(box);
    return null;
  }
}

function receiptBox(headHtml) {
  const box = el('div', 'receipt');
  if (headHtml) box.appendChild(el('p', 'head', headHtml));
  return box;
}
function addNotes(box, summary) {
  const notes = summary?.notes ?? summary?.report?.notes ?? [];
  for (const n of notes) box.appendChild(el('p', 'warnv', escapeHtml(n)));
}
function addDownload(box, bytes, name, label = 'Download PDF', type) {
  const b = el('button', 'primary', label);
  b.onclick = () => download(bytes, name, type);
  box.appendChild(b);
  return b;
}

const state = { file: null, files: [] };

const MULTI = new Set(['merge', 'images-to-pdf', 'verify']);
const ACCEPT = {
  'images-to-pdf': 'image/png,image/jpeg',
};

function setFile(name, bytes) {
  state.file = { name, bytes };
  $('#fname').textContent = `${name} · ${fmt(bytes.length)}`;
  $('#ftruth').textContent = '';
  $('#filecard').hidden = false;
  $('#receipt').innerHTML = '';
  renderPanel();
}

function addFiles(list) {
  for (const f of list) state.files.push(f);
  renderPanel();
}

async function onFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const read = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  if (MULTI.has(VERB)) addFiles(read);
  else setFile(read[0].name, read[0].bytes);
}

const PANEL = {};

PANEL.compress = (pane) => {
  if (!state.file) { pane.appendChild(el('p', 'hint', 'Drop a file first. We inspect it and only ever show choices that can actually change the result.')); return; }

  const run = async (preset) => {
    const r = await runOp('compress', state.file.bytes, { preset });
    if (!r) return;
    const s = r.summary;
    const box = receiptBox(`${fmt(s.before)} → <b>${fmt(s.after)}</b>`);
    box.appendChild(el('p', 'verd', escapeHtml(s.headline)));
    addNotes(box, s);
    if (s.images?.length) {
      const rows = s.images.map((im) =>
        `<tr><td>${escapeHtml(im.tag)}</td><td>${im.width}×${im.height}</td><td>${escapeHtml(im.action)}</td></tr>`).join('');
      box.appendChild(el('table', null, '<tr><th>image</th><th>size</th><th>what happened</th></tr>' + rows));
    }
    if (s.presetsMatter) {
      const lad = el('div', 'ladder');
      lad.innerHTML = `
        <label><input type="radio" name="preset" value="screen"${preset === 'screen' ? ' checked' : ''}/> <span><strong>Screen</strong> <span class="pd">— smallest; for reading on a display</span></span></label>
        <label><input type="radio" name="preset" value="email"${preset === 'email' ? ' checked' : ''}/> <span><strong>Email</strong> <span class="pd">— fits mail and upload-portal limits</span></span></label>
        <label><input type="radio" name="preset" value="print"${preset === 'print' ? ' checked' : ''}/> <span><strong>Print</strong> <span class="pd">— for paper; larger</span></span></label>
        <label><input type="radio" name="preset" value="light"${preset === 'light' ? ' checked' : ''}/> <span><strong>Light touch</strong> <span class="pd">— minimal intervention</span></span></label>`;
      box.appendChild(el('p', null, 'The presets genuinely differ on this file — try another tier:'));
      box.appendChild(lad);
      const again = el('button', null, 'Compress at the selected tier');
      again.onclick = () => run(box.querySelector('input[name=preset]:checked')?.value ?? 'email');
      box.appendChild(again);
      box.appendChild(document.createTextNode(' '));
    } else {
      box.appendChild(el('p', 'verd', 'Why there is no quality picker: we ran the tiers against your file and every one of them produces byte-identical output. A picker here would be a choice that does not exist, so it isn’t shown.'));
    }
    if (s.after < s.before) addDownload(box, r.bytes, outName(state.file.name, 'compressed'), 'Download compressed PDF');
    else addDownload(box, r.bytes, outName(state.file.name, 'unchanged'), 'Download (original kept)');
    $('#receipt').appendChild(box);
  };

  pane.appendChild(el('p', null, 'One button, then the receipt. If a quality choice can change the result for your file, you get the choice — after we’ve measured, not before.'));
  const row = el('div', 'runrow');
  const go = el('button', 'primary', 'Compress');
  go.onclick = () => run('email');
  row.appendChild(go);
  pane.appendChild(row);
  pane.appendChild(el('p', 'promise', 'Progress is per image and honest; Cancel actually cancels and your original is untouched.'));
};

PANEL.sanitize = (pane) => {
  if (!state.file) {
    pane.appendChild(el('p', 'hint', 'Drop a PDF. It is inspected first — you see everything found inside it, and nothing is removed until you choose.'));
    return;
  }
  pane.appendChild(el('p', 'promise', 'Inspecting on this device — nothing is uploaded.'));
  (async () => {
    const r = await runOp('inspect', state.file.bytes, {});
    if (!r) return;
    renderSanitizeOffer(r.summary);
  })();
};

function renderSanitizeOffer(rep, opts = {}) {
  const mount = $('#receipt');
  mount.innerHTML = '';
  const box = receiptBox(`What <b>${escapeHtml(state.file.name)}</b> carries`);
  box.appendChild(el('p', 'verd', escapeHtml(rep.headline)));

  if (rep.encrypted || rep.canSanitize === false && rep.encrypted !== false && rep.classes.length === 0) {
    mount.appendChild(box);
    return;
  }

  if (rep.deepScan && !rep.deepScan.ran) {
    box.appendChild(el('p', 'warnv', 'Deep text scan did not run: ' + escapeHtml(rep.deepScan.reason) + ' Off-page, covered and invisible text are NOT CHECKED below — an unknown, not a pass.'));
  }

  const found = rep.classes.filter((c) => c.found);
  const clean = rep.classes.filter((c) => !c.found);

  const listEl = el('div', 'sanlist');
  if (!found.length) {
    box.appendChild(el('p', 'vfnote', 'Nothing found in the classes we check. Presence, not absence — that is not a certificate. Rebuilding anyway still guarantees a fresh single-revision file.'));
  }
  for (const c of found) {
    if (c.selectable === false) {
      const row0 = el('div', 'sanrow auto');
      row0.appendChild(el('span', 'sanauto', '✓ automatic'));
      const body0 = el('span', 'sanbody');
      body0.appendChild(el('span', 'fclass', `${escapeHtml(c.label)}${c.count > 1 ? ` <span class="fcount">×${c.count}</span>` : ''}`));
      body0.appendChild(el('div', 'fnote', (c.note ? escapeHtml(c.note) + ' ' : '') + 'Cleared by construction: the rebuilt file is written fresh, single-revision, reachable objects only.'));
      row0.appendChild(body0);
      listEl.appendChild(row0);
      continue;
    }
    const row = el('label', 'sanrow');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.cls = c.id;
    if (c.removable === false) { cb.disabled = true; cb.checked = false; row.classList.add('off'); }
    else cb.checked = !c.optIn;
    row.appendChild(cb);
    const body = el('span', 'sanbody');
    body.appendChild(el('span', 'fclass', `${escapeHtml(c.label)}${c.count > 1 ? ` <span class="fcount">×${c.count}</span>` : ''}`));
    if (c.note) body.appendChild(el('div', 'fnote', escapeHtml(c.note)));
    if (c.removable === 'partial') body.appendChild(el('div', 'fnote', 'Removal may be partial for this class — the receipt will say exactly what happened.'));
    row.appendChild(body);
    listEl.appendChild(row);
  }
  box.appendChild(listEl);
  if (clean.length) {
    box.appendChild(el('p', 'vfnote', 'Nothing found in: ' + clean.map((c) => escapeHtml(c.label.split(' (')[0])).join(' · ') + '.'));
  }

  let forceCb = null;
  if (rep.signatures?.count) {
    const w = el('div', 'warnbar');
    w.appendChild(el('div', null, `<b>${rep.signatures.count} digital signature(s) present.</b> Any rebuild rewrites the signed bytes, so every validator will report the signature as broken afterwards. The signature value itself is never deleted.`));
    const lab = el('label', 'sanrow');
    forceCb = document.createElement('input');
    forceCb.type = 'checkbox';
    lab.appendChild(forceCb);
    lab.appendChild(el('span', 'sanbody', 'I accept that the signature will read as void — proceed.'));
    w.appendChild(lab);
    box.appendChild(w);
  }

  const row = el('div', 'runrow');
  const go = el('button', 'primary', opts.runLabel || 'Rebuild without the selected classes');
  go.onclick = async () => {
    const sel = [...listEl.querySelectorAll('input[type=checkbox]')].filter((x) => x.checked && !x.disabled).map((x) => x.dataset.cls);
    if (rep.signatures?.count && !forceCb?.checked) {
      alertBar(box, 'This file is signed — tick the acknowledgement above first. We will not void a signature silently.');
      return;
    }
    const r = await runOp('sanitize', state.file.bytes, { classes: sel, ...(forceCb?.checked ? { force: true } : {}) });
    if (!r) return;
    (opts.onDone || renderSanitizeReceipt)(r);
  };
  row.appendChild(go);
  box.appendChild(row);
  box.appendChild(el('p', 'promise', 'The output is re-inspected on its own terms before you get it — the tool refuses to hand over a file that fails that check.'));
  mount.appendChild(box);
}

function alertBar(box, msg) {
  box.querySelector('.errbar')?.remove();
  box.appendChild(el('p', 'errbar', escapeHtml(msg)));
}

function renderSanitizeReceipt(r) {
  const s = r.summary;
  const mount = $('#receipt');
  mount.innerHTML = '';
  const box = receiptBox(`${fmt(s.before)} → <b>${fmt(s.after)}</b>`);
  box.appendChild(el('p', 'verd', escapeHtml(s.headline)));
  for (const n of s.notes ?? []) box.appendChild(el('p', 'warnv', escapeHtml(n)));

  const touched = (s.classes ?? []).filter((c) => c.found > 0 || c.status !== 'not-found');
  if (touched.length) {
    const rows = touched.map((c) =>
      `<tr><td>${escapeHtml(c.label ?? c.id)}</td><td>${c.found ?? 0}</td><td>${c.removed ?? 0}</td>` +
      `<td>${escapeHtml(c.status)}${c.reason ? `<div class="fnote">${escapeHtml(c.reason)}</div>` : ''}</td></tr>`).join('');
    box.appendChild(el('table', null, '<tr><th>class</th><th>found</th><th>removed</th><th>status</th></tr>' + rows));
  }
  box.appendChild(el('p', 'vfnote', '“Removed” above means verified by re-inspecting the output — not taken from the plan. Presence, not absence: this receipt covers the classes checked, and is not a certificate that nothing else exists.'));
  addDownload(box, r.bytes, outName(state.file.name, 'sanitized'), 'Download sanitized PDF');
  mount.appendChild(box);
}

const rd = { pdfjs: null, ui: null, doc: null, pages: 0, page: 0, marks: new Map(), tool: 'snap', ps: null, committed: null, brush: null };

PANEL.redact = (pane) => {
  if (!state.file) { pane.appendChild(el('p', 'hint', 'Drop a file first. Mark what must go; on text pages your mark snaps to the words it covers.')); return; }
  pane.appendChild(el('p', null, 'Drag over what must go. On text pages the mark <strong>snaps to the words it covers</strong> — a box that under-covers by two pixels would leave the letter-tops readable, so we don’t let it. Review the mark list before committing: <em>we can prove a mark is opaque; only you can prove it covers the right thing.</em>'));

  const bar = el('div', 'shapebar');
  bar.innerHTML = '<span>Marking tool:</span>';
  for (const [id, label] of [['snap', 'Snap to words'], ['rect', 'Box'], ['ellipse', 'Ellipse'], ['brush', 'Brush']]) {
    const b = el('button', null, label);
    b.setAttribute('aria-pressed', String(rd.tool === id));
    b.onclick = () => { rd.tool = id; renderPanel(); };
    bar.appendChild(b);
  }
  bar.appendChild(el('span', null, 'Box/ellipse/brush are for scans; on text pages every tool still takes the whole of any word it touches.'));
  pane.appendChild(bar);

  const wrap = el('div', 'rwrap');
  const thumbs = el('div', 'thumbs'); thumbs.id = 'thumbs';
  const pv = el('div', 'pageview'); pv.id = 'pageview';
  wrap.appendChild(thumbs); wrap.appendChild(pv);
  pane.appendChild(wrap);

  const ml = el('div', 'marklist'); ml.id = 'marklist';
  pane.appendChild(ml);

  const row = el('div', 'runrow'); row.id = 'redactrow';
  pane.appendChild(row);
  pane.appendChild(el('p', 'aimnote', 'Verification is not aim: our checks prove the marked region is destroyed — they cannot know you marked the right thing. This list and the preview are the aim step. Read them.'));

  initRedact().catch((e) => {
    pane.appendChild(el('div', 'errbar', 'Could not open this PDF for marking: ' + escapeHtml(e.message)));
  });
};

async function initRedact() {
  rd.pdfjs = await getPdfjs();
  rd.ui = await getRedactUi();
  rd.doc?.destroy?.();
  rd.doc = await openDoc(state.file.bytes);
  rd.pages = rd.doc.numPages;
  rd.page = Math.min(rd.page, rd.pages - 1);
  $('#ftruth').textContent = `${rd.pages} page${rd.pages > 1 ? 's' : ''}`;
  await drawThumbs();
  await drawRedactPage();
  renderMarkList();
}

async function renderPageCanvas(pageIndex, cssWidth) {
  const page = await rd.doc.getPage(pageIndex + 1);
  if (pageIndex === rd.page && rd.ui?.pageSpaceFromPdfjs) rd.pageSpace = rd.ui.pageSpaceFromPdfjs(page);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = cssWidth / vp1.width;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const vp = page.getViewport({ scale: scale * ratio });
  const canvas = el('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  canvas.style.width = cssWidth + 'px';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { canvas, viewW: vp1.width, viewH: vp1.height };
}

async function drawThumbs() {
  const box = $('#thumbs'); box.innerHTML = '';
  for (let p = 0; p < rd.pages; p++) {
    const t = el('div', 'thumb' + (p === rd.page ? ' on' : ''));
    t.onclick = () => { rd.page = p; drawRedactPage(); [...box.children].forEach((c, i) => c.classList.toggle('on', i === p)); };
    if ((rd.marks.get(p) ?? []).length) t.appendChild(el('i', 'dotmark'));
    box.appendChild(t);
    renderPageCanvas(p, 66).then(({ canvas }) => { t.prepend(canvas); }).catch(() => {});
  }
}

async function drawRedactPage() {
  const pv = $('#pageview'); if (!pv) return;
  pv.innerHTML = '';
  const cssW = Math.min(pv.clientWidth || 640, 900);
  const src = rd.committed ?? state.file.bytes;
  let rendered;
  if (rd.committed) {
    const doc = await openDoc(rd.committed);
    const saved = rd.doc; rd.doc = doc;
    rendered = await renderPageCanvas(rd.page, cssW);
    rd.doc = saved;
    await doc.destroy?.();
  } else {
    rendered = await renderPageCanvas(rd.page, cssW);
  }
  pv.appendChild(rendered.canvas);
  rd.ps = { viewW: rendered.viewW, viewH: rendered.viewH, cssW };

  const overlay = el('div');
  overlay.style.cssText = 'position:absolute;inset:0;cursor:crosshair;touch-action:none';
  pv.style.position = 'relative';
  pv.appendChild(overlay);
  drawMarkBoxes(overlay);
  if (!rd.committed) enableMarking(overlay);
}

const pxToView = (px) => px * (rd.ps.viewW / rd.ps.cssW);

const cssRectToView = (r) => ({
  x: pxToView(r.x),
  y: rd.ps.viewH - pxToView(r.y + r.height),
  width: pxToView(r.width),
  height: pxToView(r.height),
});
const cssPointToView = (p) => ({ x: pxToView(p.x), y: rd.ps.viewH - pxToView(p.y) });

function drawMarkBoxes(overlay) {
  const f = 100 / rd.ps.viewW, fy = 100 / rd.ps.viewH;
  for (const m of rd.marks.get(rd.page) ?? []) {
    for (const r of m.viewRects) {
      const d = el('div', 'mark' + (rd.committed ? ' final' : ''));
      d.style.left = r.x * f + '%'; d.style.top = (rd.ps.viewH - r.y - r.height) * fy + '%';
      d.style.width = r.width * f + '%'; d.style.height = r.height * fy + '%';
      overlay.appendChild(d);
    }
  }
}

function enableMarking(overlay) {
  let start = null, sel = null, path = [];
  overlay.addEventListener('pointerdown', (e) => {
    overlay.setPointerCapture(e.pointerId);
    const r = overlay.getBoundingClientRect();
    start = { x: e.clientX - r.left, y: e.clientY - r.top };
    path = [start];
    sel = el('div'); sel.id = 'selbox';
    overlay.appendChild(sel);
  });
  overlay.addEventListener('pointermove', (e) => {
    if (!start) return;
    const r = overlay.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
    const y = Math.max(0, Math.min(e.clientY - r.top, r.height));
    path.push({ x, y });
    sel.style.left = Math.min(start.x, x) + 'px'; sel.style.top = Math.min(start.y, y) + 'px';
    sel.style.width = Math.abs(x - start.x) + 'px'; sel.style.height = Math.abs(y - start.y) + 'px';
  });
  overlay.addEventListener('pointerup', async () => {
    if (!start) return;
    const box = sel.getBoundingClientRect(), or = overlay.getBoundingClientRect();
    sel.remove(); sel = null;
    const s = start; start = null; void s;
    const w = box.width, h = box.height;
    if (w < 5 && h < 5) return;
    const viewRect = cssRectToView({ x: box.left - or.left, y: box.top - or.top, width: w, height: h });
    try {
      await addMark(viewRect, path.map(cssPointToView));
    } catch (e) {
      toast('Could not place that mark: ' + e.message);
    }
  });
}

async function addMark(viewRect, viewPath) {
  const { snapSelection, viewShapeToUser, normalizeShape } = rd.ui;
  const list = rd.marks.get(rd.page) ?? [];

  if (rd.tool === 'snap') {
    const gesture = { type: 'rect', ...viewRect };
    const res = await snapSelection(state.file.bytes, rd.page, gesture, { pdfjs: rd.pdfjs, space: 'view' });
    if (res.hasTextLayer) {
      if (!res.runs.length) { toast('That mark covered no text. Drag over the words you want removed — a mark over blank paper redacts nothing.'); return; }
      list.push({
        kind: 'snap',
        rects: res.runs.map((r) => r.rect),
        viewRects: res.runs.map((r) => rd.ui.userRectToView(r.rect, res.ps)),
        label: res.runs.map((r) => r.text).join(' '),
      });
    } else {
      const shape = viewShapeToUser(normalizeShape({ type: 'rect', ...viewRect }), res.ps);
      list.push({ kind: 'shape', shapes: [shape], viewRects: [viewRect], label: null });
      toast('This page is a scan (no text layer) — the mark is a box; the pixels under it will be destroyed.');
    }
  } else {
    let shape;
    if (rd.tool === 'brush') shape = normalizeShape({ type: 'brush', points: viewPath, width: Math.max(10, pxToView(12)) });
    else shape = normalizeShape({ type: rd.tool, ...viewRect });
    const userShape = rd.pageSpace ? viewShapeToUser(shape, rd.pageSpace) : shape;
    list.push({ kind: 'shape', shapes: [userShape], viewRects: [viewRect], label: null });
  }

  rd.marks.set(rd.page, list);
  await drawRedactPage();
  renderMarkList();
  drawThumbs();
}

function buildRedactions() {
  const out = [];
  for (const [page, list] of rd.marks) {
    if (!list.length) continue;
    const entry = { page, rects: [], shapes: [] };
    for (const m of list) {
      if (m.kind === 'snap') entry.rects.push(...m.rects);
      else entry.shapes.push(...m.shapes);
    }
    if (!entry.rects.length) delete entry.rects;
    if (!entry.shapes.length) delete entry.shapes;
    out.push(entry);
  }
  return out;
}

function renderMarkList() {
  const ml = $('#marklist'); if (!ml) return;
  ml.innerHTML = '';
  let n = 0;
  for (const [page, list] of [...rd.marks.entries()].sort((a, b) => a[0] - b[0])) {
    for (const [i, m] of list.entries()) {
      n++;
      const mi = el('div', 'mi');
      mi.appendChild(el('span', null, `p.${page + 1} —`));
      mi.appendChild(el('code', null, m.label
        ? 'removes: ' + escapeHtml(m.label)
        : 'pixels only — this area will be destroyed, then the page rasterised'));
      if (!rd.committed) {
        const x = el('button', null, 'remove mark');
        x.onclick = () => { list.splice(i, 1); if (!list.length) rd.marks.delete(page); drawRedactPage(); renderMarkList(); drawThumbs(); renderRedactRow(); };
        mi.appendChild(x);
      }
      ml.appendChild(mi);
    }
  }
  if (!n && !rd.committed) ml.appendChild(el('p', 'hint', 'No marks yet.'));
  renderRedactRow();
}

function renderRedactRow() {
  const row = $('#redactrow'); if (!row) return;
  row.innerHTML = '';
  if (rd.committed) return;
  let n = 0; for (const [, l] of rd.marks) n += l.length;
  const prev = el('button', null, 'Preview exactly what will be destroyed');
  prev.disabled = n === 0;
  prev.onclick = previewMarks;
  const go = el('button', 'primary', `Redact — permanently remove ${n} mark${n === 1 ? '' : 's'}`);
  go.disabled = n === 0;
  go.onclick = commitRedaction;
  const clr = el('button', null, 'Clear marks');
  clr.onclick = () => { rd.marks.clear(); drawRedactPage(); renderMarkList(); drawThumbs(); };
  row.appendChild(prev); row.appendChild(go); row.appendChild(clr);
}

async function previewMarks() {
  const { previewRedactions } = rd.ui;
  const plans = await previewRedactions(state.file.bytes, buildRedactions(), { pdfjs: rd.pdfjs });
  const plan = plans.find((p) => p.page === rd.page) ?? plans[0];
  if (plan && plan.page !== rd.page) { rd.page = plan.page; await drawRedactPage(); }
  if (!plan) return;
  const pv = $('#pageview');
  const mc = el('canvas');
  mc.width = plan.mask.width; mc.height = plan.mask.height;
  const ctx = mc.getContext('2d');
  const img = ctx.createImageData(plan.mask.width, plan.mask.height);
  for (let i = 0; i < plan.mask.data.length; i++) {
    if (plan.mask.data[i]) { const o = i * 4; img.data[o] = 20; img.data[o + 1] = 16; img.data[o + 2] = 24; img.data[o + 3] = 230; }
  }
  ctx.putImageData(img, 0, 0);
  mc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  pv.appendChild(mc);
  const note = el('p', 'hint',
    `Preview on p.${plan.page + 1}: planned method is <strong>${plan.method}</strong> (${escapeHtml(plan.why)}). ` +
    'The dark region is the exact area that will be destroyed — same mask the verifier checks.');
  $('#receipt').innerHTML = ''; $('#receipt').appendChild(note);
}

async function commitRedaction() {
  const redactions = buildRedactions();
  const r = await runOp('redact', state.file.bytes, { redactions, method: 'auto' });
  if (!r) return;
  rd.committed = r.bytes;
  await drawRedactPage(); renderMarkList(); drawThumbs(); renderRedactRow();

  const s = r.summary;
  const box = receiptBox('Redacted — and verified, twice');
  const rows = (s.report ?? []).map((rep) => {
    const verified = rep.method === 'surgery' ? 'text ✓ · pixels ✓' : 'pixels ✓';
    const what = rep.method === 'surgery'
      ? escapeHtml(rep.verified ?? rep.why ?? 'glyphs deleted from the page’s instruction list; every other word is still real, selectable text')
      : escapeHtml(rep.why ?? 'no text layer — the marked pixels were destroyed, not covered');
    return `<tr><td>p.${rep.page + 1}</td><td><strong>${rep.method ?? rep.action}</strong></td><td>${what}</td><td class="verd">${verified}</td></tr>`;
  }).join('');
  box.appendChild(el('table', null, '<tr><th>page</th><th>method</th><th>what happened</th><th>verified</th></tr>' + rows));
  if (s.rasterised?.length) {
    box.appendChild(el('p', 'warnv',
      `Cost, stated plainly: page${s.rasterised.length > 1 ? 's' : ''} ` +
      s.rasterised.map((p) => p + 1).join(', ') +
      ' became an image — no selectable text, search, or working links on that page. Untouched pages keep everything.'));
  }
  box.appendChild(el('p', null, 'Per page we attempt surgery, then extract the text back out of our own result and render its pixels. If the marked content survives, or anything is unverifiable, that page is rasterised instead — you are never less safe, only sometimes less convenient.'));

  const proof = el('div', 'proof');
  proof.innerHTML = '<div class="pcol"><h4>Extractor proof — run it yourself</h4><pre id="proofpre">press the button →</pre></div>';
  box.appendChild(proof);
  const btn = el('button', null, 'Extract the text of the redacted file');
  btn.onclick = async () => {
    const t = await runOp('pdf-to-text', rd.committed, {});
    if (!t) return;
    const labels = [];
    for (const [, list] of rd.marks) for (const m of list) if (m.label) labels.push(m.label);
    const text = t.text ?? '';
    const leaked = labels.filter((l) => l && text.includes(l));
    $('#receipt').appendChild(box);
    $('#proofpre').innerHTML = leaked.length
      ? `<span class="bad">MARKED TEXT FOUND: ${escapeHtml(leaked.join(' · '))}</span>\nThis should be impossible — the verifier should have thrown. Report it.`
      : '<span class="ok">0 marked characters recovered.</span>\nThe data is not hidden. It is gone.';
  };
  box.appendChild(btn);
  box.appendChild(document.createTextNode(' '));
  addDownload(box, r.bytes, outName(state.file.name, 'redacted'), 'Download redacted PDF');
  $('#receipt').appendChild(box);
}

PANEL.ocr = (pane) => {
  if (!state.file) { pane.appendChild(el('p', 'hint', 'Drop a scan — a photographed or faxed document with no real text layer. That is the file OCR exists for.')); return; }
  const lad = el('div', 'ladder');
  lad.innerHTML = `
    <label><input type="radio" name="ocrlang" value="eng" checked/> <span><strong>English</strong> <span class="pd">— model download: 2.0 MB</span></span></label>
    <label><input type="radio" name="ocrlang" value="chi_sim"/> <span><strong>简体中文</strong> (Simplified Chinese) <span class="pd">— model download: 1.7 MB</span></span></label>`;
  pane.appendChild(lad);
  pane.appendChild(el('p', null, 'One expectation, stated plainly: this is built for <strong>printed</strong> text. Handwriting is outside what it was trained on, so don’t expect much — but it’s your device and it costs you a moment, so you’re free to try. The confidence score is reported afterwards either way.'));
  const row = el('div', 'runrow');
  const go = el('button', 'primary', 'Recognize text');
  go.onclick = async () => {
    const lang = pane.querySelector('input[name=ocrlang]:checked')?.value ?? 'eng';
    const r = await runOp('ocr', state.file.bytes, { langs: [lang], makeSearchablePdf: true });
    if (!r) return;
    const s = r.summary;
    let box;
    if (s.kind === 'nothing-to-ocr') {
      box = receiptBox('This file already has real text');
      box.appendChild(el('p', null, escapeHtml(s.headline)));
      box.appendChild(el('p', 'hint', 'Nothing here needs recognition — “Get the text out” reads it directly, without the model download.'));
    } else if (s.kind === 'ocr-unreliable') {
      box = receiptBox('Recognized — but probably not usable');
      box.appendChild(el('p', 'warnv', escapeHtml(s.headline)));
      box.appendChild(el('p', null, 'You can still look at what it produced and judge for yourself — or keep the original as it is; a scan you can read with your eyes has lost nothing.'));
      const show = el('button', null, 'Show the output anyway');
      show.onclick = () => { box.appendChild(el('pre', null, escapeHtml(r.text ?? ''))); show.remove(); };
      box.appendChild(show);
    } else {
      box = receiptBox('Recognized');
      box.appendChild(el('p', 'verd', escapeHtml(s.headline)));
      box.appendChild(el('p', null, 'Skim the text against the image before you rely on it — confidence is a signal, not a guarantee, and a recognizer can be confidently wrong.'));
    }
    box.appendChild(el('p', 'hint', 'What OCR actually did: it laid an invisible, selectable text layer over the picture. The page looks identical — the recognized text now exists twice, in the pixels and in the layer. Your pages were not re-encoded.'));
    const rowb = el('div', 'dlrow');
    if (r.bytes && s.kind !== 'nothing-to-ocr') {
      const b = el('button', 'primary', 'Download searchable PDF');
      b.onclick = () => download(r.bytes, outName(state.file.name, 'searchable'));
      rowb.appendChild(b);
    }
    if (r.text) {
      const c = el('button', null, 'Copy recognized text');
      c.onclick = async () => { await navigator.clipboard.writeText(r.text); toast('Copied.'); };
      rowb.appendChild(c);
    }
    box.appendChild(rowb);
    $('#receipt').appendChild(box);
  };
  row.appendChild(go);
  pane.appendChild(row);
};

function fileListUi(pane, runLabel, onRun, meta) {
  const fl = el('div', 'flist');
  state.files.forEach((f, i) => {
    const row = el('div', 'frow');
    row.appendChild(el('span', null, `<strong>${escapeHtml(f.name)}</strong>`));
    row.appendChild(el('span', 'fm', fmt(f.bytes.length)));
    const up = el('button', null, '▲'); up.disabled = i === 0;
    up.onclick = () => { state.files.splice(i, 1); state.files.splice(i - 1, 0, f); renderPanel(); };
    const dn = el('button', null, '▼'); dn.disabled = i === state.files.length - 1;
    dn.onclick = () => { state.files.splice(i, 1); state.files.splice(i + 1, 0, f); renderPanel(); };
    const rm = el('button', null, 'remove');
    rm.onclick = () => { state.files.splice(i, 1); renderPanel(); };
    row.appendChild(up); row.appendChild(dn); row.appendChild(rm);
    fl.appendChild(row);
  });
  pane.appendChild(fl);
  if (meta) pane.appendChild(el('p', 'hint', meta));
  const row = el('div', 'runrow');
  const go = el('button', 'primary', runLabel);
  go.disabled = state.files.length < 1;
  go.onclick = onRun;
  row.appendChild(go);
  pane.appendChild(row);
}

PANEL.merge = (pane) => {
  if (!state.files.length) { pane.appendChild(el('p', 'hint', 'Add two or more PDFs — drop them together or one at a time. You set the order before anything runs.')); return; }
  fileListUi(pane, `Merge ${state.files.length} file${state.files.length > 1 ? 's' : ''}`, async () => {
    const r = await runOp('merge', state.files.slice(), {});
    if (!r) return;
    const box = receiptBox(`merged.pdf — ${state.files.length} files, ${fmt(r.bytes.length)}`);
    addNotes(box, r.summary);
    box.appendChild(el('p', null, 'Pages were copied as they are — nothing was re-compressed on the way through. Anything that could not survive the merge is listed above, not dropped silently.'));
    addDownload(box, r.bytes, 'merged.pdf', 'Download merged PDF');
    $('#receipt').appendChild(box);
  }, 'Order is top-to-bottom. A file that would be damaged by merging is refused with the reason stated.');
};

PANEL['images-to-pdf'] = (pane) => {
  if (!state.files.length) { pane.appendChild(el('p', 'hint', 'Add JPEG or PNG images — drop several at once. They are embedded as they are, not re-compressed.')); return; }
  fileListUi(pane, `Make a PDF from ${state.files.length} image${state.files.length > 1 ? 's' : ''}`, async () => {
    const r = await runOp('images-to-pdf', state.files.slice(), {});
    if (!r) return;
    const box = receiptBox(`images.pdf — ${state.files.length} page${state.files.length > 1 ? 's' : ''}, ${fmt(r.bytes.length)}`);
    addNotes(box, r.summary);
    box.appendChild(el('p', null, 'Your images went in as they are — the same JPEG or PNG bytes, wrapped in pages. If you want it smaller, run it through Compress, where that trade is made openly.'));
    addDownload(box, r.bytes, 'images.pdf', 'Download PDF');
    $('#receipt').appendChild(box);
  });
};

const SEV = {
  critical: { label: 'Critical', cls: 'sev-critical' },
  high:     { label: 'High',     cls: 'sev-high' },
  info:     { label: 'Info',     cls: 'sev-info' },
  none:     { label: 'None',     cls: 'sev-none' },
};

PANEL.verify = (pane) => {
  if (!state.files.length) {
    pane.appendChild(el('p', 'hint', 'Drop one or more PDFs — several at once is the point. Each is inspected on this device; nothing is uploaded. Findings are sorted worst-first and point at the tool that removes them.'));
    return;
  }
  fileListUi(pane, `Verify ${state.files.length} file${state.files.length > 1 ? 's' : ''}`, async () => {
    const r = await runOp('verify', state.files.slice(), {});
    if (!r) return;
    renderVerifyLedger(r.summary);
  }, 'Presence, not absence: this reports the hidden data it finds. A file with none is “nothing found in the classes we check”, never a certificate that it is clean.');
};

function sevBadge(sev) {
  const s = SEV[sev] ?? SEV.none;
  return el('span', 'sevb ' + s.cls, s.label);
}

function fixCta(f) {
  if (f.fixAvailable) {
    const a = el('a', 'fixlink', `${escapeHtml(f.fixLabel)} →`);
    a.href = `${REL}${f.fix}/`;
    return a;
  }
  return el('span', 'fixsoon', `${escapeHtml(f.fixLabel)} — coming`);
}

function renderVerifyLedger(payload) {
  const { files, summary } = payload;
  const mount = $('#receipt');
  mount.innerHTML = '';

  const box = receiptBox('Verification ledger');
  box.appendChild(el('p', 'verd', escapeHtml(summary.headline)));

  const bySev = summary.bySeverity ?? {};
  if (bySev.critical || bySev.high || bySev.info) {
    const bar = el('div', 'vsevbar');
    for (const sName of ['critical', 'high', 'info']) {
      if (!bySev[sName]) continue;
      bar.appendChild(el('span', 'vseg ' + SEV[sName].cls,
        `<b>${bySev[sName]}</b> ${escapeHtml(SEV[sName].label.toLowerCase())} finding${bySev[sName] === 1 ? '' : 's'}`));
    }
    box.appendChild(bar);
  }

  const chips = el('div', 'vchips');
  const chip = (n, label, cls) => { const c = el('span', 'vchip ' + (cls || ''), `<b>${n}</b> ${escapeHtml(label)}`); chips.appendChild(c); };
  chip(summary.filesWithFindings, 'with findings', summary.filesWithFindings ? 'vchip-warn' : '');
  chip(summary.filesClean, 'nothing found');
  if (summary.filesEncrypted) chip(summary.filesEncrypted, 'encrypted');
  if (summary.filesFailed) chip(summary.filesFailed, 'unreadable');
  box.appendChild(chips);

  const bf = summary.byFix ?? {};
  if (bf.redact?.findings || bf.sanitize?.findings) {
    const route = el('div', 'routes');
    if (bf.redact?.findings) {
      const rr = el('div', 'route');
      rr.appendChild(el('span', 'sevb sev-critical', 'Remove in the page'));
      rr.appendChild(document.createTextNode(` ${bf.redact.findings} finding(s) across ${bf.redact.files} file(s) → `));
      const a = el('a', 'fixlink', 'Redact →'); a.href = `${REL}redact/`; rr.appendChild(a);
      route.appendChild(rr);
    }
    if (bf.sanitize?.findings) {
      const rr = el('div', 'route');
      rr.appendChild(el('span', 'sevb sev-high', 'Rebuild the file'));
      rr.appendChild(document.createTextNode(` ${bf.sanitize.findings} finding(s) across ${bf.sanitize.files} file(s) → `));
      if (bf.sanitize.available) {
        const a2 = el('a', 'fixlink', 'Sanitize →'); a2.href = `${REL}sanitize/`; rr.appendChild(a2);
      } else {
        rr.appendChild(el('span', 'fixsoon', 'Sanitize — coming'));
      }
      route.appendChild(rr);
    }
    box.appendChild(route);
  }
  if (summary.filesDeepSkipped) {
    box.appendChild(el('p', 'warnv', `${summary.filesDeepSkipped} file(s) were scanned without the deep reading engine — off-page, covered, and invisible text were NOT checked in those. That is an unknown, not a pass.`));
  }
  mount.appendChild(box);

  const order = { critical: 3, high: 2, info: 1, none: 0 };
  const sorted = files.slice().sort((a, b) =>
    (b.ok === false) - (a.ok === false) ||
    (order[b.worstSeverity] ?? 0) - (order[a.worstSeverity] ?? 0) ||
    (b.findingCount || 0) - (a.findingCount || 0));

  const list = el('div', 'vledger');
  for (const rec of sorted) {
    const card = el('div', 'vfile' + (rec.findingCount ? ' wc-' + (rec.worstSeverity || 'info') : ''));
    const head = el('div', 'vfhead');
    head.appendChild(el('span', 'vfname', escapeHtml(rec.name)));

    if (rec.ok === false) {
      head.appendChild(el('span', 'sevb sev-none', 'Unreadable'));
      card.appendChild(head);
      card.appendChild(el('p', 'vfnote', 'This file could not be parsed as a PDF: ' + escapeHtml(rec.error || 'unknown error') + '. It was skipped — the rest of the batch was not affected.'));
      list.appendChild(card); continue;
    }
    if (rec.encrypted) {
      head.appendChild(el('span', 'sevb sev-info', 'Encrypted'));
      card.appendChild(head);
      card.appendChild(el('p', 'vfnote', escapeHtml(rec.note || 'This document is encrypted; its contents are ciphertext, so an inspection would be guesswork. Decrypt it deliberately first, then verify the result.')));
      list.appendChild(card); continue;
    }

    const meta = el('span', 'vfmeta', `${rec.pages ?? '?'} page${rec.pages === 1 ? '' : 's'}`);
    head.appendChild(meta);
    if (rec.findingCount) head.appendChild(sevBadge(rec.worstSeverity));
    else head.appendChild(el('span', 'sevb sev-none', 'Nothing found'));
    card.appendChild(head);

    if (rec.signatures?.count) {
      card.appendChild(el('p', 'warnv', `${rec.signatures.count} digital signature(s) present — removing hidden data would void them.`));
    }

    if (!rec.findingCount) {
      card.appendChild(el('p', 'vfnote', rec.deepChecked
        ? 'Nothing found in the classes checked. Presence, not absence — this is not a certificate that the file is clean.'
        : 'Nothing found in the structural classes. The deep text scan did not run for this file, so covered/off-page/invisible text is UNCHECKED, not clean.'));
    } else {
      const det = el('details', 'vfdet');
      det.open = sorted.length <= 4 || rec.worstSeverity === 'critical';
      det.appendChild(el('summary', 'vfsum',
        `${rec.findingCount} finding${rec.findingCount === 1 ? '' : 's'} — details`));
      const tbl = el('table', 'vftbl');
      tbl.appendChild(el('tr', null, '<th>severity</th><th>what’s recoverable</th><th>count</th><th>fix</th>'));
      for (const f of rec.findings) {
        const tr = el('tr');
        const tdS = el('td'); tdS.appendChild(sevBadge(f.severity)); tr.appendChild(tdS);
        const tdL = el('td');
        tdL.appendChild(el('span', 'fclass', escapeHtml(f.headline || f.label)));
        if (f.note) tdL.appendChild(el('div', 'fnote', escapeHtml(f.note)));
        tr.appendChild(tdL);
        tr.appendChild(el('td', 'fcount', String(f.count || '·')));
        const tdF = el('td'); tdF.appendChild(fixCta(f)); tr.appendChild(tdF);
        tbl.appendChild(tr);
      }
      det.appendChild(tbl);
      card.appendChild(det);
    }
    list.appendChild(card);
  }
  mount.appendChild(list);
}

function parsePages(text, label = 'pages') {
  const out = [];
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) out.push(i - 1); }
    else if (/^\d+$/.test(part)) out.push(+part - 1);
    else throw new Error(`could not read ${label} "${part}" — use forms like 2 or 5-7`);
  }
  if (!out.length) throw new Error(`no ${label} given`);
  return out;
}

function simplePanel(pane, { intro, controls = [], runLabel, buildOpts, op, suffix, receipt }) {
  if (!state.file) { pane.appendChild(el('p', 'hint', intro)); return; }
  const opt = el('div');
  for (const c of controls) opt.appendChild(c);
  pane.appendChild(opt);
  const row = el('div', 'runrow');
  const go = el('button', 'primary', runLabel);
  go.onclick = async () => {
    let opts;
    try { opts = buildOpts(); } catch (e) { toast(e.message); return; }
    const r = await runOp(op, state.file.bytes, opts);
    if (!r) return;
    const box = receipt?.(r, opts) ?? (() => {
      const b = receiptBox('Done');
      addNotes(b, r.summary);
      if (r.bytes) addDownload(b, r.bytes, outName(state.file.name, suffix));
      return b;
    })();
    $('#receipt').appendChild(box);
  };
  row.appendChild(go);
  pane.appendChild(row);
}

const optrow = (labelHtml, input) => {
  const d = el('div', 'optrow');
  const l = el('label', null, labelHtml);
  if (input) l.appendChild(input);
  d.appendChild(l);
  return d;
};
const textInput = (id, placeholder, size = 24) => {
  const i = el('input'); i.type = 'text'; i.id = id; i.placeholder = placeholder; i.size = size;
  i.style.marginInlineStart = '8px';
  return i;
};
const selectInput = (id, options) => {
  const s = el('select'); s.id = id;
  for (const [v, label] of options) { const o = el('option', null, label); o.value = v; s.appendChild(o); }
  s.style.marginInlineStart = '8px';
  return s;
};

PANEL.split = (pane) => simplePanel(pane, {
  intro: 'Drop the PDF you want to cut into pieces.',
  controls: [
    optrow('Page ranges (one output per range): ', textInput('ranges', 'e.g. 1-3, 4-10')),
    optrow('…or cut every ', (() => { const i = textInput('every', 'N', 4); return i; })()),
  ],
  runLabel: 'Split',
  op: 'split',
  buildOpts: () => {
    const every = $('#every').value.trim();
    if (every) {
      if (!/^\d+$/.test(every) || +every < 1) throw new Error('“every N pages” needs a whole number');
      return { every: +every };
    }
    const ranges = parsePages($('#ranges').value, 'ranges');
    const rangeText = $('#ranges').value;
    const parsed = rangeText.split(',').map((s) => s.trim()).filter(Boolean).map((part) => {
      const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) return [+m[1] - 1, +m[2] - 1];
      if (/^\d+$/.test(part)) return [+part - 1, +part - 1];
      throw new Error(`could not read range "${part}"`);
    });
    if (!parsed.length) throw new Error('give ranges, or a chunk size');
    void ranges;
    return { ranges: parsed };
  },
  receipt: (r) => {
    const box = receiptBox(`Split into ${r.files?.length ?? 0} files`);
    addNotes(box, r.summary);
    const row = el('div', 'dlrow');
    for (const f of r.files ?? []) {
      const b = el('button', 'primary', `Download ${escapeHtml(f.name ?? 'part.pdf')} (${fmt(f.bytes.length)})`);
      b.onclick = () => download(f.bytes, f.name ?? 'part.pdf');
      row.appendChild(b);
    }
    box.appendChild(row);
    return box;
  },
});

PANEL.extract = (pane) => simplePanel(pane, {
  intro: 'Drop a PDF, then name the pages you want pulled into a new file.',
  controls: [optrow('Pages to extract: ', textInput('pages', 'e.g. 2, 5-7'))],
  runLabel: 'Extract pages',
  op: 'extract',
  suffix: 'extracted',
  buildOpts: () => ({ pages: parsePages($('#pages').value) }),
});

PANEL.delete = (pane) => simplePanel(pane, {
  intro: 'Drop a PDF, then name the pages that go. Everything else stays exactly as it was.',
  controls: [optrow('Pages to delete: ', textInput('pages', 'e.g. 3, 9-10'))],
  runLabel: 'Delete pages',
  op: 'delete',
  suffix: 'pages-removed',
  buildOpts: () => ({ pages: parsePages($('#pages').value) }),
});

PANEL.reorder = (pane) => simplePanel(pane, {
  intro: 'Drop a PDF, then give the complete new order.',
  controls: [
    optrow('New order (every page exactly once): ', textInput('order', 'e.g. 1,3,5,2,4,6', 30)),
    el('p', 'hint', 'The classic: a duplex scan that came out all-fronts-then-all-backs. An incomplete or repeated order is refused with the reason.'),
  ],
  runLabel: 'Reorder',
  op: 'reorder',
  suffix: 'reordered',
  buildOpts: () => ({ order: parsePages($('#order').value, 'order') }),
});

PANEL.rotate = (pane) => simplePanel(pane, {
  intro: 'Drop a PDF. Rotate everything, or name pages.',
  controls: [
    optrow('Rotate all pages by ', selectInput('by', [['90', '90° right'], ['180', '180°'], ['-90', '90° left']])),
    optrow('…or per page: ', textInput('turns', 'e.g. 7:90, 9:180', 26)),
  ],
  runLabel: 'Rotate',
  op: 'rotate',
  suffix: 'rotated',
  buildOpts: () => {
    const t = $('#turns').value.trim();
    if (!t) return { by: +$('#by').value };
    const turns = t.split(',').map((s) => s.trim()).filter(Boolean).map((pair) => {
      const m = pair.match(/^(\d+)\s*:\s*(-?\d+)$/);
      if (!m) throw new Error(`could not read "${pair}" — use page:degrees, e.g. 7:90`);
      return { page: +m[1] - 1, by: +m[2] };
    });
    return { turns };
  },
});

PANEL['pdf-to-images'] = (pane) => simplePanel(pane, {
  intro: 'Drop a PDF; every page becomes an image at the resolution you choose.',
  controls: [
    optrow('Resolution: ', selectInput('dpi', [['96', '96 dpi — screens'], ['150', '150 dpi — default'], ['300', '300 dpi — print-ish, big files']])),
  ],
  runLabel: 'Render pages to images',
  op: 'pdf-to-images',
  buildOpts: () => ({ dpi: +$('#dpi').value }),
  receipt: (r) => {
    const box = receiptBox(`${r.files?.length ?? 0} page image${(r.files?.length ?? 0) === 1 ? '' : 's'}`);
    addNotes(box, r.summary);
    box.appendChild(el('p', 'hint', 'An image is pixels: no selectable text, no links. If you need the text, “Get the text out” reads it directly.'));
    const row = el('div', 'dlrow');
    for (const f of r.files ?? []) {
      const b = el('button', 'primary', `Download ${escapeHtml(f.name ?? 'page')} (${fmt(f.bytes.length)})`);
      b.onclick = () => download(f.bytes, f.name ?? 'page.jpg', 'image/jpeg');
      row.appendChild(b);
    }
    box.appendChild(row);
    return box;
  },
});

PANEL.text = (pane) => simplePanel(pane, {
  intro: 'Drop a PDF; you get its real text. Scanned pages are named as scans, not returned as silence.',
  controls: [],
  runLabel: 'Get the text out',
  op: 'pdf-to-text',
  buildOpts: () => ({}),
  receipt: (r) => {
    const box = receiptBox('Text extracted');
    addNotes(box, r.summary);
    const pre = el('pre', null, escapeHtml(r.text ?? ''));
    pre.style.cssText = 'max-height:320px;overflow:auto;background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px;font-size:12.5px;white-space:pre-wrap';
    box.appendChild(pre);
    const row = el('div', 'dlrow');
    const dl = el('button', 'primary', 'Download .txt');
    dl.onclick = () => download(new TextEncoder().encode(r.text ?? ''), outName(state.file.name, 'text', 'txt'), 'text/plain');
    const cp = el('button', null, 'Copy text');
    cp.onclick = async () => { await navigator.clipboard.writeText(r.text ?? ''); toast('Copied.'); };
    row.appendChild(dl); row.appendChild(cp);
    box.appendChild(row);
    return box;
  },
});

const sg = { sig: null, placements: [], doc: null, page: 0, pages: 0, ps: null };

PANEL.sign = (pane) => {
  const d = el('div', 'disclaim');
  d.innerHTML = '<strong>This places a picture of your signature.</strong> It is not a digital signature — no certificate, no identity, no tamper-proofing; anyone could move or copy it. It’s exactly what you need to sign a form and email it back without printing — and nothing more.';
  pane.appendChild(d);

  if (!sg.sig) {
    pane.appendChild(el('p', null, 'Draw your signature (finger or mouse):'));
    const pad = el('canvas', 'sigpad');
    pad.width = 480; pad.height = 160;
    pad.style.width = 'min(480px, 100%)';
    const ctx = pad.getContext('2d');
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a1030';
    let drawing = false, drew = false;
    const pos = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * (pad.width / r.width), (e.clientY - r.top) * (pad.height / r.height)]; };
    pad.addEventListener('pointerdown', (e) => { drawing = true; drew = true; pad.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); });
    pad.addEventListener('pointermove', (e) => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); });
    pad.addEventListener('pointerup', () => { drawing = false; });
    pane.appendChild(pad);
    const row = el('div', 'runrow');
    const use = el('button', 'primary', 'Use this signature');
    use.onclick = () => {
      if (!drew) { toast('Draw something first.'); return; }
      pad.toBlob(async (blob) => { sg.sig = new Uint8Array(await blob.arrayBuffer()); renderPanel(); }, 'image/png');
    };
    const clr = el('button', null, 'Clear');
    clr.onclick = () => { ctx.clearRect(0, 0, pad.width, pad.height); drew = false; };
    row.appendChild(use); row.appendChild(clr);
    pane.appendChild(row);
    return;
  }

  if (!state.file) { pane.appendChild(el('p', 'hint', 'Signature saved. Now drop the PDF form to place it on.')); return; }

  pane.appendChild(el('p', null, 'Click where the signature goes. Each click places one copy at the width below.'));
  const wrow = el('div', 'optrow');
  wrow.innerHTML = 'Signature width: <input type="range" id="sigw" min="10" max="60" value="28"/> <span id="sigwv">28%</span> of page width';
  pane.appendChild(wrow);

  const pv = el('div', 'pageview'); pv.id = 'signview';
  pane.appendChild(pv);
  const nav = el('div', 'runrow'); nav.id = 'signnav';
  pane.appendChild(nav);
  const ml = el('div', 'marklist'); ml.id = 'signlist';
  pane.appendChild(ml);
  const row = el('div', 'runrow'); row.id = 'signrun';
  pane.appendChild(row);

  initSign().catch((e) => pane.appendChild(el('div', 'errbar', escapeHtml(e.message))));
};

async function initSign() {
  await getPdfjs();
  sg.doc?.destroy?.();
  sg.doc = await openDoc(state.file.bytes);
  sg.pages = sg.doc.numPages;
  $('#sigw').addEventListener('input', () => { $('#sigwv').textContent = $('#sigw').value + '%'; });
  await drawSignPage();
}

async function drawSignPage() {
  const pv = $('#signview'); if (!pv) return;
  pv.innerHTML = '';
  const page = await sg.doc.getPage(sg.page + 1);
  const vp1 = page.getViewport({ scale: 1 });
  const cssW = Math.min(pv.clientWidth || 640, 900);
  const scale = cssW / vp1.width;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const vp = page.getViewport({ scale: scale * ratio });
  const canvas = el('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  canvas.style.width = cssW + 'px';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  pv.style.position = 'relative';
  pv.appendChild(canvas);
  sg.ps = { viewW: vp1.width, viewH: vp1.height, cssW };

  const SIG_ASPECT = 160 / 480;
  for (const p of sg.placements.filter((p) => p.page === sg.page)) {
    const dpx = el('div');
    const f = 100 / sg.ps.viewW, fy = 100 / sg.ps.viewH;
    const hPt = p.rect.width * SIG_ASPECT;
    dpx.style.cssText = `position:absolute;border:1.5px dashed var(--gem);left:${p.rect.x * f}%;top:${(sg.ps.viewH - p.rect.y - hPt) * fy}%;width:${p.rect.width * f}%;height:${hPt * fy}%;pointer-events:none`;
    pv.appendChild(dpx);
  }

  pv.onclick = (e) => {
    const r = pv.getBoundingClientRect();
    const toView = (px) => px * (sg.ps.viewW / sg.ps.cssW);
    const wPct = +$('#sigw').value / 100;
    const width = sg.ps.viewW * wPct;
    const hPt = width * SIG_ASPECT;
    const x = Math.max(0, toView(e.clientX - r.left) - width / 2);
    const y = Math.max(0, sg.ps.viewH - toView(e.clientY - r.top) - hPt / 2);
    sg.placements.push({ page: sg.page, image: sg.sig, rect: { x, y, width }, space: 'view' });
    drawSignPage(); renderSignList();
  };

  const nav = $('#signnav'); nav.innerHTML = '';
  if (sg.pages > 1) {
    const prev = el('button', null, '← page'); prev.disabled = sg.page === 0;
    prev.onclick = () => { sg.page--; drawSignPage(); };
    const label = el('span', 'hint', ` page ${sg.page + 1} of ${sg.pages} `);
    const next = el('button', null, 'page →'); next.disabled = sg.page === sg.pages - 1;
    next.onclick = () => { sg.page++; drawSignPage(); };
    nav.appendChild(prev); nav.appendChild(label); nav.appendChild(next);
  }
  renderSignList();
}

function renderSignList() {
  const ml = $('#signlist'); if (!ml) return;
  ml.innerHTML = '';
  sg.placements.forEach((p, i) => {
    const mi = el('div', 'mi');
    mi.appendChild(el('span', null, `p.${p.page + 1} — signature`));
    const x = el('button', null, 'remove');
    x.onclick = () => { sg.placements.splice(i, 1); drawSignPage(); };
    mi.appendChild(x);
    ml.appendChild(mi);
  });
  const row = $('#signrun'); row.innerHTML = '';
  const go = el('button', 'primary', `Place ${sg.placements.length} signature${sg.placements.length === 1 ? '' : 's'} and save`);
  go.disabled = !sg.placements.length;
  go.onclick = async () => {
    const r = await runOp('signature', state.file.bytes, { placements: sg.placements });
    if (!r) return;
    const box = receiptBox('Signed — a picture of your signature, placed');
    addNotes(box, r.summary);
    box.appendChild(el('p', 'warnv', 'Reminder of what this is: ordinary page content, like ink after a photocopier — no certificate, no tamper-detection.'));
    addDownload(box, r.bytes, outName(state.file.name, 'signed'), 'Download signed PDF');
    $('#receipt').appendChild(box);
  };
  const redo = el('button', null, 'Draw a different signature');
  redo.onclick = () => { sg.sig = null; sg.placements = []; renderPanel(); };
  row.appendChild(go); row.appendChild(redo);
}

PANEL.watermark = (pane) => simplePanel(pane, {
  intro: 'Drop a PDF, then choose your stamp. Said before you stamp: a watermark is a notice, not protection.',
  controls: [
    optrow('Text: ', textInput('wmtext', 'e.g. DRAFT — do not cite', 28)),
    optrow('Position: ', selectInput('wmpos', [['diagonal', 'Diagonal across the page'], ['center', 'Flat, centered'], ['top-center', 'Top center'], ['bottom-center', 'Bottom center'], ['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']])),
    optrow('Opacity: ', selectInput('wmop', [['0.12', 'Faint'], ['0.18', 'Standard'], ['0.3', 'Strong']])),
    el('p', 'hint', 'Latin text only for now — the built-in font cannot encode other scripts, and stamping garbage is refused loudly rather than done badly.'),
  ],
  runLabel: 'Watermark',
  op: 'watermark',
  suffix: 'watermarked',
  buildOpts: () => {
    const text = $('#wmtext').value.trim();
    if (!text) throw new Error('watermark text is empty');
    return { text, position: $('#wmpos').value, opacity: +$('#wmop').value };
  },
});

PANEL['page-numbers'] = (pane) => simplePanel(pane, {
  intro: 'Drop a PDF; numbers go where you say, starting where you say.',
  controls: [
    optrow('Position: ', selectInput('pnpos', [['bottom-center', 'Bottom center'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right'], ['top-center', 'Top center'], ['top-left', 'Top left'], ['top-right', 'Top right']])),
    optrow('Format: ', selectInput('pnfmt', [['{n}', '7'], ['Page {n}', 'Page 7'], ['{n} / {N}', '7 / 42'], ['Page {n} of {N}', 'Page 7 of 42']])),
    optrow('Start numbering at: ', textInput('pnstart', '1', 4)),
    optrow('First page to stamp (skip covers): ', textInput('pnfrom', '1', 4)),
  ],
  runLabel: 'Add page numbers',
  op: 'page-numbers',
  suffix: 'numbered',
  buildOpts: () => ({
    position: $('#pnpos').value,
    format: $('#pnfmt').value,
    start: +($('#pnstart').value || 1),
    from: Math.max(0, +($('#pnfrom').value || 1) - 1),
  }),
});

PANEL.booklet = (pane) => simplePanel(pane, {
  intro: 'Drop a PDF. Several pages per sheet for handouts, or fold-ready booklet order.',
  controls: [
    optrow('Layout: ', selectInput('bkmode', [['booklet', 'Booklet — fold-in-half order, 2-up'], ['2', '2 pages per sheet'], ['4', '4 pages per sheet']])),
    optrow('Sheet: ', selectInput('bksheet', [['a4', 'A4'], ['letter', 'Letter']])),
    el('p', 'hint', 'Imposed pages keep their visible content and text; links, annotations and form fields do not carry onto an imposed sheet — the receipt says so too.'),
  ],
  runLabel: 'Lay out',
  op: 'nup',
  suffix: 'imposed',
  buildOpts: () => {
    const mode = $('#bkmode').value;
    if (mode === 'booklet') return { __op: 'booklet', sheet: $('#bksheet').value };
    return { __op: 'nup', per: +mode, sheet: $('#bksheet').value };
  },
  receipt: undefined,
});

PANEL.flatten = (pane) => simplePanel(pane, {
  intro: 'Drop a filled form. Fields become ordinary page content — visible everywhere, editable nowhere.',
  controls: [el('p', 'hint', 'A file with no form is declared a no-op and returned unchanged. An XFA form is refused with the reason — flattening its placeholder pages would silently destroy the real form.')],
  runLabel: 'Flatten',
  op: 'flatten',
  suffix: 'flattened',
  buildOpts: () => ({}),
});

function renderPanel() {
  const pane = $('#oppanel');
  if (!pane) return;
  pane.innerHTML = '';
  const box = el('div', 'pane');
  pane.appendChild(box);
  const build = PANEL[VERB];
  if (build) build(box);
  else box.appendChild(el('p', 'hint', 'This tool’s interactive surface is not wired yet.'));
}

function init() {
  if (!VERB) return;
  const drop = $('#drop');
  const input = $('#fileinput');
  if (!drop) return;
  if (MULTI.has(VERB)) input.multiple = true;
  input.accept = ACCEPT[VERB] ?? 'application/pdf,.pdf';

  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('hot'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('hot'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('hot'); onFiles(e.dataTransfer.files); });
  input.addEventListener('change', () => { onFiles(input.files); input.value = ''; });
  $('#removefile').addEventListener('click', () => {
    state.file = null; state.files = [];
    rd.marks.clear(); rd.committed = null; sg.placements = [];
    $('#filecard').hidden = true; $('#receipt').innerHTML = '';
    renderPanel();
  });
  renderPanel();
}

init();

