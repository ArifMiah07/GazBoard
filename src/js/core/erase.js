// Partial (point) erasing: cut the eraser's swept capsule out of a stroke and
// return the surviving runs of points.

import { distToSegment, dist, bboxOfPoints, simplify, uid, rotatePoint } from './util.js';
import { boundsOf } from './store.js';

/** Insert interpolated points so a wide gap can't slip past the eraser. */
function densify(pts, maxGap) {
  if (pts.length < 2) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = dist(a, b);
    if (d > maxGap) {
      const n = Math.min(64, Math.ceil(d / maxGap));
      for (let k = 1; k < n; k++) {
        const t = k / n;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: (a.p ?? 0.5) + ((b.p ?? 0.5) - (a.p ?? 0.5)) * t });
      }
    }
    out.push(b);
  }
  return out;
}

/**
 * Cut the segment a→b (radius r) out of `points`.
 * @returns {null | Array<Array<{x,y,p}>>} null when nothing was touched,
 *          otherwise the runs that survive (possibly an empty array).
 */
export function cutPoints(points, a, b, r) {
  const pts = densify(points, Math.max(0.75, r * 0.5));
  let touched = false;
  const keep = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const hit = distToSegment(pts[i], a, b) <= r;
    keep[i] = !hit;
    if (hit) touched = true;
  }
  if (!touched) return null;

  const runs = [];
  let cur = [];
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) cur.push(pts[i]);
    else { if (cur.length > 1) runs.push(cur); cur = []; }
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

/** Rotation baked into the points, so fragments keep their place on the board. */
export function bakedPoints(stroke) {
  if (!stroke.rotation) return stroke.points;
  const b = boundsOf(stroke);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return stroke.points.map((p) => {
    const q = rotatePoint(p.x, p.y, cx, cy, stroke.rotation);
    return { x: q.x, y: q.y, p: p.p };
  });
}

/**
 * Split one stroke with the eraser.
 * @returns {null | Array<object>} null when untouched, otherwise the
 *          replacement stroke objects (empty array = fully erased).
 */
export function splitStroke(stroke, a, b, r, tolerance = 0.4) {
  const points = bakedPoints(stroke);
  const runs = cutPoints(points, a, b, r);
  if (runs === null) return null;

  const minLength = Math.max(1.2, r * 0.25);
  return runs
    .map((run) => simplify(run, tolerance))
    .filter((run) => run.length > 1 && pathLength(run) >= minLength)
    .map((run) => ({
      ...structuredClone(stroke),
      id: uid('s'),
      rotation: 0,
      points: run.map((p) => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2), p: +(p.p ?? 0.5).toFixed(2) })),
      bbox: bboxOfPoints(run)
    }));
}

function pathLength(pts) {
  let t = 0;
  for (let i = 1; i < pts.length; i++) t += dist(pts[i - 1], pts[i]);
  return t;
}
