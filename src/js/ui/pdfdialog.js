// "Page setup" dialog for PDF export.

import { h } from './popover.js';

/** Paper sizes in millimetres, portrait. */
export const PAPER = [
  { id: 'a4',     label: 'A4',       w: 210,   h: 297 },
  { id: 'letter', label: 'Letter',   w: 215.9, h: 279.4 },
  { id: 'a3',     label: 'A3',       w: 297,   h: 420 },
  { id: 'legal',  label: 'Legal',    w: 215.9, h: 355.6 },
  { id: 'a5',     label: 'A5',       w: 148,   h: 210 },
  { id: 'fit',    label: 'Fit board', w: 0,    h: 0 }     // page takes the board's own shape
];

export const MARGINS = [
  { id: 'none',   label: 'None',   mm: 0 },
  { id: 'narrow', label: 'Narrow', mm: 8 },
  { id: 'normal', label: 'Normal', mm: 15 },
  { id: 'wide',   label: 'Wide',   mm: 25 }
];

export const paperById = (id) => PAPER.find((p) => p.id === id) || PAPER[0];
export const marginById = (id) => MARGINS.find((m) => m.id === id) || MARGINS[1];

/**
 * Work out the sheet grid for a board of `box` (world units, 1 unit = 1 CSS px).
 *
 * @returns {{cols:number, rows:number, pageW:number, pageH:number,
 *            innerW:number, innerH:number, scale:number, marginMm:number,
 *            tileW:number, tileH:number}}
 *   pageW/pageH are millimetres including margins; tileW/tileH are the slice of
 *   the board (in world units) that lands on each sheet.
 */
export function layoutPages(box, { paper = 'a4', orientation = 'landscape', margin = 'narrow', mode = 'fit', scale = 1 } = {}) {
  const MM_PER_PX = 25.4 / 96;                 // CSS pixels are 1/96 inch
  const m = marginById(margin).mm;
  const p = paperById(paper);

  if (p.id === 'fit') {
    const pageW = box.w * MM_PER_PX + m * 2;
    const pageH = box.h * MM_PER_PX + m * 2;
    return { cols: 1, rows: 1, pageW, pageH, innerW: pageW - m * 2, innerH: pageH - m * 2,
             scale: 1, marginMm: m, tileW: box.w, tileH: box.h };
  }

  const portrait = orientation !== 'landscape';
  const pageW = portrait ? p.w : p.h;
  const pageH = portrait ? p.h : p.w;
  const innerW = Math.max(10, pageW - m * 2);
  const innerH = Math.max(10, pageH - m * 2);

  if (mode === 'fit') {
    // the whole board on one sheet
    const s = Math.min(innerW / (box.w * MM_PER_PX), innerH / (box.h * MM_PER_PX));
    return { cols: 1, rows: 1, pageW, pageH, innerW, innerH, scale: s, marginMm: m,
             tileW: box.w, tileH: box.h };
  }

  // tiled: keep the board at `scale` and split it across as many sheets as it takes
  const tileW = (innerW / MM_PER_PX) / scale;
  const tileH = (innerH / MM_PER_PX) / scale;
  return {
    cols: Math.max(1, Math.ceil(box.w / tileW - 0.001)),
    rows: Math.max(1, Math.ceil(box.h / tileH - 0.001)),
    pageW, pageH, innerW, innerH, scale, marginMm: m, tileW, tileH
  };
}

/**
 * @returns {Promise<null | {paper, orientation, margin, mode, scale, quality}>}
 */
export function choosePageSetup(app, box) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('overlay');
    const card = document.getElementById('overlayCard');
    card.innerHTML = '';

    const s = app.settings;
    const opts = {
      paper: s.pdfPaper || 'a4',
      orientation: s.pdfOrientation || (box.w >= box.h ? 'landscape' : 'portrait'),
      margin: s.pdfMargin || 'narrow',
      mode: s.pdfMode || 'fit',
      scale: 1,
      quality: s.pdfQuality || 2
    };

    const done = (v) => {
      overlay.classList.remove('show');
      card.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
      else if (e.key === 'Enter') { e.preventDefault(); done({ ...opts }); }
    };
    document.addEventListener('keydown', onKey, true);

    card.appendChild(h('h3', {}, 'Export as PDF'));
    const summary = h('p', { style: 'margin-bottom:14px;font-size:13px;color:var(--text-2)' });

    const rowStyle = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap';
    const labelStyle = 'font-size:13px;color:var(--text-2);min-width:82px';

    const group = (label, items, get, set) => {
      const wrap = h('div', { style: rowStyle }, h('span', { style: labelStyle }, label));
      const buttons = items.map((it) => {
        const b = h('button', { class: 'btn' }, it.label);
        b.addEventListener('click', () => { set(it.id); paint(); });
        b._id = it.id;
        wrap.appendChild(b);
        return b;
      });
      wrap._sync = () => buttons.forEach((b) => b.classList.toggle('primary', b._id === get()));
      return wrap;
    };

    const paperRow = group('Page size', PAPER, () => opts.paper, (v) => (opts.paper = v));
    const orientRow = group('Orientation',
      [{ id: 'landscape', label: 'Landscape' }, { id: 'portrait', label: 'Portrait' }],
      () => opts.orientation, (v) => (opts.orientation = v));
    const marginRow = group('Margin', MARGINS, () => opts.margin, (v) => (opts.margin = v));
    const modeRow = group('Layout',
      [{ id: 'fit', label: 'Fit on one page' }, { id: 'tile', label: 'Across several pages' }],
      () => opts.mode, (v) => (opts.mode = v));
    const qualityRow = group('Quality',
      [{ id: 1.5, label: 'Draft' }, { id: 2, label: 'Standard' }, { id: 3, label: 'High' }],
      () => opts.quality, (v) => (opts.quality = v));

    card.append(paperRow, orientRow, marginRow, modeRow, qualityRow, summary);

    const paint = () => {
      const fit = opts.paper === 'fit';
      orientRow.style.display = fit ? 'none' : rowStyle.includes('flex') ? 'flex' : '';
      modeRow.style.display = fit ? 'none' : 'flex';
      [paperRow, orientRow, marginRow, modeRow, qualityRow].forEach((r) => r._sync());
      const L = layoutPages(box, opts);
      const sheets = L.cols * L.rows;
      summary.textContent = fit
        ? `One sheet, ${Math.round(L.pageW)} × ${Math.round(L.pageH)} mm — the page takes the board's own shape.`
        : opts.mode === 'fit'
          ? `One sheet at ${Math.round(L.scale * 100)}% of actual size.`
          : `${sheets} sheet${sheets === 1 ? '' : 's'} — ${L.cols} across × ${L.rows} down, at actual size.`;
    };
    paint();

    card.appendChild(h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => done(null) }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => done({ ...opts }) }, 'Export')));
    overlay.classList.add('show');
  });
}
