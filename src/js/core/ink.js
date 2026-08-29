// Ink geometry.
//
// A stroke is drawn as ONE stroked path down its centreline, not as a filled
// outline. That matters:
//
//   * A single ctx.stroke() rasterises the whole stroke once, so a highlighter
//     that crosses itself composites once and cannot darken at the overlap -
//     the blotches that started this rewrite.
//   * Curving through the MIDPOINTS of the input points keeps every segment
//     inside its control triangle, so the path can never overshoot or loop.
//     Offsetting a centreline into a left/right outline has no such guarantee:
//     at a sharp turn the two sides cross and the fill throws out a spike,
//     which is what put barbs on the letters.
//
// Width is therefore constant along a stroke. That is also how a felt pen
// behaves, which is the look being matched; pressure sets the weight of the
// whole stroke instead of wobbling along it.

import { clamp, dist } from './util.js';

const PRESSURE_FLOOR = 0.82;   // stroke weight at the lightest touch
const PRESSURE_RANGE = 0.36;   // ... plus this much at the heaviest

/** Light moving average - removes sensor jitter without rounding letterforms. */
function smoothPath(pts, passes = 1) {
  if (pts.length < 3) return pts;
  let cur = pts;
  for (let k = 0; k < passes; k++) {
    const next = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      next.push({
        x: (cur[i - 1].x + cur[i].x * 2 + cur[i + 1].x) / 4,
        y: (cur[i - 1].y + cur[i].y * 2 + cur[i + 1].y) / 4,
        p: cur[i].p
      });
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/** Drop points that sit on top of each other; they only add noise. */
function dedupe(pts, min) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) if (dist(out[out.length - 1], pts[i]) >= min) out.push(pts[i]);
  out.push(pts[pts.length - 1]);
  return out;
}

/** Mean pressure over the stroke - sets its weight. */
export function strokeWeight(points, size, pressure = true) {
  if (!pressure || !points.length) return size;
  let sum = 0, n = 0;
  for (const p of points) { sum += clamp(p.p ?? 0.5, 0, 1); n++; }
  return size * (PRESSURE_FLOOR + (sum / n) * PRESSURE_RANGE);
}

/**
 * The centreline, curved through the midpoints of the samples.
 * @returns {Path2D}
 */
export function centrelinePath(points, size) {
  const path = new Path2D();
  if (!points || !points.length) return path;

  const pts = smoothPath(dedupe(points, Math.max(0.35, size * 0.08)), 1);

  if (pts.length === 1) {                       // a dot
    path.moveTo(pts[0].x + 0.01, pts[0].y);
    path.lineTo(pts[0].x, pts[0].y);
    return path;
  }

  path.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) { path.lineTo(pts[1].x, pts[1].y); return path; }

  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    path.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  path.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  return path;
}

/* Paths are stable once a stroke is committed, so keep the last one. */
const cache = new WeakMap();

export function inkPath(stroke) {
  const pts = stroke.points;
  if (!pts || !pts.length) return null;
  const size = stroke.width || 4;
  const hit = cache.get(pts);
  if (hit && hit.len === pts.length && hit.size === size) return hit.path;
  const path = centrelinePath(pts, size);
  cache.set(pts, { len: pts.length, size, path });
  return path;
}
