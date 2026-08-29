// Inserting images and documents (Word / PowerPoint / PDF) onto the board.

import { uid } from './core/util.js';
import { openPdf } from './importers/pdf.js';
import { choosePages } from './ui/pagepicker.js';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
const DOC_EXT = ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'odt', 'odp', 'rtf', 'txt', 'xlsx', 'xls'];

export const FILTERS = {
  image: [{ name: 'Images', extensions: IMAGE_EXT }],
  document: [
    { name: 'Documents', extensions: DOC_EXT },
    { name: 'PDF', extensions: ['pdf'] },
    { name: 'Word', extensions: ['docx', 'doc', 'rtf', 'odt'] },
    { name: 'PowerPoint', extensions: ['pptx', 'ppt', 'odp'] }
  ],
  any: [{ name: 'All supported', extensions: [...IMAGE_EXT, ...DOC_EXT] }]
};

const bytesToDataUrl = (buf, mime) => new Promise((res) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.readAsDataURL(new Blob([buf], { type: mime }));
});

const mimeFor = (ext) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' }[ext] || 'image/png');

function measure(dataUrl) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 });
    img.onerror = () => rej(new Error('Could not read image'));
    img.src = dataUrl;
  });
}

/** Free space to the right of everything already on the board. */
export function dropOrigin(app, w, h) {
  const b = app.store.contentBounds();
  const view = app.surface.cam.viewport(app.surface.width, app.surface.height);
  if (!b) return { x: view.x + view.w / 2 - w / 2, y: view.y + view.h / 2 - h / 2 };
  const overlapsView = b.x < view.x + view.w && b.x + b.w > view.x && b.y < view.y + view.h && b.y + b.h > view.y;
  if (!overlapsView) return { x: view.x + view.w / 2 - w / 2, y: view.y + view.h / 2 - h / 2 };
  return { x: b.x + b.w + 80, y: b.y };
}

export async function insertImagesFromPaths(app, paths) {
  const objs = [];
  for (const p of paths) {
    const ext = p.split('.').pop().toLowerCase();
    if (!IMAGE_EXT.includes(ext)) continue;
    const buf = await window.board.readFile(p);
    const dataUrl = await bytesToDataUrl(buf, mimeFor(ext));
    objs.push(await makeImageObject(app, dataUrl, p.split(/[\\/]/).pop(), objs.length));
  }
  if (objs.length) {
    app.store.addMany(objs, 'insert image');
    app.setSelection(objs.map((o) => o.id));
    app.frameSelection();
  }
  return objs;
}

export async function insertImageFiles(app, files, at) {
  const objs = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    objs.push(await makeImageObject(app, dataUrl, f.name, objs.length, at));
  }
  if (objs.length) {
    app.store.addMany(objs, 'insert image');
    app.setSelection(objs.map((o) => o.id));
  }
  return objs;
}

async function makeImageObject(app, dataUrl, name, index = 0, at) {
  const { w, h } = await measure(dataUrl);
  const maxW = 640;
  const scale = Math.min(1, maxW / w);
  const W = w * scale, H = h * scale;
  const o = at ? { x: at.x - W / 2, y: at.y - H / 2 } : dropOrigin(app, W, H);
  return { id: uid('img'), type: 'image', x: o.x + index * 24, y: o.y + index * 24, w: W, h: H, rotation: 0, src: dataUrl, name };
}

/**
 * Convert a Word / PowerPoint / PDF file to page bitmaps and lay them out.
 *
 * Anything with more than one page goes through the picker first, so you can
 * take page 4 of a 90-page PDF instead of all ninety. Every page lands as its
 * own independent object - nothing is grouped.
 */
export async function insertDocument(app, filePath, opts = {}) {
  const name = filePath.split(/[\\/]/).pop();
  const progress = app.showProgress(`Importing ${name}`, 'Converting document…');
  let doc = null;
  try {
    const res = await window.board.importToPdf(filePath);
    if (!res.ok) { progress.close(); app.toast(res.error || 'Import failed'); return null; }

    progress.update(0.2, res.engine === 'libreoffice' ? 'Converted with LibreOffice — reading pages…' : 'Reading pages…');
    doc = await openPdf(res.data);
    const total = doc.numPages;
    if (!total) { progress.close(); app.toast('No pages found in that document'); return null; }
    progress.close();

    let pages = opts.pages || null;
    let layout = opts.layout || null;

    if (!pages) {
      if (total === 1) { pages = [1]; layout = layout || 'row'; }
      else {
        const choice = await choosePages(app, { name, count: total, thumb: (n) => doc.thumb(n) });
        if (!choice) { await doc.destroy(); app.toast('Import cancelled'); return null; }
        pages = choice.pages;
        layout = choice.layout;
        opts = { ...opts, quality: choice.quality };
      }
    }
    layout = layout || (pages.length > 6 ? 'grid' : 'row');

    const render = app.showProgress(`Importing ${name}`, `Rendering ${pages.length} page${pages.length === 1 ? '' : 's'}…`);
    const rendered = [];
    for (let i = 0; i < pages.length; i++) {
      render.update((i + 1) / pages.length, `Rendering page ${pages[i]} (${i + 1} of ${pages.length})…`);
      rendered.push(await doc.render(pages[i], opts.quality ?? app.settings.importQuality ?? 2));
    }
    await doc.destroy();
    doc = null;

    const objs = layoutPages(app, rendered, { name, layout, multiPage: total > 1 });
    app.store.addMany(objs, 'insert document');
    app.setSelection([]);                       // separate objects, not a selected clump
    app.frameObjects(objs);
    render.close();
    app.toast(`${name}: ${objs.length} page${objs.length === 1 ? '' : 's'} added${res.engine === 'builtin' ? ' (built-in converter)' : ''}`, 'doc');
    return objs;
  } catch (e) {
    progress.close();
    if (doc) await doc.destroy().catch(() => {});
    app.toast('Import failed: ' + e.message);
    return null;
  }
}

/** Place rendered pages on the board without overlapping what is already there. */
function layoutPages(app, rendered, { name, layout, multiPage }) {
  const worldScale = 1.6;                       // 72dpi points -> comfortable board units
  const gap = 48;
  const cellW = Math.max(...rendered.map((p) => p.width)) * worldScale;
  const cellH = Math.max(...rendered.map((p) => p.height)) * worldScale;

  const perRow = layout === 'grid' ? Math.min(6, Math.ceil(Math.sqrt(rendered.length)))
    : layout === 'stack' ? 1 : rendered.length;
  const step = layout === 'stack' ? 42 : null;

  const cols = layout === 'stack' ? 1 : Math.min(perRow, rendered.length);
  const rows = layout === 'stack' ? 1 : Math.ceil(rendered.length / perRow);
  const spanW = layout === 'stack' ? cellW + step * (rendered.length - 1) : cols * (cellW + gap) - gap;
  const spanH = layout === 'stack' ? cellH + step * (rendered.length - 1) : rows * (cellH + gap) - gap;
  const origin = dropOrigin(app, spanW, spanH);

  return rendered.map((p, i) => {
    let x, y;
    if (layout === 'stack') { x = origin.x + i * step; y = origin.y + i * step; }
    else {
      const col = i % perRow, row = Math.floor(i / perRow);
      x = origin.x + col * (cellW + gap);
      y = origin.y + row * (cellH + gap);
    }
    return {
      id: uid('pg'), type: 'image', kind: 'page',
      x, y, w: p.width * worldScale, h: p.height * worldScale,
      rotation: 0, src: p.dataUrl,
      name, label: multiPage ? `${name} — page ${p.page}` : name,
      docSource: name, docPage: p.page
    };
  });
}

export async function pickAndInsertDocument(app) {
  const paths = await window.board.openDialog({
    title: 'Insert a document',
    properties: ['openFile', 'multiSelections'],
    filters: FILTERS.document
  });
  for (const p of paths) await insertDocument(app, p);
}

export async function pickAndInsertImage(app) {
  const paths = await window.board.openDialog({
    title: 'Insert an image',
    properties: ['openFile', 'multiSelections'],
    filters: FILTERS.image
  });
  if (paths.length) await insertImagesFromPaths(app, paths);
}

export function isImagePath(p) { return IMAGE_EXT.includes(p.split('.').pop().toLowerCase()); }
export function isDocPath(p) { return DOC_EXT.includes(p.split('.').pop().toLowerCase()); }
