// Docx / txt / pptx -> real PDF bytes, entirely in the browser.
//
// The Electron main process produces these PDFs with LibreOffice or a hidden
// Chromium print window; a browser has neither. This module rebuilds the same
// result three ways:
//   word   mammoth -> HTML on an A4 sheet -> tall bitmap -> slice into pages
//   txt    plain text -> HTML on an A4 sheet -> same slicing
//   slides the built-in OOXML reader (src/js/importers/pptx.js) -> one slide
//          is one page
// The page bitmaps are then embedded into a genuine PDF with pdf-lib, so the
// rest of the renderer keeps using its normal pdf.js pipeline untouched.
//
// Everything here is lazy: the heavy UMD libs are loaded from src/vendor on
// first use, never at startup.

const MM_PER_PX = 25.4 / 96;

async function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-vendor="${url}"]`)) return resolve();
    const s = document.createElement('script');
    s.dataset.vendor = url;
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load ' + url));
    document.head.appendChild(s);
  });
}

const vendor = (file) => new URL('../vendor/' + file, import.meta.url).href;

const PDFLibReady = () => loadScript(vendor('pdf-lib.min.js'));
const htmlToImageReady = () => loadScript(vendor('html-to-image.js'));
const mammothReady = () => loadScript(vendor('mammoth.browser.min.js'));

function waitForAssets(host) {
  return new Promise(async (resolve) => {
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch {} }
    const imgs = [...host.querySelectorAll('img')].filter((i) => !i.complete);
    await Promise.all(imgs.map((i) => new Promise((res) => { i.onload = i.onerror = res; })));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    resolve();
  });
}

/** A hidden, absolutely-positioned sheet we can bitmap without affecting layout. */
function hostFor(html) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:794px;background:#fff;overflow:visible;';
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

/**
 * Render `node` (or its contents) to a bitmap at the best DPR the browser can
 * handle, degraded for content that would blow past the canvas size limit.
 */
async function bitmapOf(node, { ratio = 2, maxPx = 16000 } = {}) {
  await htmlToImageReady();
  const w = node.offsetWidth || 794;
  const h = node.offsetHeight || 1;
  const r = Math.min(ratio, maxPx / Math.max(1, h));
  const canvas = await window.htmlToImage.toCanvas(node, { width: w, height: h, pixelRatio: r });
  return { canvas, r, w, h };
}

function cropTile(src, { x, y, w, h }) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w));
  out.height = Math.max(1, Math.round(h));
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, Math.round(x), Math.round(y), Math.round(w), Math.round(h), 0, 0, out.width, out.height);
  return out;
}

const canvasToPng = (c) => new Promise((res) => c.toBlob(res, 'image/png'));

/** Slice one tall sheet bitmap into fixed-height page tiles. */
function slicePages(canvas, r, pageWpx, pageHpx, tip) {
  const fullH = canvas.height;
  const step = Math.round(pageHpx * r);
  const out = [];
  for (let y = 0; y < fullH; y += step) {
    const h = Math.min(step, fullH - y);
    const tile = cropTile(canvas, { x: 0, y, w: pageWpx * r, h });
    out.push({ canvas: tile, tip });
  }
  return out;
}

/** Every page bitmap -> one real PDF via pdf-lib (A4 or per-slide paper). */
async function pdfFromBitmaps(bitmaps, { pageWmm, pageHmm }, onProgress) {
  await PDFLibReady();
  const PDFLib = window.PDFLib;
  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.create();
  const pt = (mm) => mm * 72 / 25.4;
  const images = [];
  for (let i = 0; i < bitmaps.length; i++) {
    const b = bitmaps[i];
    const png = await canvasToPng(b.canvas);
    const bytes = new Uint8Array(await png.arrayBuffer());
    let img;
    try { img = await doc.embedPng(bytes); }
    catch { img = await doc.embedJpg(await (async () => { const c = document.createElement('canvas'); c.width = b.canvas.width; c.height = b.canvas.height; c.getContext('2d').drawImage(b.canvas, 0, 0); return new Uint8Array(await (await canvasToPng(c)).arrayBuffer()); })()); }
    images.push(img);
    onProgress?.(i + 1, bitmaps.length);
  }
  const w = pt(pageWmm), h = pt(pageHmm);
  for (const img of images) {
    const page = doc.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  const out = await doc.save();
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

async function wordPages(buf, kind) {
  await mammothReady();
  const host = hostFor('<div class="doc"></div>');
  const docEl = host.firstChild;
  if (kind === 'txt') {
    const text = await new Blob([buf]).text();
    docEl.innerHTML = text.split(/\r?\n/).map((l) => `<p>${esc(l)}</p>`).join('') || '<p><em>(empty file)</em></p>';
  } else {
    const res = await window.mammoth.convertToHtml(
      { arrayBuffer: buf },
      {
        convertImage: window.mammoth.images.imgElement((image) =>
          image.read('base64').then((b64) => ({ src: `data:${image.contentType};base64,${b64}` }))
        )
      }
    );
    docEl.innerHTML = res.value || '<p><em>(empty document)</em></p>';
    const st = document.createElement('style');
    st.textContent = '.doc { padding:20mm; font-size:11pt; line-height:1.42; } ' +
      '.doc h1{font-size:20pt;margin:0 0 .5em} .doc h2{font-size:16pt;margin:1em 0 .4em} .doc h3{font-size:13pt;margin:1em 0 .35em} ' +
      '.doc p{margin:0 0 .6em} .doc table{border-collapse:collapse;width:100%;margin:.8em 0} .doc td,.doc th{border:1px solid #9aa0a6;padding:4px 7px;vertical-align:top} ' +
      '.doc img{max-width:100%;height:auto} .doc ul,.doc ol{margin:0 0 .6em 1.3em;padding:0} .doc blockquote{margin:.6em 0 .6em 1em;padding-left:.8em;border-left:3px solid #ccc;color:#444}';
    document.head.appendChild(st);
  }
  await waitForAssets(host);
  const { canvas, r } = await bitmapOf(host);
  const pages = slicePages(canvas, r, 794, 1123, 'word');
  host.remove();
  return pages;
}

async function slidePages(buf) {
  const JSZip = window.JSZip || await loadScript(vendor('jszip.min.js')).then(() => window.JSZip);
  const { pptxToSlides } = await import('../js/importers/pptx.js');
  const { widthPx, heightPx, slides } = await pptxToSlides(buf);
  const st = document.createElement('style');
  st.textContent =
    '.slide{position:relative;overflow:hidden;background:#fff}' +
    '.sh{position:absolute;box-sizing:border-box;font-size:14pt;line-height:1.2;overflow:hidden}' +
    '.sh p{margin:0 0 .28em}' +
    '.slide table{border-collapse:collapse;width:100%;height:100%;table-layout:fixed}' +
    '.slide td{border:1px solid #9aa0a6;padding:4px 6px;vertical-align:middle;font-size:11pt}';
  document.head.appendChild(st);
  const pages = [];
  for (let i = 0; i < slides.length; i++) {
    const host = hostFor(slides[i]);
    host.style.width = widthPx + 'px';
    host.firstChild.style.width = widthPx + 'px';
    host.firstChild.style.height = heightPx + 'px';
    await waitForAssets(host);
    const { canvas, r } = await bitmapOf(host, { ratio: 2 });
    pages.push({ canvas, tip: { wMm: widthPx * MM_PER_PX, hMm: heightPx * MM_PER_PX } });
    host.remove();
  }
  return pages;
}

/**
 * Convert a Word / text / PowerPoint file into real PDF bytes.
 * @param {File} file
 * @returns {Promise<{ok:boolean, engine?:string, data?:ArrayBuffer, name?:string, error?:string}>}
 */
export async function convertDocument(file, kind) {
  const name = file.name || 'document';
  const buf = await file.arrayBuffer();
  let pages;
  try {
    if (kind === 'word' || kind === 'txt') {
      pages = await wordPages(buf, kind);
    } else if (kind === 'slides') {
      pages = await slidePages(buf);
    } else {
      return { ok: false, error: 'Unsupported file type: ' + (name.split('.').pop() || name) };
    }
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
  if (!pages.length) return { ok: false, error: 'No pages found' };

  const first = pages[0];
  const pageWmm = first.tip.wMm || 210, pageHmm = first.tip.hMm || 297;
  let data;
  try {
    data = await pdfFromBitmaps(pages, { pageWmm, pageHmm });
  } catch (e) {
    return { ok: false, error: 'Could not build the PDF: ' + ((e && e.message) || e) };
  }
  return { ok: true, engine: 'builtin', data, name };
}