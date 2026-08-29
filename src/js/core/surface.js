// The canvas view: sizing, the draw loop, culling, overlays.

import { Camera } from './camera.js';
import { drawBackground, drawObject, drawSelection, drawMemberOutline, drawLockBadge, FONT } from './render.js';
import { worldBounds } from './store.js';
import { boxesIntersect } from './util.js';

export class Surface {
  constructor(canvas, store) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.store = store;
    this.cam = new Camera();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.width = 0; this.height = 0;
    this.dirty = true;
    this.overlays = [];        // fn(ctx, surface) drawn in screen space
    this.wet = null;           // in-progress stroke object
    this.selection = new Set();
    this.hoverId = null;
    this._raf = null;
    this._onFrame = this._onFrame.bind(this);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    window.addEventListener('resize', () => this.resize());
    // a move between monitors changes devicePixelRatio without a resize event
    this._watchPixelRatio();
    this.resize(true);
    this.start();
  }

  start() { if (!this._raf) this._raf = requestAnimationFrame(this._onFrame); }

  _watchPixelRatio() {
    const arm = () => {
      const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', () => { this.resize(); arm(); }, { once: true });
    };
    try { arm(); } catch { /* older engines: the per-frame check still covers it */ }
  }
  invalidate() { this.dirty = true; }

  /**
   * Sync the drawing buffer to the element's real layout box.
   *
   * The element's SIZE is left entirely to CSS (`inset: 0`), so it can never
   * drift from the stage; only the backing store is set here. This is called
   * from resize events and again every frame, where it costs two cached layout
   * reads and returns immediately unless something actually changed - which is
   * what makes it self-correcting after a maximize, a monitor change, or a
   * display-scaling change that fires no event we happened to listen for.
   */
  resize(force = false) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (!force && w === this.width && h === this.height && dpr === this.dpr) return false;

    this.width = w; this.height = h; this.dpr = dpr;
    const bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== bw) this.canvas.width = bw;
    if (this.canvas.height !== bh) this.canvas.height = bh;
    this.invalidate();
    this.onResize?.(w, h);
    return true;
  }

  toWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    return this.cam.toWorld(e.clientX - r.left, e.clientY - r.top);
  }
  toScreenPt(w) { return this.cam.toScreen(w.x, w.y); }
  screenPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  selectionBounds() {
    let b = null;
    for (const id of this.selection) {
      const o = this.store.get(id);
      if (!o) continue;
      const ob = worldBounds(o);
      b = b ? {
        x: Math.min(b.x, ob.x), y: Math.min(b.y, ob.y),
        w: Math.max(b.x + b.w, ob.x + ob.w) - Math.min(b.x, ob.x),
        h: Math.max(b.y + b.h, ob.y + ob.h) - Math.min(b.y, ob.y)
      } : ob;
    }
    return b;
  }

  /** True when every selected object is locked - no transform handles then. */
  selectionIsLocked() {
    if (!this.selection.size) return false;
    for (const id of this.selection) { const o = this.store.get(id); if (o && !o.locked) return false; }
    return true;
  }

  selectionScreenBox(pad = 6) {
    const b = this.selectionBounds();
    if (!b) return null;
    const p = this.cam.toScreen(b.x, b.y);
    return { x: p.x - pad, y: p.y - pad, w: b.w * this.cam.z + pad * 2, h: b.h * this.cam.z + pad * 2 };
  }

  _onFrame() {
    this._raf = requestAnimationFrame(this._onFrame);
    this.resize();                 // cheap no-op unless the box or DPR moved
    if (!this.dirty) return;
    this.dirty = false;
    this.draw();
  }

  /** CSS-pixel coordinates map 1:1 to the canvas after this. */
  screenTransform() { this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }

  draw() {
    const { ctx, cam } = this;
    const w = this.width, h = this.height;
    if (!w || !h) return;

    this.screenTransform();
    drawBackground(ctx, this.store.doc.background, cam, w, h, this.store.doc.page);

    ctx.setTransform(this.dpr * cam.z, 0, 0, this.dpr * cam.z, this.dpr * cam.x, this.dpr * cam.y);

    const view = cam.viewport(w, h);
    const pad = 64 / cam.z;
    const vbox = { x: view.x - pad, y: view.y - pad, w: view.w + pad * 2, h: view.h + pad * 2 };
    const onload = () => this.invalidate();

    for (const o of this.store.objects) {
      if (!o) continue;
      if (!boxesIntersect(vbox, worldBounds(o))) continue;
      drawObject(ctx, o, onload);
    }

    if (this.wet) drawObject(ctx, this.wet, onload);

    // ---- screen-space overlays (CSS pixels) ----
    this.screenTransform();

    if (this.hoverId && !this.selection.has(this.hoverId)) {
      const o = this.store.get(this.hoverId);
      if (o) {
        const b = worldBounds(o);
        const p = cam.toScreen(b.x, b.y);
        ctx.save();
        ctx.strokeStyle = 'rgba(0,120,212,0.35)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x - 3, p.y - 3, b.w * cam.z + 6, b.h * cam.z + 6);
        ctx.restore();
      }
    }

    for (const o of this.store.objects) {
      if (!o || !o.locked) continue;
      if (!boxesIntersect(vbox, worldBounds(o))) continue;
      drawLockBadge(ctx, cam, o);
    }

    if (this.selection.size) {
      const locked = this.selectionIsLocked();
      if (this.selection.size > 1) for (const id of this.selection) { const o = this.store.get(id); if (o) drawMemberOutline(ctx, cam, o); }
      const box = this.selectionScreenBox();
      if (box) drawSelection(ctx, box, locked ? { handles: false, dashed: true } : { rotate: true });
    }

    for (const fn of this.overlays) fn(ctx, this);
  }

  /** Render the board (or a region) to an offscreen canvas - used by export. */
  renderTo(box, scale = 2, background = true) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(box.w * scale));
    c.height = Math.max(1, Math.round(box.h * scale));
    const ctx = c.getContext('2d');
    if (background) {
      ctx.fillStyle = this.store.doc.background.color || '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale);
    for (const o of this.store.objects) {
      if (!o) continue;
      if (!boxesIntersect(box, worldBounds(o))) continue;
      drawObject(ctx, o);
    }
    return c;
  }
}
