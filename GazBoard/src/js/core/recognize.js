// Ink -> shape recognition.
//
// Resample the stroke, decide open/closed, simplify to a corner polygon and
// classify. Returns null when nothing scores well enough, in which case the
// raw ink is kept - same behaviour as Whiteboard's "Ink to shape".

import { simplify, dist, bboxOfPoints } from './util.js';

function resample(pts, n = 64) {
  if (pts.length < 2) return pts.slice();
  let total = 0;
  const seg = [];
  for (let i = 1; i < pts.length; i++) { const d = dist(pts[i - 1], pts[i]); seg.push(d); total += d; }
  if (total === 0) return pts.slice();
  const step = total / (n - 1);
  const out = [pts[0]];
  let i = 1, acc = 0;
  let cur = { ...pts[0] };
  while (out.length < n && i < pts.length) {
    const d = dist(cur, pts[i]);
    if (acc + d >= step) {
      const t = (step - acc) / d;
      cur = { x: cur.x + (pts[i].x - cur.x) * t, y: cur.y + (pts[i].y - cur.y) * t };
      out.push({ ...cur });
      acc = 0;
    } else { acc += d; cur = { ...pts[i] }; i++; }
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1] });
  return out;
}

function pathLength(pts) { let t = 0; for (let i = 1; i < pts.length; i++) t += dist(pts[i - 1], pts[i]); return t; }

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

function angleAt(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const d = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

/**
 * @returns {null | {kind, x, y, w, h, confidence}}
 */
export function recognize(points, opts = {}) {
  if (!points || points.length < 6) return null;
  const bb = bboxOfPoints(points);
  const diag = Math.hypot(bb.w, bb.h);
  if (diag < 24) return null;

  const pts = resample(points, 64);
  const len = pathLength(pts);
  const gap = dist(pts[0], pts[pts.length - 1]);
  const closed = gap < Math.max(diag * 0.28, 18) && len > diag * 1.5;

  /* ---- straight line / arrow (open, low deviation) ---- */
  if (!closed) {
    const a = pts[0], b = pts[pts.length - 1];
    let maxDev = 0;
    const L = dist(a, b) || 1;
    for (const p of pts) {
      const d = Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / L;
      if (d > maxDev) maxDev = d;
    }
    if (maxDev < L * 0.09 && L > 30) {
      return { kind: 'line', x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, confidence: 1 - maxDev / (L * 0.09) };
    }
    // arrow: mostly straight shaft plus a V at the end
    const shaft = pts.slice(0, Math.floor(pts.length * 0.62));
    const sa = shaft[0], sb = shaft[shaft.length - 1];
    const SL = dist(sa, sb) || 1;
    let sdev = 0;
    for (const p of shaft) {
      const d = Math.abs((sb.y - sa.y) * p.x - (sb.x - sa.x) * p.y + sb.x * sa.y - sb.y * sa.x) / SL;
      if (d > sdev) sdev = d;
    }
    const tail = pts.slice(Math.floor(pts.length * 0.62));
    const backAngle = angleAt(sa, sb, tail[tail.length - 1]);
    if (sdev < SL * 0.1 && SL > 40 && backAngle < 1.25 && dist(sb, tail[tail.length - 1]) < SL * 0.6) {
      return { kind: 'arrow', x: sa.x, y: sa.y, w: sb.x - sa.x, h: sb.y - sa.y, confidence: 0.75 };
    }
    return null;
  }

  /* ---- closed shapes ---- */
  const loop = pts.slice();
  const c = centroid(loop);
  const radii = loop.map((p) => dist(p, c));
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const varr = radii.reduce((a, r) => a + (r - mean) ** 2, 0) / radii.length;
  const cv = Math.sqrt(varr) / (mean || 1);

  // corner detection on a simplified loop
  const tol = Math.max(diag * 0.045, 3);
  let poly = simplify(loop, tol);
  if (poly.length > 2 && dist(poly[0], poly[poly.length - 1]) < tol) poly = poly.slice(0, -1);

  const corners = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[(i - 1 + poly.length) % poly.length], b = poly[i], d = poly[(i + 1) % poly.length];
    if (dist(a, b) < diag * 0.06 || dist(b, d) < diag * 0.06) continue;
    const ang = angleAt(a, b, d);
    if (ang < 2.5) corners.push({ p: b, ang });
  }
  const n = corners.length;

  const box = bboxOfPoints(loop);
  const aspect = box.w / (box.h || 1);

  // circle / ellipse: low radial variation
  if (cv < 0.14 && n <= 2) {
    const kind = Math.abs(aspect - 1) < 0.18 ? 'circle' : 'ellipse';
    return { kind, ...box, confidence: 1 - cv / 0.14 };
  }

  if (n === 3) return { kind: 'triangle', ...box, confidence: 0.85 };

  if (n === 4) {
    // diamond when corners sit near the midpoints of the bounding box edges
    const mids = corners.map(({ p }) => {
      const rx = (p.x - box.x) / (box.w || 1), ry = (p.y - box.y) / (box.h || 1);
      return (Math.abs(rx - 0.5) < 0.22 && (ry < 0.22 || ry > 0.78)) || (Math.abs(ry - 0.5) < 0.22 && (rx < 0.22 || rx > 0.78));
    }).filter(Boolean).length;
    if (mids >= 3) return { kind: 'diamond', ...box, confidence: 0.8 };
    const square = Math.abs(aspect - 1) < 0.16;
    return { kind: 'rect', ...box, confidence: 0.88, square };
  }

  if (n === 5) return { kind: 'pentagon', ...box, confidence: 0.7 };
  if (n === 6) return { kind: 'hexagon', ...box, confidence: 0.7 };

  if (cv < 0.22) {
    const kind = Math.abs(aspect - 1) < 0.18 ? 'circle' : 'ellipse';
    return { kind, ...box, confidence: 0.6 };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  Does the guess actually match the ink?
 *
 *  Classification alone counts corners and radial variance, which a messy
 *  scribble can satisfy by accident - that is where a wrong shape comes from.
 *  Before accepting anything, the candidate outline is sampled and every ink
 *  point measured against it. A stroke that does not sit on its own supposed
 *  shape is left as ink.
 * ------------------------------------------------------------------ */

function outlineOf(kind, b) {
  const { x, y, w, h } = b;
  const cx = x + w / 2, cy = y + h / 2;
  const poly = (n, rot) => Array.from({ length: n }, (_, i) => {
    const a = rot + (i * Math.PI * 2) / n;
    return { x: cx + Math.cos(a) * w / 2, y: cy + Math.sin(a) * h / 2 };
  });
  const dense = (verts, closed = true) => {
    const out = [];
    const list = closed ? [...verts, verts[0]] : verts;
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], c = list[i];
      const steps = Math.max(2, Math.ceil(Math.hypot(c.x - a.x, c.y - a.y) / 3));
      for (let s = 0; s < steps; s++)
        out.push({ x: a.x + (c.x - a.x) * s / steps, y: a.y + (c.y - a.y) * s / steps });
    }
    return out;
  };

  switch (kind) {
    case 'line': case 'arrow':
      return dense([{ x, y }, { x: x + w, y: y + h }], false);
    case 'circle': case 'ellipse':
      return Array.from({ length: 72 }, (_, i) => {
        const a = (i / 72) * Math.PI * 2;
        return { x: cx + Math.cos(a) * w / 2, y: cy + Math.sin(a) * h / 2 };
      });
    case 'triangle': return dense([{ x: cx, y }, { x: x + w, y: y + h }, { x, y: y + h }]);
    case 'diamond': return dense([{ x: cx, y }, { x: x + w, y: cy }, { x: cx, y: y + h }, { x, y: cy }]);
    case 'pentagon': return dense(poly(5, -Math.PI / 2));
    case 'hexagon': return dense(poly(6, 0));
    default: return dense([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]);
  }
}

/**
 * Mean distance from the ink to the candidate outline, as a fraction of the
 * shape's diagonal. Around 0.02 for a deliberate shape; a scribble is far more.
 */
export function fitError(points, kind, box) {
  const outline = outlineOf(kind, box);
  if (!outline.length) return 1;
  const diag = Math.hypot(box.w, box.h) || 1;
  let total = 0;
  for (const p of points) {
    let best = Infinity;
    for (const q of outline) {
      const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (d < best) best = d;
    }
    total += Math.sqrt(best);
  }
  return total / points.length / diag;
}

export const MAX_FIT_ERROR = 0.055;

/** A drawn cross/grid becomes a table (Whiteboard's "ink to table"). */
export function recognizeTable(points) {
  const r = recognize(points);
  if (!r || r.kind !== 'rect') return null;
  return { rows: 2, cols: 2, x: r.x, y: r.y, w: r.w, h: r.h };
}
