import { clamp } from './util.js';

export const MIN_Z = 0.05, MAX_Z = 8;

export class Camera {
  constructor() { this.x = 0; this.y = 0; this.z = 1; }

  toScreen(wx, wy) { return { x: wx * this.z + this.x, y: wy * this.z + this.y }; }
  toWorld(sx, sy) { return { x: (sx - this.x) / this.z, y: (sy - this.y) / this.z }; }

  panBy(dx, dy) { this.x += dx; this.y += dy; }

  zoomAt(sx, sy, factor) {
    const z = clamp(this.z * factor, MIN_Z, MAX_Z);
    if (z === this.z) return;
    const w = this.toWorld(sx, sy);
    this.z = z;
    this.x = sx - w.x * z;
    this.y = sy - w.y * z;
  }

  setZoom(z, sx, sy) { this.zoomAt(sx, sy, clamp(z, MIN_Z, MAX_Z) / this.z); }

  /** Visible world rectangle for a viewport of `w` x `h` CSS px. */
  viewport(w, h) {
    const a = this.toWorld(0, 0), b = this.toWorld(w, h);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }

  fit(box, vw, vh, pad = 80) {
    if (!box || box.w <= 0 || box.h <= 0) { this.x = vw / 2; this.y = vh / 2; this.z = 1; return; }
    const z = clamp(Math.min((vw - pad * 2) / box.w, (vh - pad * 2) / box.h), MIN_Z, 2);
    this.z = z;
    this.x = vw / 2 - (box.x + box.w / 2) * z;
    this.y = vh / 2 - (box.y + box.h / 2) * z;
  }

  centerOn(pt, vw, vh) { this.x = vw / 2 - pt.x * this.z; this.y = vh / 2 - pt.y * this.z; }

  toJSON() { return { x: this.x, y: this.y, z: this.z }; }
  load(c) { if (!c) return; this.x = c.x ?? 0; this.y = c.y ?? 0; this.z = clamp(c.z ?? 1, MIN_Z, MAX_Z); }
}
