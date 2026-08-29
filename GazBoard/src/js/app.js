// GazBoard - application shell and command surface.

import { Store, withAttached, worldBounds } from './core/store.js';
import { Surface } from './core/surface.js';
import { Interaction } from './core/tools.js';
import { pick } from './core/hit.js';
import { uid, debounce, clamp } from './core/util.js';
import { TextEditor } from './ui/textedit.js';
import { initToolbar, syncToolbar } from './ui/toolbar.js';
import { createPanels } from './ui/panels.js';
import { showContextMenu, updateSelectionBar } from './ui/contextmenu.js';
import { closePopover, h } from './ui/popover.js';
import { icon } from './ui/icons.js';
import { exportPng, exportSvg, exportPdf, saveBoardFile, openBoardFile } from './export.js';
import {
  pickAndInsertDocument, pickAndInsertImage, insertDocument,
  insertImagesFromPaths, insertImageFiles, dropOrigin, isImagePath, isDocPath
} from './insert.js';

const DEFAULT_SETTINGS = {
  penColor: '#201f1e', penWidth: 4, penEffect: 'none',
  highlighterColor: '#fff100', highlighterWidth: 20,
  eraserSize: 30, eraserMode: 'partial',
  pdfPaper: 'a4', pdfOrientation: '', pdfMargin: 'narrow', pdfMode: 'fit', pdfQuality: 2,
  noteColor: '#ffd94a', noteSize: 200, noteFont: 'hand',
  textColor: '#201f1e', textSize: 32, textFont: 'hand',
  shapeKind: 'rect', shapeStroke: '#201f1e', shapeFill: 'none', shapeLineWidth: 3, shapeDash: null,
  inkToShape: false, pressure: true, wheelZoom: false, returnToSelect: true, autosave: true,
  edgePan: true, importQuality: 2,
  // 'auto' follows Whiteboard: the mouse inks until a stylus shows up, then it
  // becomes a pan-only device. 'yes' / 'no' pin it either way.
  inkWithMouse: 'auto', penSeen: false
};

class App {
  constructor() {
    this.store = new Store();
    this.surface = new Surface(document.getElementById('c'), this.store);
    this.settings = this.loadSettings();
    this.tool = 'pen';
    this.clipboard = [];
    this.ruler = { visible: false, x: 0, y: 0, angle: 0, length: 900, thickness: 78, snap: true };
    this.textEditor = new TextEditor(this);
    this.panels = createPanels(this);
    this.interaction = new Interaction(this);

    initToolbar(this);
    this.wireGlobalEvents();
    this.wireStore();
    this.restoreLastBoard();
    this.setTool('pen');
    this.syncUI();
  }

  /* ---------------- settings ---------------- */
  loadSettings() {
    try {
      const raw = localStorage.getItem('gazboard.settings') || localStorage.getItem('openboard.settings') || '{}';
      const s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      if (s.eraserMode === 'stroke') s.eraserMode = 'object';   // pre-1.1 name
      // Text and notes were set in the sans face up to 1.13. Handwriting is the
      // default now; carry anyone who never touched the picker across to it, and
      // leave a deliberate choice of 'ui' alone once it has been made.
      if (!s.fontDefaults2) {
        if (s.textFont === 'ui') s.textFont = 'hand';
        if (s.noteFont === 'ui') s.noteFont = 'hand';
        s.fontDefaults2 = true;
      }
      return s;
    } catch { return { ...DEFAULT_SETTINGS }; }
  }
  saveSettings() {
    try { localStorage.setItem('gazboard.settings', JSON.stringify(this.settings)); } catch {}
    this.syncUI();
  }

  /* ---------------- board lifecycle ---------------- */
  wireStore() {
    this.unsavedNew = true;          // until a board is loaded or something is drawn
    this.autosave = debounce(() => this.persist(), 700);
    this.store.subscribe(() => {
      this.surface.invalidate();
      this.syncUI();
      if (this.settings.autosave && !(this.unsavedNew && !this.store.objects.length)) {
        this.markDirty();
      }
      if (this.settings.autosave) this.autosave();      // persist() decides whether to write
    });
  }

  markDirty() {
    const b = document.getElementById('savedBadge');
    b.textContent = 'Saving…';
  }

  /**
   * Write the current board out.
   *
   * A brand new board that has never had anything put on it is deliberately
   * skipped: saving it on sight left a fresh "Untitled board" behind on every
   * single launch. `force` is for an explicit "save" the user asked for.
   */
  async persist({ force = false } = {}) {
    if (!force && this.unsavedNew && !this.store.objects.length) return;
    this.store.doc.camera = this.surface.cam.toJSON();
    // boards.save writes the file and records the "last open" pointer in one go,
    // both through the main process, so both are on disk immediately
    await window.board.boards.save(this.store.toJSON());
    this.unsavedNew = false;
    try { localStorage.setItem('gazboard.lastBoard', this.store.doc.id); } catch {}
    const b = document.getElementById('savedBadge');
    b.textContent = 'Saved';
  }

  /**
   * Open whatever the user was last working on.
   *
   * The main process picks it: the recorded pointer first, then the most
   * recently touched board that has anything on it. A blank canvas is only ever
   * the answer when there genuinely are no boards - anything else and someone
   * who restarted their PC would be staring at an empty screen with their work
   * sitting on disk a folder away.
   */
  async restoreLastBoard() {
    try {
      const res = await window.board.boards.resume();
      if (res && res.board) {
        await this.loadBoard(res.board, { silent: true, startup: true });
        if (res.reason === 'newest') this.toast('Reopened your most recent board');
        return;
      }
    } catch (e) { console.warn('resume failed, falling back:', e); }

    // last resort: the old localStorage hint, then a fresh board
    const id = localStorage.getItem('gazboard.lastBoard') || localStorage.getItem('openboard.lastBoard');
    if (id) {
      const data = await window.board.boards.load(id);
      if (data) { await this.loadBoard(data, { silent: true, startup: true }); return; }
    }
    this.newBoard(true);
  }

  /**
   * Open at 100%, looking at wherever the board was last centred.
   *
   * Restoring a saved zoom meant re-opening at whatever odd level the last
   * action left behind - after fitting a document to the screen, that is
   * something like 36%, and the app looks broken before you have touched it.
   * Runs after the first layout, because the viewport size is needed to centre.
   */
  openAtActualSize(focus) {
    const settle = () => {
      const sf = this.surface;
      if (!sf.width || !sf.height) { requestAnimationFrame(settle); return; }
      const view = sf.cam.viewport(sf.width, sf.height);
      const at = focus || { x: view.x + view.w / 2, y: view.y + view.h / 2 };
      sf.cam.z = 1;
      sf.cam.centerOn(at, sf.width, sf.height);
      this.syncZoom();
      sf.invalidate();
    };
    requestAnimationFrame(settle);
  }

  newBoard(silent = false) {
    this.store.reset();
    this.surface.selection.clear();
    this.openAtActualSize();
    document.getElementById('boardTitle').value = this.store.doc.name;
    this.syncUI();
    this.surface.invalidate();
    if (!silent) this.toast('New board');
    // An empty board is not written until something is put on it. Saving it
    // straight away left a fresh "Untitled board" behind on every launch.
    this.unsavedNew = true;
    document.getElementById('savedBadge').textContent = 'Saved';
    window.board.boards.setLast(this.store.doc.id);
  }

  async loadBoard(data, opts = {}) {
    this.textEditor.cancel();
    this.store.load(data);
    this.unsavedNew = false;
    this.surface.selection.clear();
    if (data.camera) this.surface.cam.load(data.camera);
    else this.command('fit');
    // opening a board always starts at 100%, keeping the place you were looking at
    if (opts.startup) this.openAtActualSize();
    document.getElementById('boardTitle').value = this.store.doc.name;
    this.syncUI();
    this.surface.invalidate();
    localStorage.setItem('gazboard.lastBoard', this.store.doc.id);
    if (!opts.silent) this.toast('Opened ' + this.store.doc.name);
  }

  /* ---------------- tools & selection ---------------- */
  setTool(tool) {
    if (tool === 'pen' || tool === 'highlighter') this.lastInkTool = tool;
    if (this.tool === tool) return;
    this.textEditor.commit();
    this.tool = tool;
    if (tool !== 'select' && tool !== 'lasso') this.setSelection([]);
    this.syncUI();
    this.surface.invalidate();
  }

  setSelection(ids, additive = false) {
    const sel = this.surface.selection;
    if (!additive) sel.clear();
    for (const id of ids) if (this.store.has(id)) sel.add(id);
    this.syncUI();
    this.surface.invalidate();
  }

  get selected() { return [...this.surface.selection].map((id) => this.store.get(id)).filter(Boolean); }
  get selection() { return this.surface.selection; }

  /**
   * Locking claims whatever is already drawn on top.
   *
   * Attachment used to be decided only as ink was drawn, so the natural order -
   * import a slide, annotate it, then lock it - produced nothing to carry. Now
   * either order works.
   */
  adoptOverlapping(hosts) {
    const patch = [];
    for (const host of hosts) {
      const hb = worldBounds(host);
      const hostIndex = this.store.indexOf(host.id);
      for (const o of this.store.objects) {
        if (o === host || o.locked || o.attachedTo) continue;
        if (this.store.indexOf(o.id) < hostIndex) continue;      // must sit above it
        const b = worldBounds(o);
        const ox = Math.max(0, Math.min(b.x + b.w, hb.x + hb.w) - Math.max(b.x, hb.x));
        const oy = Math.max(0, Math.min(b.y + b.h, hb.y + hb.h) - Math.max(b.y, hb.y));
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const centreIn = cx >= hb.x && cx <= hb.x + hb.w && cy >= hb.y && cy <= hb.y + hb.h;
        if ((ox * oy) / Math.max(1, b.w * b.h) > 0.6 || (centreIn && ox > 0 && oy > 0)) patch.push(o.id);
      }
    }
    if (patch.length) this.store.updateMany(patch, { attachedTo: hosts[0].id }, 'attach to locked');
    return patch.length;
  }

  /** Explain the lock rather than silently doing nothing. */
  hintLocked(n = 1) {
    const now = Date.now();
    if (now - (this._lockHintAt || 0) < 2500) return;
    this._lockHintAt = now;
    this.toast(n > 1 ? `${n} locked items were left alone` : 'This is locked — press the unlock button to edit it', 'lock');
  }

  pickAt(wp) { return pick(this.store, wp, 8 / this.surface.cam.z); }

  /**
   * Convert an on-screen size into board units at the current zoom.
   *
   * Sizes in the toolbar are what you see: a 32px text box placed while zoomed
   * out to 36% would otherwise land as 32 board units and appear 11px tall.
   */
  worldSize(screenPx) { return screenPx / (this.surface.cam.z || 1); }

  /** Does the mouse draw, or does it only pan? */
  get mouseInks() {
    const m = this.settings.inkWithMouse;
    if (m === 'yes') return true;
    if (m === 'no') return false;
    return !this.settings.penSeen;          // auto
  }

  /** Called the first time a stylus touches the tablet. */
  notePenSeen() {
    if (this.settings.penSeen) return;
    this.settings.penSeen = true;
    this.saveSettings();
    if (!this.mouseInks) {
      this.toast('Stylus detected — the mouse now pans instead of drawing', 'pen', 5000);
      this.surface.invalidate();
    }
  }

  /**
   * Remember a colour chosen from the selection bar as the default for the
   * next object of that kind - otherwise every new shape came back black.
   */
  rememberColor(type, key, value) {
    const map = {
      'stroke:color': 'penColor',
      'note:color': 'noteColor',
      'text:color': 'textColor',
      'table:color': 'textColor',
      'shape:stroke': 'shapeStroke',
      'shape:fill': 'shapeFill'
    };
    const setting = map[`${type}:${key}`];
    if (!setting) return;
    this.settings[setting] = value;
    if (setting === 'penColor') this.settings.penEffect = 'none';
    this.saveSettings();
  }

  applyToSelection(patch, onlyType) {
    const ids = this.selected.filter((o) => !onlyType || o.type === onlyType).map((o) => o.id);
    if (ids.length) this.store.updateMany(ids, patch, 'format');
  }

  /** Bring a set of objects into view without selecting them. */
  frameObjects(objs) {
    if (!objs || !objs.length) return;
    let b = null;
    for (const o of objs) {
      const ob = { x: o.x, y: o.y, w: o.w, h: o.h };
      b = b ? {
        x: Math.min(b.x, ob.x), y: Math.min(b.y, ob.y),
        w: Math.max(b.x + b.w, ob.x + ob.w) - Math.min(b.x, ob.x),
        h: Math.max(b.y + b.h, ob.y + ob.h) - Math.min(b.y, ob.y)
      } : ob;
    }
    this.surface.cam.fit(b, this.surface.width, this.surface.height, 90);
    this.syncZoom();
    this.surface.invalidate();
  }

  frameSelection() {
    const b = this.surface.selectionBounds();
    if (!b) return;
    const view = this.surface.cam.viewport(this.surface.width, this.surface.height);
    const fits = b.w < view.w * 0.9 && b.h < view.h * 0.9 &&
      b.x > view.x && b.y > view.y && b.x + b.w < view.x + view.w && b.y + b.h < view.y + view.h;
    if (!fits) this.surface.cam.fit(b, this.surface.width, this.surface.height, 100);
    this.syncZoom();
    this.surface.invalidate();
  }

  beginTextEdit(obj, cell) { this.textEditor.begin(obj, cell); this.syncUI(); }

  /**
   * After typing, hand the board back to the pen.
   *
   * Placing text left you in Select, so the next thing you did with the stylus
   * was drag a marquee instead of writing. Only placement flows arm this - a
   * double-click edit from Select stays in Select.
   */
  armToolRestore() { this.restoreToolAfterEdit = this.lastInkTool || 'pen'; }

  afterTextEdit() {
    const tool = this.restoreToolAfterEdit;
    this.restoreToolAfterEdit = null;
    if (tool) { this.setSelection([]); this.setTool(tool); }
  }
  beginTableEdit(obj, wp) {
    const c = clamp(Math.floor((wp.x - obj.x) / (obj.w / obj.cols)), 0, obj.cols - 1);
    const r = clamp(Math.floor((wp.y - obj.y) / (obj.h / obj.rows)), 0, obj.rows - 1);
    this.textEditor.begin(obj, `${r},${c}`);
  }
  commitTextEdit() { this.textEditor.commit(); }

  addNoteAt(wp) {
    const size = this.worldSize(this.settings.noteSize);
    const o = { id: uid('n'), type: 'note', x: wp.x - size / 2, y: wp.y - size / 2, w: size, h: size, color: this.settings.noteColor, text: '', rotation: 0, align: 'center', font: this.settings.noteFont };
    this.store.add(o, 'note');
    this.armToolRestore();
    if (this.tool !== 'select') this.setTool('select');
    this.setSelection([o.id]);
    this.beginTextEdit(o);
  }

  addTextAt(wp) {
    const fontSize = this.worldSize(this.settings.textSize);
    const o = { id: uid('t'), type: 'text', x: wp.x, y: wp.y - fontSize, w: this.worldSize(360), h: fontSize * 1.6, text: '', rotation: 0, color: this.settings.textColor, fontSize, align: 'left', valign: 'top', font: this.settings.textFont, background: 'none' };
    this.store.add(o, 'text');
    this.armToolRestore();
    if (this.tool !== 'select') this.setTool('select');
    this.setSelection([o.id]);
    this.beginTextEdit(o);
  }

  addTable() {
    const view = this.surface.cam.viewport(this.surface.width, this.surface.height);
    const w = 640, hh = 360;
    const o = {
      id: uid('tb'), type: 'table', x: view.x + view.w / 2 - w / 2, y: view.y + view.h / 2 - hh / 2,
      w, h: hh, rows: 3, cols: 3, rotation: 0, stroke: '#605e5c', fill: '#ffffff', lineWidth: 2,
      headerRow: true, headerColor: '#f3f2f1', cells: {}
    };
    this.store.add(o, 'table');
    this.setSelection([o.id]);
    this.setTool('select');
  }

  applyTemplate(tpl) {
    const objs = tpl.build();
    if (!objs.length) { this.toast('Blank board'); return; }
    if (this.store.count) {
      let box = null;
      for (const o of objs) {
        const b = { x: o.x, y: o.y, w: Math.abs(o.w), h: Math.abs(o.h) };
        box = box ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x), h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y) } : b;
      }
      const target = dropOrigin(this, box.w, box.h);
      const dx = target.x - box.x, dy = target.y - box.y;
      for (const o of objs) { o.x += dx; o.y += dy; }
    }
    this.store.addMany(objs, 'template: ' + tpl.name);
    this.setSelection([]);
    const b = this.store.contentBounds();
    this.surface.cam.fit(b, this.surface.width, this.surface.height);
    this.syncZoom();
    this.surface.invalidate();
    this.toast(tpl.name + ' added');
  }

  /* ---------------- commands ---------------- */
  command(id) {
    const s = this.store, sf = this.surface;
    switch (id) {
      case 'undo': case 'edit.undo': this.textEditor.commit(); s.undo(); this.pruneSelection(); break;
      case 'redo': case 'edit.redo': this.textEditor.commit(); s.redo(); this.pruneSelection(); break;

      case 'edit.delete': {
        const free = withAttached(s, this.selected.filter((o) => !o.locked).map((o) => o.id))
          .filter((id) => !s.get(id)?.locked);
        const held = this.selection.size - free.length;
        if (free.length) s.remove(free);
        if (held) this.hintLocked(held);
        sf.selection.clear();
        break;
      }
      case 'edit.selectAll': this.setSelection(s.doc.order.filter((id) => !s.get(id)?.locked)); this.setTool('select'); break;
      case 'edit.copy': this.copy(); break;
      case 'edit.cut': this.copy(); if (sf.selection.size) { s.remove([...sf.selection]); sf.selection.clear(); } break;
      case 'edit.paste': this.paste(); break;
      case 'edit.duplicate': this.duplicate(); break;
      case 'edit.clear':
        this.confirm('Clear canvas?', 'Everything on this board will be removed. You can undo this.', 'Clear')
          .then((ok) => { if (ok) { s.clear(); sf.selection.clear(); } });
        break;
      case 'edit.lock': {
        const objs = this.selected;
        if (!objs.length) break;
        const lock = !objs.every((o) => o.locked);
        s.updateMany(objs.map((o) => o.id), { locked: lock }, lock ? 'lock' : 'unlock');
        if (lock) this.adoptOverlapping(objs);
        const attached = withAttached(s, objs.map((o) => o.id)).length - objs.length;
        this.toast(lock
          ? 'Locked — it stays put, and anything you draw on it travels with it.'
          : attached
            ? `Unlocked — ${attached} annotation${attached === 1 ? '' : 's'} will move with it`
            : 'Unlocked', lock ? 'lock' : 'unlock');
        break;
      }
      case 'order.front': s.reorder([...sf.selection], 'front'); break;
      case 'order.back': s.reorder([...sf.selection], 'back'); break;
      case 'order.forward': s.reorder([...sf.selection], 'forward'); break;
      case 'order.backward': s.reorder([...sf.selection], 'backward'); break;

      case 'zoomIn': case 'view.zoomIn': sf.cam.zoomAt(sf.width / 2, sf.height / 2, 1.2); this.afterCamera(); break;
      case 'zoomOut': case 'view.zoomOut': sf.cam.zoomAt(sf.width / 2, sf.height / 2, 1 / 1.2); this.afterCamera(); break;
      case 'zoomReset': case 'view.zoomReset': sf.cam.setZoom(1, sf.width / 2, sf.height / 2); this.afterCamera(); break;
      case 'fit': case 'view.fit': {
        const b = s.contentBounds();
        if (b) sf.cam.fit(b, sf.width, sf.height);
        else { sf.cam.z = 1; sf.cam.x = sf.width / 2; sf.cam.y = sf.height / 2; }
        this.afterCamera();
        break;
      }
      case 'ruler': case 'view.ruler': this.toggleRuler(); break;
      case 'view.background': this.panels.background(); break;

      case 'insert.image': pickAndInsertImage(this); break;
      case 'insert.document': pickAndInsertDocument(this); break;
      case 'insert.table': this.addTable(); break;

      case 'export.png': exportPng(this, { scale: 2 }); break;
      case 'export.pngSelection': exportPng(this, { scale: 2, selectionOnly: true }); break;
      case 'export.svg': exportSvg(this); break;
      case 'export.pdf': this.exportPdfWithSetup(); break;
      case 'board.save': saveBoardFile(this); break;
      case 'board.open': openBoardFile(this); break;
      case 'board.new':
        this.confirm('New board?', 'Your current board is saved automatically and stays in "My boards".', 'Create')
          .then((ok) => { if (ok) this.newBoard(); });
        break;
      case 'help.shortcuts': this.showShortcuts(); break;
      case 'help.about': this.showAbout(); break;
      default: break;
    }
    this.syncUI();
    this.surface.invalidate();
  }

  afterCamera() { this.syncZoom(); this.textEditor.reposition(); this.surface.invalidate(); }

  pruneSelection() {
    for (const id of [...this.surface.selection]) if (!this.store.has(id)) this.surface.selection.delete(id);
  }

  toggleRuler() {
    const r = this.ruler;
    r.visible = !r.visible;
    if (r.visible) {
      const v = this.surface.cam.viewport(this.surface.width, this.surface.height);
      r.x = v.x + v.w / 2;
      r.y = v.y + v.h / 2;
      r.length = Math.min(1200, v.w * 0.7);
      r.thickness = 78 / this.surface.cam.z;
      this.toast('Ruler on — drag to move, scroll over it to rotate');
    }
    this.surface.invalidate();
  }

  /* ---------------- clipboard ---------------- */
  copy() {
    this.clipboard = this.selected.map((o) => structuredClone(o));
    if (this.clipboard.length) this.toast(`${this.clipboard.length} item${this.clipboard.length > 1 ? 's' : ''} copied`);
  }

  duplicate() {
    const objs = this.selected;
    if (!objs.length) return;
    const copies = objs.map((o) => this.cloneWithOffset(o, 28, 28));
    this.store.addMany(copies, 'duplicate');
    this.setSelection(copies.map((o) => o.id));
  }

  cloneWithOffset(o, dx, dy) {
    const c = structuredClone(o);
    c.id = uid(o.type[0]);
    if (c.type === 'stroke') {
      for (const p of c.points) { p.x += dx; p.y += dy; }
      c.bbox = { ...c.bbox, x: c.bbox.x + dx, y: c.bbox.y + dy };
    } else { c.x += dx; c.y += dy; }
    delete c.locked;
    return c;
  }

  paste() {
    if (!this.clipboard.length) return;
    const copies = this.clipboard.map((o) => this.cloneWithOffset(o, 32, 32));
    this.store.addMany(copies, 'paste');
    this.setSelection(copies.map((o) => o.id));
    this.clipboard = copies.map((o) => structuredClone(o));
  }

  /* ---------------- UI sync ---------------- */
  syncUI() {
    syncToolbar(this);
    updateSelectionBar(this);
    this.syncZoom();
    this.interaction?.refreshInkCursor?.();
  }

  syncZoom() {
    const pct = Math.round(this.surface.cam.z * 100);
    const el = document.getElementById('zoomLabel');
    if (el) el.textContent = pct + '%';
    if (pct !== this._lastZoomPct) {
      if (this._lastZoomPct !== undefined) this.flashZoom(pct);
      this._lastZoomPct = pct;
    }
  }

  /** A big centred readout while zooming, the way Whiteboard shows it. */
  flashZoom(pct) {
    const pill = document.getElementById('zoomPill');
    if (!pill) return;
    pill.textContent = pct + '%';
    pill.classList.add('show');
    clearTimeout(this._zoomPillTimer);
    this._zoomPillTimer = setTimeout(() => pill.classList.remove('show'), 850);
  }

  showContextMenu(e) { showContextMenu(this, e); }
  hideMenus() { closePopover(); }

  /* ---------------- notifications & dialogs ---------------- */
  toast(message, iconName = 'check', ms = 2600) {
    const host = document.getElementById('toasts');
    const el = h('div', { class: 'toast' }, h('span', { html: icon(iconName, 16), style: 'display:flex' }), h('span', {}, message));
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 260); }, ms);
  }

  /** Ask for page setup, remember the answer, then export. */
  async exportPdfWithSetup() {
    if (!this.store.objects.length) { this.toast('Nothing on the board to export'); return null; }
    const { choosePageSetup } = await import('./ui/pdfdialog.js');
    const b = this.store.contentBounds();
    const box = { x: b.x - 40, y: b.y - 40, w: b.w + 80, h: b.h + 80 };
    const opts = await choosePageSetup(this, box);
    if (!opts) return null;
    Object.assign(this.settings, {
      pdfPaper: opts.paper, pdfOrientation: opts.orientation, pdfMargin: opts.margin,
      pdfMode: opts.mode, pdfQuality: opts.quality
    });
    this.saveSettings();
    return exportPdf(this, opts);
  }

  showProgress(title, text) {
    const overlay = document.getElementById('overlay');
    const card = document.getElementById('overlayCard');
    card.innerHTML = '';
    const label = h('p', {}, text || '');
    const bar = h('div', { class: 'bar' }, h('i', {}));
    card.appendChild(h('h3', {}, title));
    card.appendChild(label);
    card.appendChild(bar);
    overlay.classList.add('show');
    return {
      update: (frac, msg) => { bar.firstChild.style.width = Math.round(clamp(frac, 0, 1) * 100) + '%'; if (msg) label.textContent = msg; },
      close: () => overlay.classList.remove('show')
    };
  }

  confirm(title, text, confirmLabel = 'OK') {
    return new Promise((resolve) => {
      const overlay = document.getElementById('overlay');
      const card = document.getElementById('overlayCard');
      card.innerHTML = '';
      const done = (v) => { overlay.classList.remove('show'); resolve(v); };
      card.appendChild(h('h3', {}, title));
      card.appendChild(h('p', {}, text));
      card.appendChild(h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => done(true) }, confirmLabel)));
      overlay.classList.add('show');
    });
  }

  showShortcuts() {
    const rows = [
      ['h', 'Tools'],
      ['Select', 'V'], ['Lasso select', 'L'], ['Pen', 'P'], ['Highlighter', 'H'], ['Eraser', 'E'],
      ['Sticky note', 'N'], ['Text', 'T'], ['Shape', 'S'], ['Ruler', 'Ctrl+R'],
      ['h', 'Canvas'],
      ['Pan', 'Space + drag, or middle-drag'], ['Zoom', 'Ctrl + wheel, or pinch'],
      ['Pan while drawing', 'Hold any mouse button, or scroll'],
      ['Auto-pan while drawing', 'Run the pen into the edge of the window'],
      ['Zoom in / out', 'Ctrl + = / Ctrl + -'], ['Reset zoom', 'Ctrl+0'], ['Fit to board', 'Ctrl+Shift+F'],
      ['h', 'Editing'],
      ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'], ['Copy / Cut / Paste', 'Ctrl+C / Ctrl+X / Ctrl+V'],
      ['Duplicate', 'Ctrl+D'], ['Delete', 'Delete'], ['Select all', 'Ctrl+A'],
      ['Edit text of selection', 'F2 or double-click'], ['Nudge selection', 'Arrow keys'],
      ['Bring to front / Send to back', 'Ctrl+Shift+] / Ctrl+Shift+['],
      ['Constrain / square', 'Hold Shift while drawing'],
      ['h', 'Files'],
      ['New board', 'Ctrl+N'], ['Open board', 'Ctrl+O'], ['Save a copy', 'Ctrl+S'],
      ['Insert image or document', 'Drag a file onto the canvas']
    ];
    const grid = h('div', { class: 'sc-grid' });
    for (const [a, b] of rows) {
      if (a === 'h') { grid.appendChild(h('h5', {}, b)); continue; }
      grid.appendChild(h('span', {}, a));
      grid.appendChild(h('kbd', {}, b));
    }
    const overlay = document.getElementById('overlay');
    const card = document.getElementById('overlayCard');
    card.innerHTML = '';
    card.appendChild(h('h3', {}, 'Keyboard shortcuts'));
    card.appendChild(grid);
    card.appendChild(h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => overlay.classList.remove('show') }, 'Close')));
    overlay.classList.add('show');
  }

  async showAbout() {
    const i = await window.board.info();
    const overlay = document.getElementById('overlay');
    const card = document.getElementById('overlayCard');
    card.innerHTML = '';
    card.appendChild(h('h3', { style: 'margin-bottom:2px' }, 'GazBoard ' + i.version));
    card.appendChild(h('p', {
      style: 'margin:0 0 14px;font-size:13px;color:var(--text-2);letter-spacing:.02em',
      html: 'by <b style="color:var(--accent)">theBoringCode</b>'
    }));
    card.appendChild(h('p', { html:
      `A free-form digital whiteboard for pen, sticky notes, shapes, text, images and documents.` +
      `<br><br>Runs entirely on this computer — no account, no sign-in, no cloud.` }));
    card.appendChild(h('div', {
      style: 'margin-top:14px;padding-top:12px;border-top:1px solid var(--stroke);font-size:12.5px;line-height:1.8;color:var(--text-2)',
      html:
        `Developer &nbsp;<b style="color:var(--text)">MD. Fakhruddin Gazzali</b><br>` +
        `Contact &nbsp;<a href="mailto:fahim9778@gmail.com" target="_blank" style="color:var(--accent)">fahim9778@gmail.com</a><br>` +
        `Created with <span style="color:#e81123">&hearts;</span> with Claude Cowork` }));
    card.appendChild(h('div', {
      style: 'margin-top:12px;font-size:11.5px;color:var(--text-2);line-height:1.7',
      html:
        `Office import: <b>${i.libreoffice ? 'LibreOffice detected (high fidelity)' : 'built-in converter (install LibreOffice for higher fidelity)'}</b><br>` +
        `Electron ${i.electron} · Chromium ${i.chrome}` }));
    card.appendChild(h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => overlay.classList.remove('show') }, 'Close')));
    overlay.classList.add('show');
  }

  /* ---------------- global events ---------------- */
  wireGlobalEvents() {
    const titleEl = document.getElementById('boardTitle');
    titleEl.addEventListener('change', () => this.store.rename(titleEl.value.trim() || 'Untitled board'));
    titleEl.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') titleEl.blur(); });

    window.board.onMenu((id) => this.command(id));

    // The main process asks for a flush before it quits; write out anything the
    // autosave debounce is still sitting on.
    window.board.onFlush(async () => {
      try {
        this.textEditor.commit();
        await this.persist();
      } catch (e) { console.warn('flush failed:', e); }
    });

    // Losing focus is the cheapest moment to make sure work is on disk - it is
    // what happens just before someone alt-tabs away and shuts the machine down.
    window.addEventListener('blur', () => {
      if (this.settings.autosave) this.persist();
    });
    window.board.onOpenFile((data) => this.loadBoard(data));
    window.board.onWindowResized(() => {
      // the window changed shape - re-measure now and again after layout settles
      this.surface.resize();
      requestAnimationFrame(() => { this.surface.resize(); this.textEditor.reposition(); this.syncUI(); });
    });

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => { if (e.code === 'Space') this.interaction.spaceDown = false; });
    window.addEventListener('blur', () => { this.interaction.spaceDown = false; });

    // paste from the system clipboard
    document.addEventListener('paste', async (e) => {
      if (this.textEditor.active) return;
      const items = [...(e.clipboardData?.items || [])];
      const imageItem = items.find((i) => i.type.startsWith('image/'));
      if (imageItem) {
        e.preventDefault();
        const file = imageItem.getAsFile();
        const view = this.surface.cam.viewport(this.surface.width, this.surface.height);
        await insertImageFiles(this, [file], { x: view.x + view.w / 2, y: view.y + view.h / 2 });
        return;
      }
      const text = e.clipboardData?.getData('text/plain');
      if (text && text.trim()) {
        e.preventDefault();
        const view = this.surface.cam.viewport(this.surface.width, this.surface.height);
        const o = {
          id: uid('t'), type: 'text', x: view.x + view.w / 2 - 200, y: view.y + view.h / 2 - 40,
          w: this.worldSize(420), h: Math.max(this.worldSize(60), text.split('\n').length * this.worldSize(this.settings.textSize) * 1.3),
          text: text.trim(), rotation: 0, color: this.settings.textColor, fontSize: this.worldSize(this.settings.textSize),
          align: 'left', valign: 'top', font: this.settings.textFont, background: 'none'
        };
        this.store.add(o, 'paste text');
        this.setSelection([o.id]);
        return;
      }
      if (this.clipboard.length) { e.preventDefault(); this.paste(); }
    });

    // drag & drop files
    const stage = document.getElementById('stage');
    stage.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    stage.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files || [])];
      if (!files.length) return;
      const at = this.surface.toWorld(e);
      const paths = files.map((f) => f.path).filter(Boolean);
      if (paths.length) {
        const imgs = paths.filter(isImagePath);
        const docs = paths.filter(isDocPath);
        if (imgs.length) await insertImagesFromPaths(this, imgs);
        for (const d of docs) await insertDocument(this, d);
        if (!imgs.length && !docs.length) this.toast('Unsupported file type');
      } else {
        await insertImageFiles(this, files, at);
      }
    });

    window.addEventListener('resize', () => this.textEditor.reposition());
    document.addEventListener('wheel', () => this.textEditor.reposition(), { passive: true });
    window.addEventListener('beforeunload', () => {
      if (this.settings.autosave) this.persist();
    });
  }

  onKeyDown(e) {
    if (this.textEditor.active) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const mod = e.ctrlKey || e.metaKey;

    if (e.code === 'Space') { this.interaction.spaceDown = true; e.preventDefault(); return; }

    if (mod) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); this.command('undo'); return; }
      if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); this.command('redo'); return; }
      if (k === 'a') { e.preventDefault(); this.command('edit.selectAll'); return; }
      if (k === 'c') { this.command('edit.copy'); return; }
      if (k === 'x') { this.command('edit.cut'); return; }
      if (k === 'd') { e.preventDefault(); this.command('edit.duplicate'); return; }
      if (k === 's') { e.preventDefault(); this.command('board.save'); return; }
      if (k === 'o') { e.preventDefault(); this.command('board.open'); return; }
      if (k === 'n') { e.preventDefault(); this.command('board.new'); return; }
      if (k === 'r') { e.preventDefault(); this.command('ruler'); return; }
      if (k === '0') { e.preventDefault(); this.command('zoomReset'); return; }
      if (k === '=' || k === '+') { e.preventDefault(); this.command('zoomIn'); return; }
      if (k === '-') { e.preventDefault(); this.command('zoomOut'); return; }
      if (k === 'f' && e.shiftKey) { e.preventDefault(); this.command('fit'); return; }
      if (k === ']') { e.preventDefault(); this.command(e.shiftKey ? 'order.front' : 'order.forward'); return; }
      if (k === '[') { e.preventDefault(); this.command(e.shiftKey ? 'order.back' : 'order.backward'); return; }
      return;
    }

    switch (e.key) {
      case 'Delete': case 'Backspace': e.preventDefault(); this.command('edit.delete'); return;
      case 'Escape':
        if (this.panels.open) this.panels.close();
        else { closePopover(); this.setSelection([]); }
        return;
      case 'F2': {
        const o = this.selected[0];
        if (o && ['note', 'text', 'shape', 'table'].includes(o.type)) this.beginTextEdit(o);
        return;
      }
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        if (!this.surface.selection.size) return;
        e.preventDefault();
        const step = (e.shiftKey ? 20 : 2) / this.surface.cam.z;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const ids = withAttached(this.store, [...this.surface.selection])
          .filter((id) => !this.store.get(id)?.locked);
        if (!ids.length) { this.hintLocked(); return; }
        const snap = this.store.snapshot(ids);
        for (const id of ids) {
          const o = this.store.get(id);
          if (!o) continue;
          if (o.type === 'stroke') { for (const p of o.points) { p.x += dx; p.y += dy; } o.bbox.x += dx; o.bbox.y += dy; }
          else { o.x += dx; o.y += dy; }
        }
        this.store.commitSnapshot('nudge', snap);
        return;
      }
    }

    const keyTool = { v: 'select', l: 'lasso', p: 'pen', h: 'highlighter', e: 'eraser', n: 'note', t: 'text', s: 'shape' }[e.key.toLowerCase()];
    if (keyTool) { this.setTool(keyTool); return; }
    if (e.key === '?') this.showShortcuts();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
