'use strict';
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- ayarlar ---------- */
const PRESETS = [
  { id: 'pencil', name: 'Kurşun kalem', sub: 'Gri, silik kalem izleri koyu çizgi olur', v: { sens: 70, soft: 35, speck: 3, thick: 0, smooth: 1 } },
  { id: 'pen', name: 'Tükenmez / mürekkep', sub: 'Zaten koyu çizgiler, temiz kenar', v: { sens: 45, soft: 15, speck: 4, thick: 0, smooth: 1 } },
  { id: 'faint', name: 'Çok silik çizim', sub: 'En hafif izleri bile yakalar', v: { sens: 90, soft: 40, speck: 5, thick: 0.5, smooth: 1 } }
];
const SLIDERS = [
  { k: 'sens', name: 'Çizgi hassasiyeti', min: 0, max: 100, step: 1, fmt: (v) => v + '%', hint: 'Yüksek = daha silik çizgileri de yakalar' },
  { k: 'soft', name: 'Kenar yumuşaklığı', min: 0, max: 100, step: 1, fmt: (v) => v + '%' },
  { k: 'speck', name: 'Leke temizleme', min: 0, max: 40, step: 1, fmt: (v) => (v === 0 ? 'Kapalı' : v + ' px') },
  { k: 'thick', name: 'Çizgi kalınlığı', min: -2, max: 3, step: 0.5, fmt: (v) => (v > 0 ? '+' : '') + v },
  { k: 'smooth', name: 'Pürüzsüzlük', min: 0, max: 2, step: 1, fmt: (v) => ['Kapalı', 'Hafif', 'Güçlü'][v] }
];
const P = { preset: 'pencil', ...PRESETS[0].v, out: 1, obg: 'transparent', vbg: 't' };
const MAXSRC = 8000, MAXPREV = 1600, MAXOUT = 5000;

/* ---------- görüntü işleme ---------- */
function maxFilt(s, w, h, r) {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, s[y * w + k]); t[y * w + x] = m; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, t[k * w + x]); o[y * w + x] = m; }
  return o;
}
function boxBlur(s, w, h, r, passes) {
  let a = s;
  for (let p = 0; p < passes; p++) {
    const t = new Float32Array(w * h), o = new Float32Array(w * h), n = 2 * r + 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let sum = 0; for (let k = -r; k <= r; k++) sum += a[y * w + clamp(x + k, 0, w - 1)]; t[y * w + x] = sum / n; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let sum = 0; for (let k = -r; k <= r; k++) sum += t[clamp(y + k, 0, h - 1) * w + x]; o[y * w + x] = sum / n; }
    a = o;
  }
  return a;
}
// gri görüntüden "koyuluk" haritası: 0 = kağıt, 1 = çok koyu. Işık/gölge farkını kağıt tahminiyle siler.
function darkMap(g, w, h) {
  const f = Math.max(1, Math.round(Math.max(w, h) / 320));
  const sw = Math.ceil(w / f), sh = Math.ceil(h / f);
  let s = new Float32Array(sw * sh); const c = new Float32Array(sw * sh);
  for (let y = 0; y < h; y++) { const row = ((y / f) | 0) * sw; for (let x = 0; x < w; x++) { const i = row + ((x / f) | 0); s[i] += g[y * w + x]; c[i]++; } }
  for (let i = 0; i < s.length; i++) s[i] /= c[i];
  s = boxBlur(maxFilt(s, sw, sh, 6), sw, sh, 5, 3);
  const d = new Float32Array(w * h);
  const x0 = new Int32Array(w), x1 = new Int32Array(w), fx = new Float32Array(w);
  for (let x = 0; x < w; x++) { const u = clamp((x + 0.5) / f - 0.5, 0, sw - 1); x0[x] = Math.floor(u); x1[x] = Math.min(sw - 1, x0[x] + 1); fx[x] = u - x0[x]; }
  for (let y = 0; y < h; y++) {
    const v = clamp((y + 0.5) / f - 0.5, 0, sh - 1), y0 = Math.floor(v), y1 = Math.min(sh - 1, y0 + 1), fy = v - y0;
    for (let x = 0; x < w; x++) {
      const a = s[y0 * sw + x0[x]] * (1 - fx[x]) + s[y0 * sw + x1[x]] * fx[x];
      const b = s[y1 * sw + x0[x]] * (1 - fx[x]) + s[y1 * sw + x1[x]] * fx[x];
      const bg = Math.max(0.15, a * (1 - fy) + b * fy), n = g[y * w + x] / bg;
      d[y * w + x] = n >= 1 ? 0 : 1 - n;
    }
  }
  return d;
}
function despeckle(a, w, h, minArea) {
  const n = w * h, seen = new Uint8Array(n), stack = new Int32Array(n), comp = new Int32Array(n);
  for (let i0 = 0; i0 < n; i0++) {
    if (seen[i0] || a[i0] <= 0.08) continue;
    let sp = 0, cn = 0; stack[sp++] = i0; seen[i0] = 1;
    while (sp) {
      const i = stack[--sp]; comp[cn++] = i;
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const j = yy * w + xx; if (!seen[j] && a[j] > 0.08) { seen[j] = 1; stack[sp++] = j; } } }
    }
    if (cn < minArea) for (let k = 0; k < cn; k++) a[comp[k]] = 0;
  }
}
function morph(a, w, h, grow) {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let v = a[i];
    const l = a[x > 0 ? i - 1 : i], r = a[x < w - 1 ? i + 1 : i], u = a[y > 0 ? i - w : i], d = a[y < h - 1 ? i + w : i];
    o[i] = grow ? Math.max(v, l, r, u, d) : Math.min(v, l, r, u, d);
  }
  return o;
}
function blur3(a, w, h) {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; t[i] = (a[x > 0 ? i - 1 : i] + 2 * a[i] + a[x < w - 1 ? i + 1 : i]) / 4; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; o[i] = (t[y > 0 ? i - w : i] + 2 * t[i] + t[y < h - 1 ? i + w : i]) / 4; }
  return o;
}
function makeAlpha(d, w, h, p) {
  const t = 0.34 - 0.30 * p.sens / 100, k = 0.02 + 0.28 * p.soft / 100, n = w * h;
  let a = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (d[i] - t) / k; a[i] = x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); }
  if (p.speck > 0) { const sc = Math.max(0.5, Math.max(w, h) / MAXPREV); despeckle(a, w, h, p.speck * sc * sc); }
  const steps = Math.abs(p.thick), whole = Math.floor(steps), frac = steps - whole;
  for (let s = 0; s < whole; s++) a = morph(a, w, h, p.thick > 0);
  if (frac > 0) { const m = morph(a, w, h, p.thick > 0); for (let i = 0; i < n; i++) a[i] += (m[i] - a[i]) * frac; }
  for (let s = 0; s < p.smooth; s++) { const b = blur3(a, w, h); for (let i = 0; i < n; i++) a[i] = Math.min(1, (a[i] * 0.5 + b[i] * 0.5) * 1.25); }
  return a;
}
function toImageData(a, w, h, white) {
  const img = new ImageData(w, h), px = img.data;
  for (let i = 0, j = 0; i < a.length; i++, j += 4) {
    const v = Math.round(clamp(a[i], 0, 1) * 255);
    if (white) { const c = 255 - v; px[j] = px[j + 1] = px[j + 2] = c; px[j + 3] = 255; } else px[j + 3] = v;
  }
  return img;
}

/* ---------- kaynak ve çalışma verisi ---------- */
let src = null, srcName = 'cizim', work = null;
function grayOf(canvas) {
  const w = canvas.width, h = canvas.height, d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) / 255;
  return g;
}
function scaled(scale) {
  const w = Math.max(1, Math.round(src.width * scale)), h = Math.max(1, Math.round(src.height * scale));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h);
  return c;
}
function buildWork(scale) {
  const c = scaled(scale), g = grayOf(c);
  return { c, w: c.width, h: c.height, d: darkMap(g, c.width, c.height) };
}
function prevScale() { return Math.min(1, MAXPREV / Math.max(src.width, src.height)); }

/* ---------- ekran ---------- */
const cv = $('cv'), cvo = $('cvo'), wrap = $('wrap'), view = $('view');
let Z = { s: 1, x: 0, y: 0 };
function applyZ() { wrap.style.transform = `translate(${Z.x}px,${Z.y}px) scale(${Z.s})`; }
function fitView() {
  if (!work) return;
  const r = view.getBoundingClientRect(), pad = 28;
  Z.s = Math.min((r.width - pad * 2) / work.w, (r.height - pad * 2) / work.h);
  Z.x = (r.width - work.w * Z.s) / 2; Z.y = (r.height - work.h * Z.s) / 2; applyZ();
}
function render() {
  if (!work) return;
  const a = makeAlpha(work.d, work.w, work.h, P);
  cv.width = work.w; cv.height = work.h; cv.getContext('2d').putImageData(toImageData(a, work.w, work.h, false), 0, 0);
  $('info').textContent = `${src.width}×${src.height} px kaynak · önizleme ${work.w}×${work.h}`;
}
let pend = false;
function schedule() { if (pend) return; pend = true; setTimeout(() => { pend = false; render(); }, 30); }
function setVbg(v) { wrap.className = 'bg-' + v; document.querySelectorAll('#vbg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); P.vbg = v; }

function showImage() {
  $('empty').hidden = true; view.hidden = false; $('bar').hidden = false; $('save').disabled = false;
  work = buildWork(prevScale());
  wrap.style.width = work.w + 'px'; wrap.style.height = work.h + 'px';
  cvo.width = work.w; cvo.height = work.h; cvo.getContext('2d').drawImage(work.c, 0, 0);
  setVbg(P.vbg); fitView(); render();
}
async function loadBlob(blob, name) {
  try {
    const bm = await createImageBitmap(blob);
    const k = Math.min(1, MAXSRC / Math.max(bm.width, bm.height));
    const c = document.createElement('canvas'); c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, c.width, c.height);
    src = c; srcName = (name || 'cizim').replace(/\.[^.]+$/, '') || 'cizim';
    showImage();
  } catch (e) { toast('Bu resim açılamadı'); }
}
function rotate() {
  if (!src) return;
  const c = document.createElement('canvas'); c.width = src.height; c.height = src.width;
  const x = c.getContext('2d'); x.translate(c.width, 0); x.rotate(Math.PI / 2); x.drawImage(src, 0, 0); src = c; showImage();
}

/* ---------- kaydet ---------- */
async function save() {
  if (!src) return;
  const btn = $('save'); btn.disabled = true; toast('Hazırlanıyor…', 60000);
  await new Promise((r) => setTimeout(r, 40));
  try {
    const scale = Math.min(P.out, MAXOUT / Math.max(src.width, src.height));
    const W = buildWork(scale), a = makeAlpha(W.d, W.w, W.h, P);
    const c = document.createElement('canvas'); c.width = W.w; c.height = W.h;
    c.getContext('2d').putImageData(toImageData(a, W.w, W.h, P.obg === 'white'), 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const res = await aster.saveFile({ name: srcName + '-cizgi.png', bytes });
    if (res && res.error) toast('Kaydedilemedi: ' + res.error); else if (res && res.path) toast('Kaydedildi ✓ ' + W.w + '×' + W.h); else hideToast();
  } catch (e) { toast('Kaydedilemedi (resim çok büyük olabilir, boyutu küçült)'); }
  btn.disabled = false;
}

/* ---------- arayüz ---------- */
let tt;
function toast(m, ms = 2600) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), ms); }
function hideToast() { clearTimeout(tt); $('toast').hidden = true; }
function persist() { try { localStorage.setItem('ink-cfg', JSON.stringify(P)); } catch {} }
function renderPresets() {
  $('presets').innerHTML = '';
  for (const p of PRESETS) {
    const b = document.createElement('button'); b.className = 'pc' + (P.preset === p.id ? ' on' : '');
    b.innerHTML = `<b>${p.name}</b><small>${p.sub}</small>`;
    b.onclick = () => { Object.assign(P, p.v, { preset: p.id }); persist(); renderPresets(); renderSliders(); schedule(); };
    $('presets').appendChild(b);
  }
}
function renderSliders() {
  $('sliders').innerHTML = '';
  for (const s of SLIDERS) {
    const d = document.createElement('div'); d.className = 'sl';
    d.innerHTML = `<label>${s.name} <b></b></label><input type="range" min="${s.min}" max="${s.max}" step="${s.step}">`;
    const inp = d.querySelector('input'), b = d.querySelector('b'); inp.value = P[s.k]; b.textContent = s.fmt(P[s.k]);
    if (s.hint) d.title = s.hint;
    inp.oninput = () => { P[s.k] = +inp.value; P.preset = ''; b.textContent = s.fmt(P[s.k]); persist(); document.querySelectorAll('.pc').forEach((x) => x.classList.remove('on')); schedule(); };
    $('sliders').appendChild(d);
  }
}
function seg(id, key, cast) {
  document.querySelectorAll('#' + id + ' button').forEach((b) => {
    b.classList.toggle('on', String(P[key]) === b.dataset.v);
    b.onclick = () => { P[key] = cast ? cast(b.dataset.v) : b.dataset.v; document.querySelectorAll('#' + id + ' button').forEach((x) => x.classList.toggle('on', x === b)); persist(); };
  });
}
function help() {
  $('card').innerHTML = `<h2>Nasıl kullanılır?</h2>
    <ol><li><b>Fotoğrafını çek.</b> Çizimi düz tut, ışığı eşit al, kağıt kadrajı doldursun. Gölge olursa sorun değil, uygulama düzeltir.</li>
    <li><b>Resmi ekle.</b> Sürükle-bırak, "Resim seç" ya da Ctrl+V.</li>
    <li><b>Çizim tipini seç</b>, sonra çizgiler eksikse <b>hassasiyeti</b> artır, kağıttan leke geliyorsa <b>leke temizlemeyi</b> artır.</li>
    <li><b>PNG kaydet.</b> Şeffaf PNG'yi Ibis Paint'e çizgi katmanı olarak ekle, altına boya.</li></ol>
    <p>Uygulama sadece siyah çizgileri çıkarır, renklendirmez. Resmin gönderilmez, her şey bilgisayarında işlenir.</p>
    <div class="row"><button class="pill" id="cl">Tamam</button></div>`;
  $('modal').hidden = false; $('cl').onclick = () => ($('modal').hidden = true);
}
$('modal').onclick = (e) => { if (e.target.id === 'modal') $('modal').hidden = true; };
const THEMES = [['dark', 'Koyu'], ['light', 'Açık'], ['glow', 'Parıltı']];
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('ink-theme', t); } catch {}
  window.aster && aster.setTheme(t === 'light' ? 'light' : 'dark');
  $('theme').title = 'Tema: ' + THEMES.find((x) => x[0] === t)[1];
}
$('theme').onclick = () => { const i = THEMES.findIndex((x) => x[0] === document.documentElement.dataset.theme); setTheme(THEMES[(i + 1) % 3][0]); };

const openPick = () => $('file').click();
$('open').onclick = $('open2').onclick = $('mopen').onclick = openPick;
$('mhelp').onclick = help; $('rot').onclick = rotate; $('save').onclick = save; $('fit').onclick = fitView;
$('file').onchange = (e) => { const f = e.target.files[0]; if (f) loadBlob(f, f.name); e.target.value = ''; };
document.querySelectorAll('#vbg button').forEach((b) => (b.onclick = () => setVbg(b.dataset.v)));
const showOrig = (on) => { cvo.hidden = !on; cv.style.visibility = on ? 'hidden' : 'visible'; };
$('cmp').onpointerdown = () => showOrig(true);
window.addEventListener('pointerup', () => showOrig(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('modal').hidden = true; if (e.key.toLowerCase() === 'o' && src && !e.repeat) showOrig(true); });
document.addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 'o') showOrig(false); });

// sürükle-bırak, yapıştır
const stage = $('stage');
['dragenter', 'dragover'].forEach((ev) => stage.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => stage.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.remove('drag'); }));
stage.addEventListener('drop', (e) => { const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/')); if (f) loadBlob(f, f.name); });
document.addEventListener('paste', (e) => { const it = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith('image/')); if (it) loadBlob(it.getAsFile(), 'yapistirilan'); });

// yakınlaştırma ve kaydırma
view.addEventListener('wheel', (e) => {
  if (!work) return; e.preventDefault();
  const r = view.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, k = Math.exp(-e.deltaY * 0.0015), ns = clamp(Z.s * k, 0.05, 40);
  Z.x = mx - (mx - Z.x) * (ns / Z.s); Z.y = my - (my - Z.y) * (ns / Z.s); Z.s = ns; applyZ();
}, { passive: false });
let drag = null;
view.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, zx: Z.x, zy: Z.y }; view.classList.add('pan'); view.setPointerCapture(e.pointerId); });
view.addEventListener('pointermove', (e) => { if (!drag) return; Z.x = drag.zx + e.clientX - drag.x; Z.y = drag.zy + e.clientY - drag.y; applyZ(); });
view.addEventListener('pointerup', () => { drag = null; view.classList.remove('pan'); });
view.addEventListener('dblclick', fitView);
window.addEventListener('resize', () => work && fitView());

(function init() {
  let t = 'dark';
  try { t = localStorage.getItem('ink-theme') || 'dark'; const s = JSON.parse(localStorage.getItem('ink-cfg') || 'null'); if (s) Object.assign(P, s); } catch {}
  setTheme(t); renderPresets(); renderSliders(); seg('osz', 'out', Number); seg('obg', 'obg');
})();
