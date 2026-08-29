'use strict';
// Headless smoke test: drives the real renderer through every subsystem and
// writes screenshots to test/out/. Run with:  npm run smoke
const path = require('node:path');
const fs = require('node:fs/promises');

const OUT = process.env.GAZBOARD_SMOKE_OUT || path.join(__dirname, 'out');
const FIX = path.join(__dirname, 'fixtures');

let pass = 0, fail = 0;
const results = [];
function check(name, ok, detail) {
  (ok ? pass++ : fail++);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  — ' + detail : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  await fs.writeFile(path.join(OUT, name + '.png'), img.toPNG());
}

async function run(win, app) {
  await fs.mkdir(OUT, { recursive: true });
  const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`, true);

  await sleep(900);

  await js(`window.app.newBoard(true);`);
  await sleep(200);

  /* ---- boot ---- */
  check('app boots', await js(`return !!window.app && !!window.app.store;`));
  check('canvas sized', (await js(`return window.app.surface.width;`)) > 100);

  /* ---- ink ---- */
  await js(`
    const a = window.app;
    a.setTool('pen');
    const pts = [];
    for (let i = 0; i < 40; i++) pts.push({ x: -300 + i * 8, y: -100 + Math.sin(i / 4) * 40, p: 0.4 + (i % 7) / 14 });
    a.store.add({ id: 'stroke-test', type: 'stroke', tool: 'pen', color: '#e81123', width: 6, effect: 'none',
      points: pts, bbox: { x: -300, y: -145, w: 320, h: 90 }, rotation: 0 }, 'test');
  `);
  check('stroke added', await js(`return window.app.store.has('stroke-test');`));

  /* ---- shape recognition ---- */
  const rec = await js(`
    const { recognize } = await import('app://board/js/core/recognize.js');
    const box = [];
    for (let i = 0; i <= 30; i++) box.push({ x: i * 6, y: 0 });
    for (let i = 0; i <= 20; i++) box.push({ x: 180, y: i * 6 });
    for (let i = 30; i >= 0; i--) box.push({ x: i * 6, y: 120 });
    for (let i = 20; i >= 0; i--) box.push({ x: 0, y: i * 6 });
    const circle = [];
    for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; circle.push({ x: 100 + Math.cos(a) * 90, y: 100 + Math.sin(a) * 90 }); }
    const line = [];
    for (let i = 0; i <= 24; i++) line.push({ x: i * 10, y: i * 2 });
    const tri = [];
    for (let i = 0; i <= 16; i++) tri.push({ x: 100 - i * 6, y: i * 8 });
    for (let i = 0; i <= 16; i++) tri.push({ x: 4 + i * 12, y: 128 });
    for (let i = 0; i <= 16; i++) tri.push({ x: 196 - i * 6, y: 128 - i * 8 });
    return {
      rect: recognize(box)?.kind, circle: recognize(circle)?.kind,
      line: recognize(line)?.kind, tri: recognize(tri)?.kind
    };
  `);
  check('recognises rectangle', rec.rect === 'rect', JSON.stringify(rec.rect));
  check('recognises circle', rec.circle === 'circle' || rec.circle === 'ellipse', String(rec.circle));
  check('recognises line', rec.line === 'line', String(rec.line));
  check('recognises triangle', rec.tri === 'triangle', String(rec.tri));

  /* ---- notes, text, shapes, table ---- */
  await js(`
    const a = window.app;
    a.addNoteAt({ x: 200, y: -200 }); a.textEditor.cancel();
    const noteObj = a.store.objects.filter(o => o.type === 'note').pop();
    a.store.update(noteObj.id, { text: 'Sticky note' });
    a.addTextAt({ x: 200, y: 60 }); a.textEditor.cancel();
    a.store.add({ id: 'shape-test', type: 'shape', kind: 'roundRect', x: -320, y: 80, w: 240, h: 150,
      rotation: 0, stroke: '#0078d4', fill: '#bfdbfe', lineWidth: 3, text: 'Shape with text' }, 'test');
    a.addTable();
    const tableObj = a.store.objects.filter(o => o.type === 'table').pop();
    a.store.update(tableObj.id, { cells: { '0,0': 'A', '0,1': 'B', '1,0': '1' } });
  `);
  const counts = await js(`
    const t = {};
    for (const o of window.app.store.objects) t[o.type] = (t[o.type] || 0) + 1;
    return t;
  `);
  check('note created', counts.note >= 1, JSON.stringify(counts));
  check('shape created', counts.shape >= 1);
  check('table created', counts.table >= 1);

  /* ---- undo / redo ---- */
  const undoOk = await js(`
    const a = window.app, n0 = a.store.count;
    a.store.add({ id: 'tmp-undo', type: 'shape', kind: 'rect', x: 0, y: 0, w: 10, h: 10, rotation: 0, stroke: '#000', fill: 'none', lineWidth: 2 });
    const n1 = a.store.count; a.store.undo();
    const n2 = a.store.count; a.store.redo();
    const n3 = a.store.count; a.store.undo();
    return n1 === n0 + 1 && n2 === n0 && n3 === n0 + 1 && a.store.count === n0;
  `);
  check('undo / redo round-trips', undoOk);

  /* ---- transforms ---- */
  const moved = await js(`
    const a = window.app;
    const { translateObject, scaleObject, rotateObjectAround } = await import('app://board/js/core/transform.js');
    const o = a.store.get('shape-test');
    const x0 = o.x; translateObject(o, 40, 0);
    const x1 = o.x; scaleObject(o, 2, 2, o.x, o.y);
    const w1 = o.w; rotateObjectAround(o, Math.PI / 8, o.x, o.y);
    return { dx: x1 - x0, w1, rot: o.rotation };
  `);
  check('translate/scale/rotate work', moved.dx === 40 && moved.w1 === 480 && moved.rot > 0, JSON.stringify(moved));

  /* ---- hit testing ---- */
  const hit = await js(`
    const { pick, inBox } = await import('app://board/js/core/hit.js');
    const a = window.app;
    const o = a.store.get('shape-test');
    const inside = pick(a.store, { x: o.x + o.w / 2, y: o.y + o.h / 2 }, 4);
    const outside = pick(a.store, { x: o.x - 4000, y: o.y - 4000 }, 4);
    const box = inBox(a.store, { x: -5000, y: -5000, w: 10000, h: 10000 });
    return { inside: inside && inside.id, outside: !!outside, boxCount: box.length };
  `);
  check('hit test finds object', hit.inside === 'shape-test', JSON.stringify(hit));
  check('hit test misses empty space', hit.outside === false);
  check('marquee selects everything', hit.boxCount === (await js(`return window.app.store.count;`)));

  /* ---- erasing ---- */
  const erase = await js(`
    const a = window.app;
    const it = a.interaction;
    const mk = (id) => {
      const pts = [];
      for (let i = 0; i <= 100; i++) pts.push({ x: i * 5, y: 600, p: 0.5 });
      return { id, type: 'stroke', tool: 'pen', color: '#111', width: 4, effect: 'none',
               points: pts, bbox: { x: 0, y: 600, w: 500, h: 0 }, rotation: 0 };
    };
    const sweep = (from, to) => { it.startErase(from); it.eraseSweep(it.action, from, to); it.finishErase(it.action); it.action = null; };

    a.surface.cam.z = 1;
    const before = a.store.count;

    // 1. partial: a stroke cut through the middle becomes two
    a.store.add(mk('erase-a'));
    a.settings.eraserMode = 'partial'; a.settings.eraserSize = 40;
    sweep({ x: 250, y: 540 }, { x: 250, y: 660 });
    const frags = a.store.objects.filter(o => o.type === 'stroke' && Math.abs(o.bbox.y - 600) < 5);
    const gone = !a.store.has('erase-a');
    const gap = frags.length === 2
      ? Math.round(Math.min(...frags.map(f => Math.max(f.bbox.x, 0) + f.bbox.w)) * 0) || true : false;

    // 2. undo puts the original back, intact
    a.store.undo();
    const restored = a.store.get('erase-a');
    const restoredPts = restored ? restored.points.length : 0;

    // 3. a near miss leaves the ink alone
    sweep({ x: 250, y: 200 }, { x: 250, y: 300 });
    const untouched = a.store.has('erase-a') && a.store.get('erase-a').points.length === 101;

    // 4. object mode takes the whole stroke
    a.settings.eraserMode = 'object';
    sweep({ x: 250, y: 540 }, { x: 250, y: 660 });
    const wholeGone = !a.store.has('erase-a');
    a.store.undo();

    // 5. partial erase off the end of a stroke leaves a single shorter run
    a.settings.eraserMode = 'partial';
    sweep({ x: 500, y: 540 }, { x: 500, y: 660 });
    const tail = a.store.objects.filter(o => o.type === 'stroke' && Math.abs(o.bbox.y - 600) < 5);

    // clean up
    while (a.store.canUndo && a.store.count > before) a.store.undo();
    a.settings.eraserMode = 'partial';
    return {
      fragCount: frags.length, gone, restoredPts, untouched, wholeGone,
      tailCount: tail.length, tailW: tail[0] ? Math.round(tail[0].bbox.w) : -1,
      cleanCount: a.store.count, before
    };
  `);
  check('partial erase splits a stroke in two', erase.fragCount === 2 && erase.gone, JSON.stringify({ frags: erase.fragCount, originalGone: erase.gone }));
  check('undo restores the erased stroke', erase.restoredPts === 101, erase.restoredPts + ' points');
  check('eraser near-miss leaves ink alone', erase.untouched);
  check('object mode erases the whole stroke', erase.wholeGone);
  check('erasing an end leaves one shorter run', erase.tailCount === 1 && erase.tailW < 500 && erase.tailW > 400, `${erase.tailCount} run(s), width ${erase.tailW}`);

  /* ---- the canvas must always fill the window ---- */
  const fits = async (label) => js(`
    const sf = window.app.surface, c = sf.canvas;
    const stage = document.getElementById('stage');
    const r = c.getBoundingClientRect(), s = stage.getBoundingClientRect();
    return {
      label: ${JSON.stringify(label)},
      elementFillsStage: Math.abs(r.width - s.width) < 1.5 && Math.abs(r.height - s.height) < 1.5,
      bufferMatches: c.width === Math.round(r.width * sf.dpr) && c.height === Math.round(r.height * sf.dpr),
      inlineSize: (c.style.width || '') + (c.style.height || ''),
      w: Math.round(r.width), h: Math.round(r.height), stageW: Math.round(s.width), dpr: sf.dpr,
      surfaceW: sf.width
    };
  `);

  const sizes = [];
  sizes.push(await fits('initial'));
  win.setSize(1100, 780); await sleep(400); sizes.push(await fits('shrunk'));
  win.setSize(1500, 950); await sleep(400); sizes.push(await fits('grown'));
  win.maximize(); await sleep(600); sizes.push(await fits('maximised'));
  win.unmaximize(); await sleep(600); sizes.push(await fits('restored'));
  // a zoom-factor change moves devicePixelRatio without any window resize -
  // the same shape as a Windows display-scaling change
  win.webContents.setZoomFactor(1.25); await sleep(500); sizes.push(await fits('dpr 1.25'));
  win.webContents.setZoomFactor(1); await sleep(500); sizes.push(await fits('dpr back'));
  win.setSize(1440, 900); await sleep(400);

  const bad = sizes.filter((s) => !s.elementFillsStage || !s.bufferMatches);
  check('canvas fills the window at every size', bad.length === 0,
    bad.length ? bad.map((b) => `${b.label}: canvas ${b.w}x${b.h} vs stage ${b.stageW}`).join('; ')
      : sizes.map((s) => `${s.label} ${s.w}x${s.h}@${s.dpr}`).join(', '));
  check('no inline size is pinned on the canvas', sizes.every((s) => s.inlineSize === ''), sizes[0].inlineSize || '(none)');
  check('the surface tracks the new size', sizes.every((s) => s.surfaceW === s.w));

  const heal = await js(`
    // simulate the old bug: pin a stale size, then let the frame loop notice
    const sf = window.app.surface, c = sf.canvas;
    sf.width = 640; sf.height = 480; c.width = 640; c.height = 480;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 120));
    const r2 = c.getBoundingClientRect();
    return { w: c.width, expected: Math.round(r2.width * sf.dpr), surfaceW: sf.width, boxW: Math.round(r2.width) };
  `);
  check('a stale buffer self-corrects within a frame', heal.w === heal.expected && heal.surfaceW === heal.boxW,
    `buffer ${heal.w}, expected ${heal.expected}`);

  /* ---- HiDPI: the whole buffer must be painted ---- */
  const hidpi = await js(`
    const sf = window.app.surface, c = sf.canvas, ctx = sf.ctx;
    const a = window.app;
    a.store.setBackground({ color: '#ffffff', pattern: 'none' });
    const realDpr = sf.dpr;
    const probe = (dpr) => {
      // paint as if the display were scaled, then read the far corner
      sf.dpr = dpr;
      c.width = Math.round(sf.width * dpr);
      c.height = Math.round(sf.height * dpr);
      sf.draw();
      const far = ctx.getImageData(c.width - 2, c.height - 2, 1, 1).data;
      const mid = ctx.getImageData(Math.round(c.width / 2), Math.round(c.height / 2), 1, 1).data;
      return { dpr, far: [far[0], far[1], far[2]], mid: [mid[0], mid[1], mid[2]] };
    };
    const out = [1, 1.25, 1.5, 2].map(probe);
    sf.dpr = realDpr; sf.resize(true); sf.draw();
    return out;
  `);
  const painted = (p) => p.far[0] > 240 && p.far[1] > 240 && p.far[2] > 240;
  check('background covers the canvas at every scale factor', hidpi.every(painted),
    hidpi.map((p) => `${p.dpr}x rgb(${p.far})`).join(', '));

  const chrome = await js(`
    const sf = window.app.surface, a = window.app;
    // selection chrome is drawn in screen space - it must land on the object
    // at any scale, not at 1/dpr of the way across the canvas
    a.newBoard(true);
    sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    const o = { id: 'dpi-box', type: 'shape', kind: 'rect', x: 60, y: 60, w: 200, h: 120,
                rotation: 0, stroke: '#000000', fill: '#000000', lineWidth: 2 };
    a.store.add(o);
    a.setSelection(['dpi-box']);
    const realDpr = sf.dpr;
    const probe = (dpr) => {
      sf.dpr = dpr;
      sf.canvas.width = Math.round(sf.width * dpr);
      sf.canvas.height = Math.round(sf.height * dpr);
      sf.draw();
      // the handle sits at the shape's top-left corner: world (60,60) -> device (60*dpr)
      const d = sf.ctx.getImageData(Math.round(60 * dpr), Math.round(60 * dpr), 1, 1).data;
      // blue selection handle stroke or white handle fill, never the page background alone
      return { dpr, px: [d[0], d[1], d[2]] };
    };
    const out = [1, 1.5, 2].map(probe);
    sf.dpr = realDpr; sf.resize(true); a.store.clear(); a.setSelection([]); sf.draw();
    return out;
  `);
  check('selection chrome lands on the object at every scale factor',
    chrome.every((p) => !(p.px[0] > 250 && p.px[1] > 250 && p.px[2] > 250)),
    chrome.map((p) => `${p.dpr}x rgb(${p.px})`).join(', '));

  /* ---- placing text and notes, then getting hold of them again ---- */
  const place = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.settings.inkWithMouse = 'yes';
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y) => ({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.5 });
    const click = (x, y) => { it.onDown(ev(x, y)); it.onMove(ev(x, y)); it.onUp(ev(x, y)); it.action = null; it.pointers.clear(); };

    // 1. a note placed at 100% zoom
    a.setTool('note');
    click(300, 300);
    a.textEditor.cancel();
    const note = a.store.objects.find(o => o.type === 'note');
    const noteAt100 = note ? Math.round(note.w) : 0;
    const toolAfterNote = a.tool;                 // should have returned to Select

    // 2. the same note placed while zoomed out - it must still look the same size
    a.store.clear();
    sf.cam.z = 0.36;
    a.setTool('note');
    click(300, 300);
    a.textEditor.cancel();
    const zoomedNote = a.store.objects.find(o => o.type === 'note');
    const onScreen = zoomedNote ? Math.round(zoomedNote.w * sf.cam.z) : 0;

    // 3. text placed while zoomed out is legible, not 11px tall
    a.store.clear();
    a.setTool('text');
    click(400, 400);
    if (a.textEditor.active) a.textEditor.el.value = 'hello';
    a.textEditor.commit();
    const txt = a.store.objects.find(o => o.type === 'text');
    const textOnScreen = txt ? Math.round(txt.fontSize * sf.cam.z) : 0;
    const toolAfterText = a.tool;

    // 4. clicking existing text with the Text tool selects it instead of stacking a new one
    sf.cam.z = 1;
    const countBefore = a.store.count;
    a.setTool('text');
    click(Math.round(txt.x + txt.w / 2), Math.round(txt.y + txt.h / 2));
    const countAfter = a.store.count;
    const selectedText = [...sf.selection][0] === txt.id;
    const editing = a.textEditor.active;
    a.textEditor.cancel();

    // 5. and it can then be dragged
    a.setTool('select');
    const x0 = a.store.get(txt.id).x;
    it.onDown(ev(Math.round(txt.x + txt.w / 2), Math.round(txt.y + txt.h / 2)));
    const started = it.action ? it.action.type : 'none';
    it.onMove(ev(Math.round(txt.x + txt.w / 2) + 60, Math.round(txt.y + txt.h / 2)));
    it.onUp(ev(Math.round(txt.x + txt.w / 2) + 60, Math.round(txt.y + txt.h / 2)));
    it.action = null; it.pointers.clear();
    const moved = Math.round(a.store.get(txt.id).x - x0);

    a.settings.inkWithMouse = 'auto'; a.setTool('select'); a.store.clear();
    return { noteAt100, toolAfterNote, onScreen, textOnScreen, toolAfterText,
             countBefore, countAfter, selectedText, editing, started, moved,
             defaultText: a.settings.textSize };
  `);
  // Placing hands the board back to the ink tool, so the next stylus touch
  // writes. The placement tool must not still be armed either, or the click
  // after would drop a second note.
  check('placing a note does not leave the Note tool armed', place.toolAfterNote !== 'note', place.toolAfterNote);
  check('placing text does not leave the Text tool armed', place.toolAfterText !== 'text', place.toolAfterText);
  check('a note keeps its on-screen size when zoomed out',
    Math.abs(place.onScreen - place.noteAt100) <= 2, `${place.noteAt100}px at 100%, ${place.onScreen}px at 36%`);
  check('text placed while zoomed out is still legible', place.textOnScreen >= 24,
    place.textOnScreen + 'px on screen (default ' + place.defaultText + ')');
  check('clicking existing text selects it instead of adding another',
    place.countAfter === place.countBefore && place.selectedText,
    `${place.countBefore} -> ${place.countAfter}`);
  check('clicking existing text opens it for editing', place.editing);
  check('text can then be dragged', place.started === 'move' && place.moved === 60,
    `${place.started}, moved ${place.moved}`);

  const after = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.settings.inkWithMouse = 'yes';
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y, type) => ({ pointerId: 1, pointerType: type || 'mouse', button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.5 });
    const click = (x, y, type) => { it.onDown(ev(x, y, type)); it.onMove(ev(x, y, type)); it.onUp(ev(x, y, type)); it.action = null; it.pointers.clear(); };

    a.setTool('pen');                       // the tool in hand before typing
    a.setTool('text');
    click(400, 400);
    if (a.textEditor.active) a.textEditor.el.value = 'hi';
    a.textEditor.commit();
    const toolAfterTyping = a.tool;         // should be back to the pen
    const box = a.store.objects.find(o => o.type === 'text');
    const fitted = box ? { w: Math.round(box.w), h: Math.round(box.h), size: box.fontSize } : null;

    // the very next stylus touch must draw, not marquee
    it.onDown(ev(600, 600, 'pen'));
    const strokeStarted = it.action ? it.action.type : 'none';
    it.onMove(ev(650, 640, 'pen'));
    it.onUp(ev(650, 640, 'pen'));
    it.action = null; it.pointers.clear();
    const inked = a.store.objects.filter(o => o.type === 'stroke').length;

    // a long line wraps rather than growing forever
    a.setTool('text');
    click(200, 800);
    if (a.textEditor.active) a.textEditor.el.value = 'a much longer line of text that has to wrap somewhere sensible';
    a.textEditor.commit();
    const boxes = a.store.objects.filter(o => o.type === 'text');
    const longBox = boxes[boxes.length - 1];

    // double-clicking from Select stays in Select
    a.setTool('select');
    const live = a.store.objects.find(o => o.type === 'text');
    let toolAfterSelectEdit = 'no-text-object';
    if (live) {
      a.setSelection([live.id]);
      a.beginTextEdit(live);
      a.textEditor.commit();
      toolAfterSelectEdit = a.tool;
    }

    a.settings.inkWithMouse = 'auto'; a.setTool('select'); a.store.clear();
    return { toolAfterTyping, fitted, strokeStarted, inked,
             boxes: boxes.length,
             longW: longBox ? Math.round(longBox.w) : -1,
             longH: longBox ? Math.round(longBox.h) : -1,
             toolAfterSelectEdit };
  `);
  check('typing hands the board back to the pen', after.toolAfterTyping === 'pen', after.toolAfterTyping);
  check('a stylus placed straight after typing draws',
    after.strokeStarted === 'draw' && after.inked === 1, `${after.strokeStarted}, ${after.inked} stroke`);
  check('the text box shrinks to the text',
    after.fitted.w < 90 && after.fitted.h < after.fitted.size * 2,
    `${after.fitted.w}x${after.fitted.h} for "hi" at ${after.fitted.size}px`);
  check('a long line wraps instead of running away',
    after.longW <= 360 && after.longH > after.fitted.h,
    `${after.longW}x${after.longH}`);
  check('editing from Select stays in Select', after.toolAfterSelectEdit === 'select', after.toolAfterSelectEdit);

  /* ---- straightening is opt-in, and never eats your ink ---- */
  const straighten = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.settings.inkWithMouse = 'yes';
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y) => ({ pointerId: 1, pointerType: 'pen', button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.6 });
    const box = () => {
      const path = [];
      for (let i = 0; i <= 30; i++) path.push([100 + i * 6, 100]);
      for (let i = 0; i <= 20; i++) path.push([280, 100 + i * 6]);
      for (let i = 30; i >= 0; i--) path.push([100 + i * 6, 220]);
      for (let i = 20; i >= 0; i--) path.push([100, 100 + i * 6]);
      a.setTool('pen');
      it.onDown(ev(path[0][0], path[0][1]));
      for (const p of path.slice(1)) it.onMove(ev(p[0], p[1]));
      it.onUp(ev(path[path.length - 1][0], path[path.length - 1][1]));
      it.action = null; it.pointers.clear();
    };
    const kinds = () => a.store.objects.map(o => o.type).sort().join(',');

    // default: ink is left exactly as drawn
    const defaultSetting = a.settings.inkToShape;
    a.store.clear();
    box();
    const withDefault = kinds();

    // switched on: the box straightens...
    a.store.clear();
    a.settings.inkToShape = true;
    box();
    const converted = kinds();

    // ...and one undo gives the handwriting back, rather than deleting it
    a.store.undo();
    const afterUndo = kinds();
    const inkPoints = (a.store.objects.find(o => o.type === 'stroke') || {}).points;
    a.store.undo();
    const afterSecondUndo = a.store.count;

    a.settings.inkToShape = false; a.settings.inkWithMouse = 'auto';
    a.setTool('select'); a.store.clear();
    return { defaultSetting, withDefault, converted, afterUndo,
             inkKept: Array.isArray(inkPoints) && inkPoints.length > 20, afterSecondUndo };
  `);
  check('straightening is off by default', straighten.defaultSetting === false);
  check('by default ink is kept exactly as drawn', straighten.withDefault === 'stroke', straighten.withDefault);
  check('switched on, a drawn box becomes a shape', straighten.converted === 'shape', straighten.converted);
  check('one undo returns the original ink, not nothing',
    straighten.afterUndo === 'stroke' && straighten.inkKept, straighten.afterUndo);
  check('a second undo clears it', straighten.afterSecondUndo === 0);

  const fidelity = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.settings.inkToShape = false; a.settings.inkWithMouse = 'yes';
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y) => ({ pointerId: 1, pointerType: 'pen', button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.6 });

    const path = [];
    for (let t = 0; t <= Math.PI * 5; t += 0.06)
      path.push([120 + t * 22, 300 + 26 * Math.sin(t) + 9 * Math.sin(2.6 * t)]);

    a.setTool('pen');
    it.onDown(ev(path[0][0], path[0][1]));
    for (const p of path.slice(1)) it.onMove(ev(p[0], p[1]));

    // snapshot the wet stroke as rendered, then lift and render again
    const shot = () => { sf.draw(); return sf.ctx.getImageData(80 * sf.dpr, 240 * sf.dpr, 520 * sf.dpr, 140 * sf.dpr).data; };
    const wetPoints = sf.wet.points.length;
    const before = shot();
    it.onUp(ev(path[path.length-1][0], path[path.length-1][1]));
    it.action = null; it.pointers.clear();
    const after = shot();

    let diff = 0;
    for (let i = 0; i < before.length; i += 4) if (Math.abs(before[i] - after[i]) > 24) diff++;
    const s = a.store.objects.find(o => o.type === 'stroke');

    a.settings.inkWithMouse = 'auto'; a.setTool('select'); a.store.clear();
    return { wetPoints, storedPoints: s.points.length, changedPixels: diff,
             total: before.length / 4 };
  `);
  check('lifting the pen keeps every point', fidelity.storedPoints === fidelity.wetPoints,
    `${fidelity.wetPoints} while drawing, ${fidelity.storedPoints} after`);
  // The stroke you were watching must not be redrawn differently when you lift.
  check('the stroke does not change shape when you lift',
    fidelity.changedPixels < fidelity.total * 0.002,
    `${fidelity.changedPixels} of ${fidelity.total} pixels differ`);

  const misfire = await js(`
    const { recognize, fitError, MAX_FIT_ERROR } = await import('app://board/js/core/recognize.js');
    const mk = (fn, n, step) => { const P = []; for (let i = 0; i <= n; i += step) P.push(fn(i)); return P; };

    // a deliberate circle: should classify and fit
    const circle = mk(i => ({ x: 200 + Math.cos(i / 40 * Math.PI * 2) * 90,
                              y: 200 + Math.sin(i / 40 * Math.PI * 2) * 90, p: 0.5 }), 40, 1);
    const cr = recognize(circle);
    const cfit = cr ? fitError(circle, cr.kind, cr) : 1;

    // a scribble: a loop with a wild excursion. It can still satisfy the corner
    // and variance tests, which is where a wrong shape used to come from.
    const scribble = [];
    for (let i = 0; i <= 60; i++) {
      const a2 = i / 60 * Math.PI * 2;
      const wob = 1 + 0.55 * Math.sin(a2 * 7) + 0.3 * Math.sin(a2 * 13);
      scribble.push({ x: 200 + Math.cos(a2) * 90 * wob, y: 200 + Math.sin(a2) * 90 * wob, p: 0.5 });
    }
    const sr = recognize(scribble);
    const sfit = sr ? fitError(scribble, sr.kind, sr) : 1;

    return { circleKind: cr && cr.kind, cfit: +cfit.toFixed(3),
             scribbleKind: sr && sr.kind, sfit: +sfit.toFixed(3), max: MAX_FIT_ERROR };
  `);
  check('a deliberate circle passes the fit test',
    (misfire.circleKind === 'circle' || misfire.circleKind === 'ellipse') && misfire.cfit < misfire.max,
    `${misfire.circleKind}, fit error ${misfire.cfit}`);
  check('a scribble is rejected rather than forced into a shape',
    misfire.sfit > misfire.max,
    `classified ${misfire.scribbleKind}, fit error ${misfire.sfit} vs limit ${misfire.max}`);

  /* ---- toolbar, deselect, zoom pill, fonts, lock adoption ---- */
  const toolbar = await js(`
    const a = window.app;
    const bar = document.getElementById('toolbar');
    const pens = [...bar.querySelectorAll('.pen[data-pen]')];
    const { PENS } = await import('app://board/js/ui/palettes.js');

    // clicking the red pen selects the pen tool in red
    const red = pens.find(p => p.dataset.pen === 'red');
    red.click();
    const afterRed = { tool: a.tool, color: a.settings.penColor, raised: red.classList.contains('active') };

    // the raised pen follows the setting, and only one is raised
    const galaxy = pens.find(p => p.dataset.pen === 'galaxy');
    galaxy.click();
    const raisedCount = pens.filter(p => p.classList.contains('active')).length;
    const afterGalaxy = { effect: a.settings.penEffect, raised: galaxy.classList.contains('active') };

    // clicking the pen you are already holding opens its options
    galaxy.click();
    await new Promise(r => setTimeout(r, 60));
    const opened = !!document.querySelector('.pop .sizes');
    document.body.click();

    const has = (sel) => !!bar.querySelector(sel);
    a.setTool('select');
    return {
      pens: pens.length, afterRed, afterGalaxy, raisedCount, opened,
      hasHighlighter: has('[data-tool="highlighter"]'), hasEraser: has('[data-tool="eraser"]'),
      hasNote: has('[data-tool="note"]'), hasText: has('[data-tool="text"]'),
      hasRuler: has('[data-cmd="ruler"]'), hasUndo: has('[data-cmd="undo"]'),
      hasImage: has('[data-cmd="insert.image"]'), penCount: PENS.length
    };
  `);
  check('the toolbar has a pen tray', toolbar.pens === toolbar.penCount && toolbar.pens === 6,
    toolbar.pens + ' pens');
  check('picking a pen sets its colour', toolbar.afterRed.tool === 'pen' && toolbar.afterRed.color === '#e81123');
  check('the pen in hand is the raised one, and only it',
    toolbar.afterGalaxy.raised && toolbar.raisedCount === 1 && toolbar.afterGalaxy.effect === 'galaxy');
  check('clicking the held pen opens its options', toolbar.opened);
  check('highlighter, eraser, ruler, note, text, image and undo are all there',
    toolbar.hasHighlighter && toolbar.hasEraser && toolbar.hasRuler &&
    toolbar.hasNote && toolbar.hasText && toolbar.hasImage && toolbar.hasUndo);

  const misc = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    const { FONTS, fontStack } = await import('app://board/js/ui/palettes.js');
    const { faceOf } = await import('app://board/js/core/render.js');
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y) => ({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.5 });

    // 1. clicking empty canvas drops the selection
    a.store.add({ id: 'd1', type: 'shape', kind: 'rect', x: 100, y: 100, w: 120, h: 120,
                  rotation: 0, stroke: '#000', fill: '#eee', lineWidth: 2 });
    a.setTool('select');
    a.setSelection(['d1']);
    const selBefore = sf.selection.size;
    it.onDown(ev(700, 700)); it.onMove(ev(700, 700)); it.onUp(ev(700, 700));
    it.action = null; it.pointers.clear();
    const selAfterSelect = sf.selection.size;

    // and with an ink tool, where the mouse pans
    a.settings.inkWithMouse = 'auto'; a.settings.penSeen = true;
    a.setTool('select'); a.setSelection(['d1']);
    a.setTool('pen');
    a.setSelection(['d1']);
    it.onDown(ev(750, 750)); it.onMove(ev(790, 750)); it.onUp(ev(790, 750));
    it.action = null; it.pointers.clear();
    const selAfterPan = sf.selection.size;

    // 2. the zoom pill appears when the zoom changes
    a.command('zoomIn');
    const pill = document.getElementById('zoomPill');
    const pillShown = pill.classList.contains('show');
    const pillText = pill.textContent;
    a.command('zoomReset');

    // 3. fonts include a handwriting face, and it reaches the renderer
    const handStack = fontStack('hand');
    const resolved = faceOf('hand');

    a.settings.penSeen = false; a.setTool('select'); a.store.clear();
    return { selBefore, selAfterSelect, selAfterPan, pillShown, pillText,
             fonts: FONTS.map(f => f.id), comic: /Comic Sans/i.test(handStack), resolved: resolved === handStack };
  `);
  check('clicking empty canvas deselects', misc.selBefore === 1 && misc.selAfterSelect === 0);
  check('panning with an ink tool deselects too', misc.selAfterPan === 0);
  check('zooming shows a readout', misc.pillShown && /%/.test(misc.pillText), misc.pillText);
  check('there is a handwriting font, and it is Comic Sans first',
    misc.fonts.includes('hand') && misc.comic && misc.resolved, misc.fonts.join(', '));

  /* ---- text comes out handwritten without anyone choosing it ---- */
  const faces = await js(`
    const a = window.app;
    const { faceOf } = await import('app://board/js/core/render.js');
    const KEY = 'gazboard.settings', OLD = 'openboard.settings';
    const keep = localStorage.getItem(KEY);
    const withStored = (v) => {
      if (v === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, v);
      localStorage.removeItem(OLD);
      return a.loadSettings();
    };
    const fresh   = withStored(null);
    const upgrade = withStored(JSON.stringify({ textFont: 'ui', noteFont: 'ui' }));
    const chosen  = withStored(JSON.stringify({ textFont: 'ui', noteFont: 'ui', fontDefaults2: true }));
    if (keep === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, keep);

    a.store.clear();
    a.settings.textFont = fresh.textFont; a.settings.noteFont = fresh.noteFont;
    a.addTextAt({ x: 200, y: 200 });
    a.textEditor.el.value = 'hello';
    a.commitTextEdit();
    a.addNoteAt({ x: 700, y: 250 });
    a.textEditor.el.value = 'note';
    a.commitTextEdit();
    const objs = a.store.objects;
    const text = objs.find(o => o.type === 'text'), note = objs.find(o => o.type === 'note');

    // the live editor must be set in the face the object will commit to
    const probe = { id: 'p', type: 'text', x: 0, y: 0, w: 300, h: 60, text: 'x', fontSize: 32,
                    font: 'serif', rotation: 0, align: 'left', valign: 'top', color: '#000' };
    a.store.add(probe);
    a.textEditor.begin(a.store.get('p'));
    const editorFace = a.textEditor.el ? a.textEditor.el.style.fontFamily : '';
    a.textEditor.cancel();
    a.store.clear();
    return {
      freshText: fresh.textFont, freshNote: fresh.noteFont,
      upgradedText: upgrade.textFont, upgradedNote: upgrade.noteFont, chosenText: chosen.textFont,
      textFont: text && text.font, noteFont: note && note.font,
      handFace: faceOf('hand'), editorFace
    };
  `);
  check('a new text box is handwritten by default',
    faces.freshText === 'hand' && faces.textFont === 'hand',
    `default ${faces.freshText}, object ${faces.textFont}`);
  check('a new sticky note is handwritten by default',
    faces.freshNote === 'hand' && faces.noteFont === 'hand',
    `default ${faces.freshNote}, object ${faces.noteFont}`);
  check('settings saved before the change are carried over to handwriting',
    faces.upgradedText === 'hand' && faces.upgradedNote === 'hand',
    `${faces.upgradedText} / ${faces.upgradedNote}`);
  check('but a deliberate choice of the sans face is left alone',
    faces.chosenText === 'ui', faces.chosenText);
  check('the handwriting face reaches for Comic Sans before anything else',
    /^'Comic Sans MS'/.test(faces.handFace), faces.handFace);
  check('the editor types in the face the text will commit to, not just for handwriting',
    faces.editorFace.replace(/"/g, "'").includes('Georgia'), faces.editorFace);

  const adopt = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    const { withAttached } = await import('app://board/js/core/store.js');
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.settings.inkWithMouse = 'yes';
    // a slide, NOT locked yet - annotate first, lock after, the natural order
    a.store.add({ id: 'slide', type: 'image', kind: 'page', x: 100, y: 100, w: 400, h: 300, rotation: 0,
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      name: 'deck.pptx' });
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y) => ({ pointerId: 1, pointerType: 'pen', button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.6 });
    a.setTool('pen');
    it.onDown(ev(200, 200)); it.onMove(ev(300, 240)); it.onMove(ev(380, 220)); it.onUp(ev(380, 220));
    it.action = null; it.pointers.clear();
    const ink = a.store.objects.find(o => o.type === 'stroke');
    const beforeLock = ink.attachedTo;

    a.setTool('select'); a.setSelection(['slide']);
    a.command('edit.lock');                       // lock AFTER drawing
    const afterLock = a.store.get(ink.id).attachedTo;
    const family = withAttached(a.store, ['slide']).length;

    a.setSelection(['slide']); a.command('edit.lock');   // unlock and drag
    a.setSelection(['slide']);
    const x0 = a.store.get('slide').x, i0 = a.store.get(ink.id).bbox.x;
    it.onDown(ev(300, 250, 'mouse')); it.onMove(ev(400, 250)); it.onUp(ev(400, 250));
    it.action = null; it.pointers.clear();
    const moved = { slide: Math.round(a.store.get('slide').x - x0), ink: Math.round(a.store.get(ink.id).bbox.x - i0) };

    a.settings.inkWithMouse = 'auto'; a.setTool('select'); a.store.clear();
    return { beforeLock, afterLock, family, moved };
  `);
  check('locking adopts ink already drawn on top',
    adopt.beforeLock === undefined && adopt.afterLock === 'slide', `before ${adopt.beforeLock}, after ${adopt.afterLock}`);
  check('the slide and that ink move together after unlocking',
    adopt.moved.slide === 100 && adopt.moved.ink === 100,
    `slide ${adopt.moved.slide}, ink ${adopt.moved.ink}`);

  /* ---- ink drawn on a locked object belongs to it ---- */
  const attach = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    const { withAttached } = await import('app://board/js/core/store.js');
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.settings.inkWithMouse = 'yes';
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y, type) => ({ pointerId: 1, pointerType: type || 'pen', button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.6 });
    const reset = () => { it.action = null; it.pointers.clear(); };
    const draw = (x0, y0, x1, y1) => {
      it.onDown(ev(x0, y0));
      it.onMove(ev((x0 + x1) / 2, (y0 + y1) / 2));
      it.onMove(ev(x1, y1));
      it.onUp(ev(x1, y1));
      reset();
      return a.store.objects.filter(o => o.type === 'stroke').pop();
    };

    // a "page", locked, the way you would mark up an import
    a.store.add({ id: 'page', type: 'image', kind: 'page', x: 100, y: 100, w: 400, h: 500, rotation: 0,
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      name: 'doc.pdf', locked: true });

    a.setTool('pen');
    const onPage = draw(200, 250, 380, 300);      // annotation on the page
    const offPage = draw(700, 250, 850, 300);     // ink elsewhere
    const attachedOn = onPage.attachedTo;
    const attachedOff = offPage.attachedTo;

    // locked: dragging the page does nothing
    a.setTool('select');
    const before = { page: a.store.get('page').x, ink: onPage.bbox.x };
    it.onDown(ev(300, 300, 'mouse'));
    it.onMove(ev(500, 300, 'mouse'));
    it.onUp(ev(500, 300, 'mouse'));
    reset();
    const whileLocked = { page: a.store.get('page').x, ink: a.store.get(onPage.id).bbox.x };

    // unlock, then drag: the annotation must travel with the page
    a.setSelection(['page']);
    a.command('edit.lock');
    a.setSelection(['page']);
    it.onDown(ev(300, 300, 'mouse'));
    it.onMove(ev(400, 300, 'mouse'));
    it.onMove(ev(500, 300, 'mouse'));
    it.onUp(ev(500, 300, 'mouse'));
    reset();
    const moved = {
      page: Math.round(a.store.get('page').x - before.page),
      ink: Math.round(a.store.get(onPage.id).bbox.x - before.ink),
      other: Math.round(a.store.get(offPage.id).bbox.x - offPage.bbox.x)
    };

    const family = withAttached(a.store, ['page']).length;

    // deleting the page takes its annotation, but not the unrelated ink
    a.setSelection(['page']);
    a.command('edit.delete');
    const afterDelete = { page: a.store.has('page'), ink: a.store.has(onPage.id), other: a.store.has(offPage.id) };
    a.store.undo();
    const restored = a.store.has('page') && a.store.has(onPage.id);

    a.settings.inkWithMouse = 'auto'; a.setTool('select'); a.store.clear();
    return { attachedOn, attachedOff, whileLocked, before, moved, family, afterDelete, restored };
  `);
  check('ink drawn on a locked object is attached to it',
    attach.attachedOn === 'page' && attach.attachedOff === undefined,
    `on page: ${attach.attachedOn}, elsewhere: ${attach.attachedOff}`);
  check('a locked object still does not move', attach.whileLocked.page === attach.before.page);
  check('unlocking and dragging carries the annotation along',
    attach.moved.page === 200 && attach.moved.ink === 200,
    `page moved ${attach.moved.page}, ink moved ${attach.moved.ink}`);
  check('unrelated ink stays where it was', attach.moved.other === 0, String(attach.moved.other));
  check('the page and its annotation count as a family', attach.family === 2, attach.family + ' objects');
  check('deleting the page takes its annotation but nothing else',
    !attach.afterDelete.page && !attach.afterDelete.ink && attach.afterDelete.other);
  check('and undo brings both back', attach.restored);

  const dragOutline = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.settings.inkWithMouse = 'auto'; a.settings.penSeen = true;
    a.setTool('pen');
    a.store.add({ id: 'k', type: 'shape', kind: 'rect', x: 200, y: 200, w: 200, h: 150,
                  rotation: 0, stroke: '#000', fill: '#eee', lineWidth: 2 });
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y) => ({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.5 });

    it.onDown(ev(300, 275));
    it.onMove(ev(340, 275));
    // sample the canvas along the top edge of the dragged object for the dashed
    // outline the drag is supposed to show
    sf.draw();
    const dpr = sf.dpr;
    const probe = (x, y) => {
      const d = sf.ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
      return { r: d[0], g: d[1], b: d[2] };
    };
    let found = false;
    for (let x = 245; x < 320; x += 2) {
      const p = probe(x, 195);
      if (p.b > 150 && p.b > p.r + 40) { found = true; break; }   // the accent blue
    }
    const duringDrag = found;
    it.onUp(ev(340, 275));
    it.action = null; it.pointers.clear();
    sf.draw();
    let after = false;
    for (let x = 245; x < 360; x += 2) {
      const p = probe(x, 195);
      if (p.b > 150 && p.b > p.r + 40) { after = true; break; }
    }
    a.settings.penSeen = false; a.setTool('select'); a.store.clear();
    return { duringDrag, after, selection: sf.selection.size };
  `);
  check('dragging with an ink tool shows an outline of what you are moving', dragOutline.duringDrag);
  check('and the outline disappears when you let go', !dragOutline.after && dragOutline.selection === 0);

  /* ---- opening zoom and ink smoothness ---- */
  const zoom = await js(`
    let savedCam;
    const a = window.app, sf = a.surface;
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // a brand new board
    a.newBoard(true);
    await frame(); await frame();
    const fresh = sf.cam.z;

    // a board saved while zoomed out to 36%, reopened
    a.store.add({ id: 'z1', type: 'shape', kind: 'rect', x: 900, y: 900, w: 200, h: 200,
                  rotation: 0, stroke: '#000', fill: 'none', lineWidth: 2 });
    sf.cam.z = 0.36; sf.cam.centerOn({ x: 1000, y: 1000 }, sf.width, sf.height);
    await a.persist();
    const saved = JSON.parse(JSON.stringify(a.store.toJSON()));
    savedCam = saved.camera;
    await a.loadBoard(saved, { silent: true, startup: true });
    await frame(); await frame();
    const view = sf.cam.viewport(sf.width, sf.height);
    const centre = { x: Math.round(view.x + view.w / 2), y: Math.round(view.y + view.h / 2) };

    a.store.clear();
    return { fresh, reopened: sf.cam.z, centre, savedZ: savedCam.z };
  `);
  check('a new board opens at 100%', zoom.fresh === 1, (zoom.fresh * 100) + '%');
  check('a board saved zoomed out reopens at 100%', zoom.reopened === 1,
    `saved at ${Math.round(zoom.savedZ * 100)}%, opened at ${Math.round(zoom.reopened * 100)}%`);
  check('reopening keeps the place you were looking at',
    Math.abs(zoom.centre.x - 1000) < 40 && Math.abs(zoom.centre.y - 1000) < 40,
    `centred on ${zoom.centre.x},${zoom.centre.y}`);

  const smooth = await js(`
    const { centrelinePath } = await import('app://board/js/core/ink.js');
    // a curve through midpoints stays inside its control triangle, so it can
    // never overshoot into a loop however sparse the samples
    const curve = (step) => {
      const P = [];
      for (let t = 0; t <= Math.PI * 6; t += step)
        P.push({ x: t * 26, y: 28 * Math.sin(t) + 11 * Math.sin(2.6 * t), p: 0.55 });
      return P;
    };
    const bounds = (pts) => {
      const c = document.createElement('canvas');
      c.width = 700; c.height = 220;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.translate(10, 110);
      ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#000';
      ctx.stroke(centrelinePath(pts, 6));
      const img = ctx.getImageData(0, 0, c.width, c.height).data;
      let minY = 1e9, maxY = -1e9;
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++)
          if (img[(y * c.width + x) * 4] < 128) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
      const py = pts.map(p => p.y + 110);
      return { inkTop: minY, inkBottom: maxY, ptTop: Math.min(...py), ptBottom: Math.max(...py) };
    };
    const sparse = bounds(curve(0.34));
    const dense = bounds(curve(0.05));
    return { sparse, dense };
  `);
  // The path must stay within the samples plus the pen's half width - proof it
  // is not overshooting between sparse points.
  const within = (b) => b.inkTop > b.ptTop - 6 && b.inkBottom < b.ptBottom + 6;
  check('a sparse fast stroke never overshoots its own points', within(smooth.sparse),
    `ink ${smooth.sparse.inkTop}-${smooth.sparse.inkBottom}, points ${Math.round(smooth.sparse.ptTop)}-${Math.round(smooth.sparse.ptBottom)}`);
  check('a dense slow stroke behaves the same', within(smooth.dense));

  /* ---- hovering must not decorate handwriting ---- */
  const hover = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.settings.inkWithMouse = 'auto'; a.settings.penSeen = true;
    const pts = [];
    for (let i = 0; i <= 60; i++) pts.push({ x: 100 + i * 5, y: 300, p: 0.5 });
    a.store.add({ id: 'ink', type: 'stroke', tool: 'pen', color: '#111', width: 8, effect: 'none',
                  points: pts, bbox: { x: 100, y: 300, w: 300, h: 0 }, rotation: 0 });
    a.store.add({ id: 'box', type: 'shape', kind: 'rect', x: 500, y: 250, w: 160, h: 120,
                  rotation: 0, stroke: '#000', fill: '#eee', lineWidth: 2 });

    const rect = sf.canvas.getBoundingClientRect();
    const hoverAt = (x, y, type) => {
      it.onMove({ pointerId: 9, pointerType: type, buttons: 0, clientX: rect.left + x, clientY: rect.top + y,
                  shiftKey: false, altKey: false, pressure: 0 });
      return { hoverId: sf.hoverId, cursor: sf.canvas.style.cursor };
    };

    a.setTool('pen');
    a.settings.penColor = '#e81123';                   // so the nib's tint is checkable
    const penOverInk = hoverAt(250, 300, 'pen');       // stylus hovering its own writing
    const penOverBox = hoverAt(580, 310, 'pen');
    const mouseOverInk = hoverAt(250, 300, 'mouse');   // mouse: cursor hints, no outline
    const mouseOverEmpty = hoverAt(900, 700, 'mouse');

    a.setTool('select');
    const selectOverInk = hoverAt(250, 300, 'mouse');  // picking tool: outline is useful

    a.settings.penSeen = false; a.store.clear(); sf.hoverId = null;
    return { penOverInk, penOverBox, mouseOverInk, mouseOverEmpty, selectOverInk };
  `);
  const isNib = (c) => c.startsWith('url("data:image/svg+xml,') && c.endsWith('2 2, crosshair');
  check('a hovering stylus does not highlight ink',
    hover.penOverInk.hoverId === null && isNib(hover.penOverInk.cursor),
    `hoverId ${hover.penOverInk.hoverId}, cursor ${hover.penOverInk.cursor.slice(0, 40)}`);
  check('a hovering stylus does not highlight objects either',
    hover.penOverBox.hoverId === null && isNib(hover.penOverBox.cursor));
  check('the pen cursor is a nib, not a crosshair, and its point is the hotspot',
    isNib(hover.penOverInk.cursor), hover.penOverInk.cursor.slice(-24));
  check('the nib is tinted with the colour loaded in the pen',
    hover.penOverInk.cursor.includes('%23e81123'), hover.penOverInk.cursor.slice(-60));
  check('the mouse hints with the cursor, not an outline',
    hover.mouseOverInk.hoverId === null && hover.mouseOverInk.cursor === 'move',
    `hoverId ${hover.mouseOverInk.hoverId}, cursor ${hover.mouseOverInk.cursor}`);
  check('the mouse shows grab over empty canvas', hover.mouseOverEmpty.cursor === 'grab');
  check('the Select tool still outlines what you hover', hover.selectOverInk.hoverId === 'ink',
    String(hover.selectOverInk.hoverId));

  /* ---- the mouse as a pointer: drag objects, pan the canvas ---- */
  const pointer = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.settings.inkWithMouse = 'auto'; a.settings.penSeen = true;   // stylus already seen
    a.setTool('pen');
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y) => ({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.5 });
    const reset = () => { it.action = null; it.pointers.clear(); };
    const drag = (x0, y0, x1, y1) => {
      it.onDown(ev(x0, y0));
      const started = it.action ? it.action.type : 'none';
      it.onMove(ev((x0 + x1) / 2, (y0 + y1) / 2));
      it.onMove(ev(x1, y1));
      it.onUp(ev(x1, y1));
      reset();
      return started;
    };

    // three "imported pages" side by side
    const mk = (id, x) => ({ id, type: 'image', kind: 'page', x, y: 100, w: 200, h: 260, rotation: 0,
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      name: 'doc.pdf', label: 'page' });
    a.store.addMany([mk('p1', 40), mk('p2', 280), mk('p3', 520)]);
    a.setSelection([]);
    const before = { p1: a.store.get('p1').x, p2: a.store.get('p2').x, p3: a.store.get('p3').x };

    // drag the middle page: only it should move
    const startedOnObject = drag(380, 230, 480, 230);
    const after = { p1: a.store.get('p1').x, p2: a.store.get('p2').x, p3: a.store.get('p3').x };
    const onlyOneMoved = after.p2 - before.p2 === 100 && after.p1 === before.p1 && after.p3 === before.p3;
    const selectedAfter = [...sf.selection];

    // drag bare canvas: that pans, and no object shifts in world space
    const camBefore = sf.cam.x;
    const startedOnEmpty = drag(900, 700, 1000, 700);
    const panned = Math.round(sf.cam.x - camBefore);
    const objectsStill = a.store.get('p2').x === after.p2;

    // the stylus still draws over the same spot
    const evPen = (x, y) => ({ pointerId: 2, pointerType: 'pen', button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.6 });
    it.onDown(evPen(380, 230)); it.onMove(evPen(420, 250)); it.onUp(evPen(420, 250)); reset();
    const inked = a.store.objects.filter(o => o.type === 'stroke').length;

    a.settings.penSeen = false; a.setTool('select'); a.store.clear();
    return { startedOnObject, onlyOneMoved, selectedAfter, startedOnEmpty, panned, objectsStill, inked, before, after };
  `);
  check('the mouse drags the object under it', pointer.startedOnObject === 'move' && pointer.onlyOneMoved,
    `${pointer.startedOnObject}, ${JSON.stringify(pointer.after)}`);
  check('dragging one page leaves the others where they were', pointer.onlyOneMoved);
  check('dragging with an ink tool leaves no selection chrome behind',
    pointer.selectedAfter.length === 0, pointer.selectedAfter.join(',') || '(none)');
  check('the mouse still pans bare canvas', pointer.startedOnEmpty === 'pan' && pointer.panned === 100 && pointer.objectsStill,
    `${pointer.startedOnEmpty}, ${pointer.panned}px`);
  check('the stylus still inks over an object', pointer.inked === 1);

  const colours = await js(`
    const a = window.app;
    const { updateSelectionBar } = await import('app://board/js/ui/contextmenu.js');
    a.newBoard(true);

    // recolour a shape from the selection bar, then make a new one
    a.store.add({ id: 'c1', type: 'shape', kind: 'rect', x: 0, y: 0, w: 100, h: 100,
                  rotation: 0, stroke: '#201f1e', fill: 'none', lineWidth: 3 });
    a.setSelection(['c1']);
    a.rememberColor('shape', 'stroke', '#e81123');
    a.store.updateMany(['c1'], { stroke: '#e81123' });
    const shapeDefault = a.settings.shapeStroke;

    a.rememberColor('note', 'color', '#a4e7a0');
    const noteDefault = a.settings.noteColor;
    a.rememberColor('text', 'color', '#0078d4');
    const textDefault = a.settings.textColor;
    a.rememberColor('stroke', 'color', '#8764b8');
    const penDefault = a.settings.penColor;

    // a brand new note picks up the remembered colour
    a.addNoteAt({ x: 400, y: 400 }); a.textEditor.cancel();
    const newNote = a.store.objects.filter(o => o.type === 'note').pop();

    // an image offers no colour control
    a.store.clear();
    a.store.add({ id: 'img', type: 'image', kind: 'page', x: 0, y: 0, w: 200, h: 200, rotation: 0,
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' });
    a.setSelection(['img']);
    updateSelectionBar(a);
    await new Promise(r => setTimeout(r, 40));
    const bar = document.getElementById('ctxbar');
    const imageButtons = bar.querySelectorAll('button').length;
    const imageHasSwatch = !!bar.querySelector('.colour-btn');

    // a shape does still offer one
    a.store.clear();
    a.store.add({ id: 'c2', type: 'shape', kind: 'rect', x: 0, y: 0, w: 100, h: 100,
                  rotation: 0, stroke: '#e81123', fill: 'none', lineWidth: 3 });
    a.setSelection(['c2']);
    updateSelectionBar(a);
    await new Promise(r => setTimeout(r, 40));
    const shapeHasSwatch = !!document.getElementById('ctxbar').querySelector('.colour-btn');

    a.store.clear(); a.setSelection([]);
    return { shapeDefault, noteDefault, textDefault, penDefault,
             newNoteColor: newNote ? newNote.color : null, imageButtons, imageHasSwatch, shapeHasSwatch };
  `);
  check('a colour picked from the selection bar becomes the default',
    colours.shapeDefault === '#e81123' && colours.noteDefault === '#a4e7a0' &&
    colours.textDefault === '#0078d4' && colours.penDefault === '#8764b8',
    JSON.stringify({ shape: colours.shapeDefault, note: colours.noteDefault }));
  check('a new object uses the remembered colour', colours.newNoteColor === '#a4e7a0', colours.newNoteColor);
  check('images offer no colour control', colours.imageHasSwatch === false && colours.imageButtons > 0,
    colours.imageButtons + ' buttons, swatch ' + colours.imageHasSwatch);
  check('shapes still offer one', colours.shapeHasSwatch === true);

  /* ---- ink outline, eraser growth, lasso drag, popover state ---- */
  const ink = await js(`
    const { centrelinePath, inkPath, strokeWeight } = await import('app://board/js/core/ink.js');
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push({ x: i * 8, y: Math.sin(i / 5) * 30, p: 0.3 + (i % 9) / 12 });

    const path = centrelinePath(pts, 10);
    const isPath = path instanceof Path2D;

    // one point still draws a dot rather than nothing
    const dot = centrelinePath([{ x: 5, y: 5, p: 0.5 }], 8) instanceof Path2D;

    // pressure sets the weight of the whole stroke, not a wobble along it
    const light = strokeWeight(pts.map(p => ({ ...p, p: 0.1 })), 10, true);
    const heavy = strokeWeight(pts.map(p => ({ ...p, p: 1 })), 10, true);
    const off = strokeWeight(pts, 10, false);

    const s = { points: pts, width: 10, tool: 'pen' };
    const p1 = inkPath(s), p2 = inkPath(s);
    return { isPath, dot, light: +light.toFixed(2), heavy: +heavy.toFixed(2), off, cached: p1 === p2 };
  `);
  check('a stroke is one centreline path', ink.isPath && ink.dot);
  check('pressure sets the weight of the whole stroke',
    ink.heavy > ink.light && ink.heavy / ink.light < 1.5 && ink.off === 10,
    `${ink.light} light, ${ink.heavy} heavy, ${ink.off} with pressure off`);
  check('the ink path is cached per stroke', ink.cached);

  const feel = await js(`
    const { centrelinePath, strokeWeight } = await import('app://board/js/core/ink.js');

    // the true curve, densely sampled - the ink must hug this whatever rate the
    // stylus sampled at. A barb from an offset outline lands tens of px away.
    const truth = [];
    for (let t = 0; t <= Math.PI * 6; t += 0.004)
      truth.push({ x: t * 26 + 10, y: 28 * Math.sin(t) + 11 * Math.sin(2.6 * t) + 110 });

    const worstStray = (step) => {
      const pts = [];
      for (let t = 0; t <= Math.PI * 6; t += step)
        pts.push({ x: t * 26, y: 28 * Math.sin(t) + 11 * Math.sin(2.6 * t), p: 0.55 });
      const c = document.createElement('canvas');
      c.width = 700; c.height = 230;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.translate(10, 110);
      const lw = strokeWeight(pts, 8, true);
      ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#000';
      ctx.stroke(centrelinePath(pts, 8));
      const img = ctx.getImageData(0, 0, c.width, c.height).data;
      let worst = 0, inked = 0;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if (img[(y * c.width + x) * 4] > 128) continue;
          inked++;
          let best = Infinity;
          for (const p of truth) {
            const d = Math.hypot(p.x - x, p.y - y);
            if (d < best) { best = d; if (best < 1) break; }
          }
          if (best > worst) worst = best;
        }
      }
      return { worst: +worst.toFixed(2), inked, half: lw / 2, samples: pts.length };
    };
    return { dense: worstStray(0.05), sparse: worstStray(0.34) };
  `);
  // A densely sampled stroke should sit within its own half width of the curve.
  check('ink hugs the curve on a slow stroke',
    feel.dense.worst < feel.dense.half + 1.5 && feel.dense.inked > 500,
    `${feel.dense.worst}px from the curve, half-width ${feel.dense.half.toFixed(1)}px`);
  // A fast stroke samples ~26px apart, so the curve through the midpoints is an
  // approximation and may sit a few px off. A spike or barb - the artefact this
  // guards against - lands tens of px out.
  check('no spikes or barbs on a fast stroke',
    feel.sparse.worst < feel.sparse.half + 6,
    `${feel.sparse.worst}px from the curve at ${feel.sparse.samples} samples, half-width ${feel.sparse.half.toFixed(1)}px`);

  const grow = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.settings.eraserMode = 'partial'; a.settings.eraserSize = 30;
    it.startErase({ x: 0, y: 0 });
    const first = it.action.radiusPx;
    it.eraseSweep(it.action, { x: 0, y: 0 }, { x: 300, y: 0 });
    const after300 = it.action.radiusPx;
    it.eraseSweep(it.action, { x: 300, y: 0 }, { x: 1500, y: 0 });
    const after1500 = it.action.radiusPx;
    it.eraseSweep(it.action, { x: 1500, y: 0 }, { x: 6000, y: 0 });
    const capped = it.action.radiusPx;
    it.finishErase(it.action); it.action = null;
    // a new scrub starts small again
    it.startErase({ x: 0, y: 0 });
    it.eraseSweep(it.action, { x: 0, y: 0 }, { x: 1, y: 0 });
    const restarted = it.action.radiusPx;
    it.finishErase(it.action); it.action = null;
    return { first, after300, after1500, capped, restarted, base: a.settings.eraserSize / 2 };
  `);
  check('the eraser grows as you scrub', grow.after300 > grow.base && grow.after1500 > grow.after300,
    `${grow.base} -> ${grow.after300.toFixed(1)} -> ${grow.after1500.toFixed(1)}`);
  check('eraser growth is capped', Math.abs(grow.capped - grow.base * 2.8) < 0.01, grow.capped.toFixed(1));
  check('a new scrub starts at the chosen size', Math.abs(grow.restarted - grow.base) < 0.2, grow.restarted.toFixed(1));

  const lasso = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.store.add({ id: 'l1', type: 'shape', kind: 'rect', x: 100, y: 100, w: 120, h: 120,
                  rotation: 0, stroke: '#000', fill: '#eee', lineWidth: 2 });
    a.store.add({ id: 'l2', type: 'shape', kind: 'rect', x: 260, y: 100, w: 120, h: 120,
                  rotation: 0, stroke: '#000', fill: '#eee', lineWidth: 2 });
    a.setTool('lasso');
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y) => ({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.5 });
    const reset = () => { it.action = null; it.pointers.clear(); };

    // draw a lasso around both
    it.onDown(ev(60, 60));
    for (const p of [[440, 60], [440, 260], [60, 260], [60, 70]]) it.onMove(ev(p[0], p[1]));
    it.onUp(ev(60, 70));
    reset();
    const selected = sf.selection.size;

    // now drag from inside the selection - it should move, not re-lasso
    const x0 = a.store.get('l1').x;
    it.onDown(ev(200, 160));
    const started = it.action ? it.action.type : 'none';
    it.onMove(ev(300, 160));
    it.onUp(ev(300, 160));
    reset();
    const moved = Math.round(a.store.get('l1').x - x0);
    const stillSelected = sf.selection.size;

    // dragging outside starts a fresh lasso
    it.onDown(ev(600, 600));
    const outside = it.action ? it.action.type : 'none';
    it.onUp(ev(600, 600));
    reset();
    a.setTool('select'); a.store.clear();
    return { selected, started, moved, stillSelected, outside };
  `);
  check('lasso selects what it encloses', lasso.selected === 2, lasso.selected + ' objects');
  check('dragging inside a lasso selection moves it', lasso.started === 'move' && lasso.moved === 100,
    `${lasso.started}, moved ${lasso.moved}`);
  check('the selection survives the drag', lasso.stillSelected === 2);
  check('dragging outside still lassos', lasso.outside === 'lasso');

  const popover = await js(`
    const a = window.app;
    a.setTool('select');
    const btn = document.querySelector('#toolbar [data-tool="pen"]');
    btn.click();                       // switches to the pen
    btn.click();                       // clicking the active tool opens its options
    await new Promise(r => setTimeout(r, 80));
    const sizes = document.querySelectorAll('.pop .sizes .size');
    const before = [...sizes].findIndex(el => el.classList.contains('active'));
    const target = before === 0 ? 3 : 0;
    sizes[target].click();
    await new Promise(r => setTimeout(r, 30));
    const after = [...document.querySelectorAll('.pop .sizes .size')].findIndex(el => el.classList.contains('active'));
    const activeCount = document.querySelectorAll('.pop .sizes .size.active').length;
    const width = a.settings.penWidth;
    document.body.click();
    return { before, target, after, activeCount, width, sizes: sizes.length };
  `);
  check('the pen size popover marks the new size at once', popover.after === popover.target && popover.activeCount === 1,
    `was ${popover.before}, clicked ${popover.target}, now ${popover.after}`);

  /* ---- transform handles, locking, and what the eraser may touch ---- */
  const handles = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    const { handlePositions } = await import('app://board/js/core/render.js');
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y, type) => ({ pointerId: 1, pointerType: type || 'mouse', button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.5 });
    const reset = () => { it.action = null; it.pointers.clear(); it.secondaryPan = null; };

    const fresh = () => {
      a.store.clear();
      a.store.add({ id: 'box', type: 'shape', kind: 'rect', x: 200, y: 200, w: 300, h: 200,
                    rotation: 0, stroke: '#000', fill: '#eee', lineWidth: 2 });
      a.setSelection(['box']); sf.draw();
      return handlePositions(sf.selectionScreenBox());
    };
    const dragHandle = (hp, key, dx, dy) => {
      it.onDown(ev(hp[key].x, hp[key].y));
      const started = it.action ? it.action.type : 'none';
      it.onMove(ev(hp[key].x + dx, hp[key].y + dy));
      it.onUp(ev(hp[key].x + dx, hp[key].y + dy));
      reset();
      return started;
    };

    // 1. with Select active
    a.setTool('select');
    let hp = fresh();
    let started = dragHandle(hp, 'se', 120, 80);
    const withSelect = { started, w: Math.round(a.store.get('box').w) };

    // 2. with the pen tool active - the handle must still win
    a.settings.inkWithMouse = 'yes';          // mouse inks, so this is the hard case
    a.setTool('pen');
    hp = fresh();
    started = dragHandle(hp, 'se', 120, 80);
    const withPen = { started, w: Math.round(a.store.get('box').w),
                      strokes: a.store.objects.filter(o => o.type === 'stroke').length };

    // 3. after a stylus, where the mouse would otherwise pan
    a.settings.inkWithMouse = 'auto'; a.settings.penSeen = true;
    hp = fresh();
    const camX = sf.cam.x;
    started = dragHandle(hp, 'se', 120, 80);
    const withPan = { started, w: Math.round(a.store.get('box').w), camMoved: Math.round(sf.cam.x - camX) };

    // 4. the rotate handle
    hp = fresh();
    started = dragHandle(hp, 'rot', 90, 40);
    const rotated = { started, rotation: +(a.store.get('box').rotation || 0).toFixed(3) };

    // 5. a locked object exposes no handles
    hp = fresh();
    a.store.update('box', { locked: true });
    sf.draw();
    const lockedHandle = it.handleAt(hp.se);
    const lockedBox = sf.selectionIsLocked();
    a.store.update('box', { locked: false });

    a.settings.inkWithMouse = 'auto'; a.settings.penSeen = false;
    a.setTool('select'); a.store.clear();
    return { withSelect, withPen, withPan, rotated, lockedHandle, lockedBox };
  `);
  check('handles resize with Select active', handles.withSelect.started === 'resize' && handles.withSelect.w > 380,
    `${handles.withSelect.started}, w ${handles.withSelect.w}`);
  check('handles resize with the pen tool active', handles.withPen.started === 'resize' && handles.withPen.w > 380 && handles.withPen.strokes === 0,
    `${handles.withPen.started}, w ${handles.withPen.w}, ${handles.withPen.strokes} strokes`);
  check('handles beat mouse-panning too', handles.withPan.started === 'resize' && handles.withPan.camMoved === 0,
    `${handles.withPan.started}, camera moved ${handles.withPan.camMoved}`);
  check('the rotate handle rotates', handles.rotated.started === 'rotate' && handles.rotated.rotation !== 0,
    `${handles.rotated.started}, ${handles.rotated.rotation} rad`);
  check('a locked object offers no handles', handles.lockedHandle === null && handles.lockedBox === true);

  const lockUse = await js(`
    const a = window.app, sf = a.surface;
    const { pick, inBox } = await import('app://board/js/core/hit.js');
    a.newBoard(true);
    a.store.add({ id: 'lk', type: 'shape', kind: 'rect', x: 0, y: 0, w: 200, h: 200,
                  rotation: 0, stroke: '#000', fill: '#eee', lineWidth: 2, locked: true });
    const clickable = !!pick(a.store, { x: 100, y: 100 }, 4);
    const marquee = inBox(a.store, { x: -500, y: -500, w: 2000, h: 2000 }).length;
    a.setSelection(['lk']);
    a.command('edit.delete');
    const survivedDelete = a.store.has('lk');
    a.setSelection(['lk']);
    a.command('edit.lock');                       // unlock
    const unlocked = !a.store.get('lk').locked;
    a.store.clear();
    return { clickable, marquee, survivedDelete, unlocked };
  `);
  check('a locked object can still be clicked (so it can be unlocked)', lockUse.clickable);
  check('a locked object is skipped by marquee select', lockUse.marquee === 0);
  check('Delete leaves a locked object alone', lockUse.survivedDelete);
  check('unlock works from the selection', lockUse.unlocked);

  const eraseSafe = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    // a "page" with ink drawn over it
    a.store.add({ id: 'page', type: 'image', kind: 'page', x: 0, y: 0, w: 600, h: 800, rotation: 0,
                  src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
                  name: 'doc.pdf', label: 'doc.pdf — page 1' });
    a.store.add({ id: 'note', type: 'note', x: 620, y: 0, w: 160, h: 160, color: '#ffd94a', text: 'keep me', rotation: 0 });
    const pts = [];
    for (let i = 0; i <= 60; i++) pts.push({ x: 100 + i * 6, y: 400, p: 0.5 });
    a.store.add({ id: 'ink', type: 'stroke', tool: 'pen', color: '#e81123', width: 6, effect: 'none',
                  points: pts, bbox: { x: 100, y: 400, w: 360, h: 0 }, rotation: 0 });

    const sweep = (from, to) => { it.startErase(from); it.eraseSweep(it.action, from, to); it.finishErase(it.action); it.action = null; };

    // ink mode: rub out the middle of the stroke, right on top of the page
    a.settings.eraserMode = 'partial'; a.settings.eraserSize = 50;
    sweep({ x: 280, y: 360 }, { x: 280, y: 440 });
    const inkMode = {
      pageKept: a.store.has('page'),
      noteKept: a.store.has('note'),
      inkSplit: a.store.objects.filter(o => o.type === 'stroke').length
    };

    // object mode: the explicit "remove whole things" mode still does
    a.settings.eraserMode = 'object';
    sweep({ x: 300, y: 200 }, { x: 300, y: 260 });
    const objectMode = { pageGone: !a.store.has('page') };

    a.settings.eraserMode = 'partial'; a.store.clear();
    return { inkMode, objectMode };
  `);
  check('the ink eraser leaves pictures and pages alone', eraseSafe.inkMode.pageKept && eraseSafe.inkMode.noteKept,
    `page kept ${eraseSafe.inkMode.pageKept}, note kept ${eraseSafe.inkMode.noteKept}`);
  check('the ink eraser still cuts the ink on top', eraseSafe.inkMode.inkSplit === 2, eraseSafe.inkMode.inkSplit + ' fragments');
  check('object mode still removes a whole page', eraseSafe.objectMode.pageGone);

  /* ---- device roles: stylus inks, mouse pans ---- */
  const roles = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true);
    sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y, id, type) => ({ pointerId: id, pointerType: type, button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.5 });
    const drag = (type, id, x0, y0, x1, y1) => {
      it.onDown(ev(x0, y0, id, type));
      it.onMove(ev((x0 + x1) / 2, (y0 + y1) / 2, id, type));
      it.onMove(ev(x1, y1, id, type));
      it.onUp(ev(x1, y1, id, type));
      it.action = null; it.pointers.clear(); it.pinch = null; it.secondaryPan = null;
    };
    const strokes = () => a.store.objects.filter(o => o.type === 'stroke').length;
    const reset = () => { a.store.clear(); sf.cam.x = 0; sf.cam.y = 0; };

    // --- fresh profile: no stylus seen, so the mouse still draws ---
    a.settings.inkWithMouse = 'auto'; a.settings.penSeen = false;
    a.setTool('pen');
    reset();
    const mouseInksAtFirst = a.mouseInks;
    drag('mouse', 1, 200, 200, 340, 260);
    const drewWithMouseBefore = strokes() === 1;

    // --- a stylus touches the tablet ---
    reset();
    drag('pen', 2, 200, 300, 340, 360);
    const penDrew = strokes() === 1;
    const penRemembered = a.settings.penSeen === true;
    const mouseInksNow = a.mouseInks;

    // --- from here the mouse pans and never inks ---
    reset();
    const camX0 = sf.cam.x;
    drag('mouse', 3, 200, 200, 400, 200);
    const mousePanned = Math.round(sf.cam.x - camX0);
    const mouseDrewAfter = strokes();

    // --- the stylus still inks ---
    reset();
    drag('pen', 4, 200, 400, 340, 460);
    const penStillDraws = strokes() === 1;

    // --- highlighter follows the same rule ---
    reset(); a.setTool('highlighter');
    const camX1 = sf.cam.x;
    drag('mouse', 5, 200, 200, 380, 200);
    const hlMousePanned = Math.round(sf.cam.x - camX1) === 180 && strokes() === 0;

    // --- other tools keep working with the mouse ---
    reset(); a.setTool('note');
    drag('mouse', 6, 300, 300, 300, 300);
    a.textEditor.cancel();
    const noteWithMouse = a.store.objects.filter(o => o.type === 'note').length === 1;

    reset(); a.setTool('select');
    const camX2 = sf.cam.x;
    drag('mouse', 7, 200, 200, 300, 260);
    const selectUnaffected = Math.round(sf.cam.x - camX2) === 0;

    // --- eraser still works from the mouse ---
    reset(); a.setTool('pen');
    drag('pen', 8, 200, 500, 400, 500);
    const before = strokes();
    a.setTool('eraser'); a.settings.eraserMode = 'object'; a.settings.eraserSize = 40;
    drag('mouse', 9, 300, 460, 300, 540);
    const eraserWithMouse = before === 1 && strokes() === 0;

    // --- the override pins it either way ---
    reset(); a.setTool('pen');
    a.settings.inkWithMouse = 'yes';
    const forcedOn = a.mouseInks;
    drag('mouse', 10, 200, 200, 320, 240);
    const drewWhenForced = strokes() === 1;

    reset();
    a.settings.inkWithMouse = 'no'; a.settings.penSeen = false;
    const forcedOff = a.mouseInks;
    const camX3 = sf.cam.x;
    drag('mouse', 11, 200, 200, 320, 200);
    const pannedWhenForced = Math.round(sf.cam.x - camX3) === 120 && strokes() === 0;

    a.settings.inkWithMouse = 'auto'; a.settings.penSeen = false;
    a.setTool('select'); a.store.clear();
    return { mouseInksAtFirst, drewWithMouseBefore, penDrew, penRemembered, mouseInksNow,
             mousePanned, mouseDrewAfter, penStillDraws, hlMousePanned, noteWithMouse,
             selectUnaffected, eraserWithMouse, forcedOn, drewWhenForced, forcedOff, pannedWhenForced };
  `);
  check('mouse-only setup: the mouse still inks', roles.mouseInksAtFirst === true && roles.drewWithMouseBefore);
  check('stylus draws and is remembered', roles.penDrew && roles.penRemembered);
  check('after a stylus appears the mouse stops inking', roles.mouseInksNow === false);
  check('mouse pans the canvas instead', roles.mousePanned === 200 && roles.mouseDrewAfter === 0, `${roles.mousePanned}px, ${roles.mouseDrewAfter} strokes`);
  check('stylus keeps drawing normally', roles.penStillDraws);
  check('highlighter follows the same rule', roles.hlMousePanned);
  check('notes, select and eraser still take the mouse', roles.noteWithMouse && roles.selectUnaffected && roles.eraserWithMouse);
  check('"Always" forces the mouse to ink', roles.forcedOn === true && roles.drewWhenForced);
  check('"Never" forces the mouse to pan', roles.forcedOff === false && roles.pannedWhenForced);

  /* ---- panning while drawing ---- */
  const pan = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true);
    sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.setTool('pen');
    a.settings.edgePan = true;

    const down = (x, y, id = 1, type = 'pen') => it.onDown({ pointerId: id, pointerType: type, button: 0, buttons: 1,
      clientX: x, clientY: y, shiftKey: false, altKey: false, pressure: 0.5 });
    const move = (x, y, id = 1, type = 'pen') => it.onMove({ pointerId: id, pointerType: type, buttons: 1,
      clientX: x, clientY: y, shiftKey: false, altKey: false, pressure: 0.5 });
    const up = (x, y, id = 1, type = 'pen') => it.onUp({ pointerId: id, pointerType: type,
      clientX: x, clientY: y, shiftKey: false, altKey: false });

    const rect = sf.canvas.getBoundingClientRect();
    const X = (v) => rect.left + v, Y = (v) => rect.top + v;

    // --- 1. a mouse press mid-stroke pans instead of cancelling the stroke ---
    down(X(300), Y(300));
    move(X(340), Y(300));
    const midPoints = it.action && it.action.type === 'draw' ? it.action.obj.points.length : -1;
    const camBefore = sf.cam.x;
    down(X(600), Y(400), 2, 'mouse');            // second pointer: the mouse
    const pinched = !!it.pinch;
    const secondary = !!it.secondaryPan;
    const stillDrawing = !!(it.action && it.action.type === 'draw');
    move(X(700), Y(400), 2, 'mouse');            // drag the canvas 100px right
    const panned = Math.round(sf.cam.x - camBefore);
    const grewWhilePanning = it.action.obj.points.length > midPoints;
    up(X(700), Y(400), 2, 'mouse');
    const releasedSecondary = !it.secondaryPan;
    const stillDrawingAfter = !!(it.action && it.action.type === 'draw');
    move(X(380), Y(300));
    up(X(380), Y(300));
    const strokeKept = a.store.objects.some(o => o.type === 'stroke');

    // --- 2. two touch pointers still pinch ---
    a.store.clear();
    down(X(300), Y(300), 5, 'touch');
    down(X(400), Y(300), 6, 'touch');
    const touchPinches = !!it.pinch && !it.secondaryPan;
    up(X(300), Y(300), 5, 'touch'); up(X(400), Y(300), 6, 'touch');
    it.pinch = null; it.action = null; it.pointers.clear();

    // --- 3. edge auto-pan: velocity near the edge, none in the middle ---
    down(X(300), Y(300));
    move(X(300), Y(300));
    const middleVel = it.edgeVelocity({ x: 300, y: 300 });
    const leftVel = it.edgeVelocity({ x: 8, y: 300 });
    const rightVel = it.edgeVelocity({ x: sf.width - 8, y: 300 });
    const camX0 = sf.cam.x;
    move(X(10), Y(300));                          // drive the pen into the left edge
    const armed = !!it._edgeRaf;
    await new Promise(r => setTimeout(r, 260));   // let the auto-pan loop run
    const scrolled = Math.round(sf.cam.x - camX0);
    const pointsWhileScrolling = it.action ? it.action.obj.points.length : 0;
    up(X(10), Y(300));
    const stopped = !it._edgeRaf;

    // --- 4. the setting turns it off ---
    a.settings.edgePan = false;
    down(X(300), Y(300)); move(X(10), Y(300));
    const offVel = it.edgeVelocity({ x: 8, y: 300 });
    up(X(10), Y(300));
    a.settings.edgePan = true;
    a.store.clear();

    return { pinched, secondary, stillDrawing, panned, grewWhilePanning, releasedSecondary,
             stillDrawingAfter, strokeKept, touchPinches,
             middleVel, leftDir: leftVel ? Math.sign(leftVel.vx) : 0, rightDir: rightVel ? Math.sign(rightVel.vx) : 0,
             armed, scrolled, pointsWhileScrolling, stopped, offVel };
  `);
  check('mouse during a pen stroke pans, not pinches', pan.secondary === true && pan.pinched === false && pan.stillDrawing === true);
  check('canvas follows the mouse drag', pan.panned === 100, pan.panned + 'px');
  check('the stroke survives and keeps growing', pan.strokeKept && pan.grewWhilePanning && pan.stillDrawingAfter);
  check('releasing the mouse leaves the pen drawing', pan.releasedSecondary);
  check('two touch pointers still pinch-zoom', pan.touchPinches);
  check('no auto-pan away from the edges', pan.middleVel === null);
  check('edge velocity points inward', pan.leftDir > 0 && pan.rightDir < 0, `left ${pan.leftDir}, right ${pan.rightDir}`);
  check('auto-pan scrolls the canvas while drawing', pan.armed && pan.scrolled > 20 && pan.pointsWhileScrolling > 1, `${pan.scrolled}px, ${pan.pointsWhileScrolling} points`);
  check('auto-pan stops on pointer up', pan.stopped);
  check('the edge auto-pan setting disables it', pan.offVel === null);

  /* ---- templates ---- */
  const tplCount = await js(`
    const { TEMPLATES } = await import('app://board/js/templates.js');
    const a = window.app; const before = a.store.count;
    a.applyTemplate(TEMPLATES.find(t => t.id === 'kanban'));
    return { added: a.store.count - before, total: TEMPLATES.length };
  `);
  check('templates available', tplCount.total >= 12, tplCount.total + ' templates');
  check('template applied', tplCount.added > 4, tplCount.added + ' objects');

  /* ---- background ---- */
  await js(`window.app.store.setBackground({ pattern: 'grid', color: '#ffffff' });`);
  check('background pattern set', (await js(`return window.app.store.doc.background.pattern;`)) === 'grid');

  /* ---- ruler ---- */
  await js(`window.app.command('ruler'); window.app.ruler.angle = 0.35;`);
  check('ruler toggles', await js(`return window.app.ruler.visible;`));

  await sleep(400);
  await shot(win, '01-board');

  /* ---- imports ---- */
  const pdf = await js(`
    const { insertDocument } = await import('app://board/js/insert.js');
    const before = window.app.store.count;
    const r = await insertDocument(window.app, ${JSON.stringify(path.join(FIX, 'sample.pdf'))}, { pages: [1, 2, 3] });
    return { added: window.app.store.count - before, ok: !!r };
  `);
  check('PDF import adds pages', pdf.added === 3, pdf.added + ' pages');

  const docx = await js(`
    const { insertDocument } = await import('app://board/js/insert.js');
    const before = window.app.store.count;
    const r = await insertDocument(window.app, ${JSON.stringify(path.join(FIX, 'sample.docx'))}, { pages: [1] });
    return { added: window.app.store.count - before };
  `);
  check('Word import adds pages', docx.added >= 1, docx.added + ' pages');

  const pptx = await js(`
    const { insertDocument } = await import('app://board/js/insert.js');
    const before = window.app.store.count;
    const r = await insertDocument(window.app, ${JSON.stringify(path.join(FIX, 'sample.pptx'))}, { pages: [1, 2, 3] });
    return { added: window.app.store.count - before };
  `);
  check('PowerPoint import adds slides', pptx.added === 3, pptx.added + ' slides');

  const ranges = await js(`
    const { parseRange, formatRange } = await import('app://board/js/ui/pagepicker.js');
    return {
      simple: parseRange('1-3, 7, 9-10', 12).join(','),
      openEnded: parseRange('8-', 10).join(','),
      clamped: parseRange('0, 5, 99', 6).join(','),
      messy: parseRange('  3 , 3, 2  ', 5).join(','),
      empty: parseRange('nonsense', 5).length,
      round: formatRange([1,2,3,7,9,10,11])
    };
  `);
  check('page ranges parse', ranges.simple === '1,2,3,7,9,10' && ranges.openEnded === '8,9,10' &&
    ranges.clamped === '5' && ranges.messy === '2,3' && ranges.empty === 0, JSON.stringify(ranges));
  check('page ranges format back', ranges.round === '1-3, 7, 9-11', ranges.round);

  const picker = await js(`
    const { insertDocument } = await import('app://board/js/insert.js');
    const a = window.app;
    const before = a.store.count;   // keep whatever the board already holds
    // no 'pages' option: the picker must appear for a multi-page document
    const p = insertDocument(a, ${JSON.stringify(path.join(FIX, 'sample.pdf'))});
    let tiles = 0, shown = false;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 100));
      shown = document.getElementById('overlay').classList.contains('show') &&
              document.getElementById('overlayCard').classList.contains('picker');
      tiles = document.querySelectorAll('.pick-tile').length;
      if (shown && tiles) break;
    }
    const label = document.querySelector('.pick-count')?.textContent || '';
    // choose page 2 only, then import
    const range = document.querySelector('.range-input');
    range.value = '2';
    range.dispatchEvent(new Event('input'));
    const btn = [...document.querySelectorAll('.card.picker .actions .btn')].find(b => /Import/.test(b.textContent));
    const btnText = btn.textContent;
    btn.click();
    const objs = await p;
    return { shown, tiles, label, btnText, added: a.store.count - before,
             page: objs && objs[0] ? objs[0].docPage : null,
             selected: a.surface.selection.size };
  `);
  check('the page picker appears for a multi-page document', picker.shown && picker.tiles === 3, `${picker.tiles} thumbnails, "${picker.label}"`);
  check('picking a single page imports only that page', picker.added === 1 && picker.page === 2,
    `${picker.added} object(s), page ${picker.page}`);
  check('the import button reflects the choice', /Import 1 page/.test(picker.btnText), picker.btnText);

  const quality = await js(`
    const { openPdf } = await import('app://board/js/importers/pdf.js');
    const { QUALITY } = await import('app://board/js/ui/pagepicker.js');
    const res = await window.board.importToPdf(${JSON.stringify(path.join(FIX, 'sample.pdf'))});
    const doc = await openPdf(res.data);
    const out = [];
    for (const q of QUALITY) {
      const p = await doc.render(1, q.id);
      // decode the PNG to get its real pixel size
      const px = await new Promise((ok) => {
        const im = new Image();
        im.onload = () => ok({ w: im.naturalWidth, h: im.naturalHeight });
        im.src = p.dataUrl;
      });
      out.push({ label: q.label, dpi: q.dpi, w: px.w, h: px.h, bytes: p.dataUrl.length, pts: Math.round(p.width) });
    }
    await doc.destroy();
    return out;
  `);
  const ascending = quality.every((q, i) => i === 0 || q.w > quality[i - 1].w);
  check('import quality steps up the raster size', ascending,
    quality.map((q) => `${q.label} ${q.w}x${q.h}`).join(', '));
  check('maximum quality reaches print resolution', quality[2].w / quality[2].pts * 72 >= 280,
    Math.round(quality[2].w / quality[2].pts * 72) + ' dpi');
  check('page size in board units is unchanged by quality',
    quality.every((q) => q.pts === quality[0].pts), quality[0].pts + ' pt wide at every setting');
  check('imported pages are not left selected as a clump', picker.selected === 0);

  const imgOk = await js(`
    const a = window.app;
    const pages = a.store.objects.filter(o => o.kind === 'page');
    return pages.length > 0 && pages.every(p => typeof p.src === 'string' && p.src.startsWith('data:image/png') && p.src.length > 2000);
  `);
  check('imported pages carry bitmaps', imgOk);

  await js(`window.app.command('fit');`);
  await sleep(700);
  await shot(win, '02-imports');

  /* ---- export ---- */
  const png = await js(`
    const a = window.app;
    const b = a.store.contentBounds();
    const c = a.surface.renderTo({ x: b.x - 40, y: b.y - 40, w: b.w + 80, h: b.h + 80 }, 0.5);
    return { w: c.width, h: c.height, url: c.toDataURL().length };
  `);
  check('PNG render produces pixels', png.w > 100 && png.url > 5000, `${png.w}x${png.h}`);

  const svg = await js(`
    const m = await import('app://board/js/export.js');
    const a = window.app;
    const b = a.store.contentBounds();
    // buildSvg is internal; exercise it through the module's public surface
    return typeof m.exportSvg === 'function' && typeof m.saveBoardFile === 'function';
  `);
  check('export module intact', svg);

  /* ---- persistence round-trip ---- */
  const round = await js(`
    const a = window.app;
    const json = JSON.parse(JSON.stringify(a.store.toJSON()));
    const n = json.objects.length;
    const { Store } = await import('app://board/js/core/store.js');
    const s2 = new Store(); s2.load(json);
    return { n, loaded: s2.count, name: s2.doc.name, bg: s2.doc.background.pattern };
  `);
  check('board serialises and reloads', round.n === round.loaded && round.n > 10, `${round.loaded} objects`);

  const saved = await js(`
    await window.app.persist();
    const list = await window.board.boards.list();
    return list.length;
  `);
  check('board saved to disk', saved >= 1, saved + ' board(s)');

  /* ---- op log (collaboration seam) ---- */
  const oplog = await js(`
    const a = window.app;
    const seen = [];
    const base = a.store.checkpoint();
    const off = a.store.onOp(op => seen.push(op.t));
    a.store.add({ id: 'op-test', type: 'shape', kind: 'rect', x: 0, y: 0, w: 5, h: 5, rotation: 0, stroke: '#000', fill: 'none', lineWidth: 1 });
    a.store.update('op-test', { w: 20 });
    a.store.remove(['op-test']);
    off();
    const { Store } = await import('app://board/js/core/store.js');
    const peer = new Store();
    peer.load(base);
    peer.applyRemote(a.store.log.map(o => o));
    return { seen, peerCount: peer.count, mine: a.store.count };
  `);
  check('op log emits add/set/del', oplog.seen.join(',') === 'add,set,del', oplog.seen.join(','));
  check('remote replay reproduces board', oplog.peerCount === oplog.mine, `${oplog.peerCount} vs ${oplog.mine}`);

  /* ---- tool switching / UI ---- */
  const tools = await js(`
    const a = window.app; const got = [];
    for (const t of ['select','lasso','pen','highlighter','eraser','note','text','shape']) { a.setTool(t); got.push(a.tool); }
    a.setTool('select');
    return got;
  `);
  check('all tools selectable', tools.join(',') === 'select,lasso,pen,highlighter,eraser,note,text,shape', tools.join(','));

  await js(`window.app.setSelection([window.app.store.doc.order[0]]);`);
  await sleep(250);
  check('selection bar shows', await js(`return document.getElementById('ctxbar').classList.contains('show');`));

  await js(`window.app.panels.templates();`);
  await sleep(350);
  check('templates panel opens', await js(`return document.getElementById('panel').classList.contains('open') && document.querySelectorAll('.tpl').length > 8;`));
  await shot(win, '03-templates');
  await js(`window.app.panels.close();`);

  await js(`window.app.showShortcuts();`);
  await sleep(250);
  await shot(win, '04-shortcuts');
  await js(`document.getElementById('overlay').classList.remove('show');`);

  /* ---- boards survive a restart ---- *
   * The bug this guards: the "which board was open" pointer used to live in the
   * renderer's localStorage, which Chromium flushes lazily. A machine that was
   * restarted rather than shut down cleanly lost it, the app opened a blank
   * canvas, and it looked exactly like every board had been deleted.
   */
  const userData = app.getPath('userData');
  const boardsDir = path.join(userData, 'boards');
  const pointerFile = path.join(userData, 'last-board.json');

  const twoBoards = await js(`
    const a = window.app;
    const mk = async (name, n) => {
      a.newBoard(true);
      a.store.rename(name);
      for (let i = 0; i < n; i++)
        a.store.add({ id: name + i, type: 'shape', kind: 'rect', x: 10 + i * 20, y: 10, w: 40, h: 30,
                      rotation: 0, stroke: '#000', fill: 'none', lineWidth: 2 });
      await a.persist();
      return a.store.doc.id;
    };
    const older = await mk('Older board', 2);
    await new Promise(r => setTimeout(r, 1100));      // so mtimes differ
    const newer = await mk('Newer board', 3);
    return { older, newer };
  `);

  const pointerAfterSave = JSON.parse(await fs.readFile(pointerFile, 'utf8'));
  check('saving a board records the open-board pointer on disk, not just in the renderer',
    pointerAfterSave.id === twoBoards.newer, `${pointerAfterSave.id} vs ${twoBoards.newer}`);
  check('the board itself is on disk immediately',
    (await fs.readFile(path.join(boardsDir, twoBoards.newer + '.json'), 'utf8')).includes('Newer board'));
  check('atomic writes leave no temp files behind',
    (await fs.readdir(boardsDir)).every((f) => f.endsWith('.json')),
    (await fs.readdir(boardsDir)).join(', '));

  const resumed = await js(`return await window.board.boards.resume();`);
  check('resume reopens the board that was open', resumed.board && resumed.board.id === twoBoards.newer,
    resumed.board && resumed.board.id);

  // now the case that actually bit: the pointer never made it to disk
  await fs.rm(pointerFile, { force: true });
  const resumedNoPointer = await js(`return await window.board.boards.resume();`);
  check('with the pointer gone, it reopens the newest real board instead of a blank one',
    resumedNoPointer.board && resumedNoPointer.board.id === twoBoards.newer && resumedNoPointer.reason === 'newest',
    `${resumedNoPointer.reason} ${resumedNoPointer.board && resumedNoPointer.board.name}`);

  // and it must never prefer an empty board over one with work in it
  await fs.writeFile(path.join(boardsDir, 'zz-empty.json'),
    JSON.stringify({ id: 'zz-empty', name: 'Untitled board', objects: [], order: [] }));
  const resumedWithEmpty = await js(`return await window.board.boards.resume();`);
  check('an empty board never wins over one with work on it',
    resumedWithEmpty.board && (resumedWithEmpty.board.objects || []).length > 0,
    resumedWithEmpty.board && resumedWithEmpty.board.name);
  await fs.rm(path.join(boardsDir, 'zz-empty.json'), { force: true });

  const litter = await js(`
    const a = window.app;
    const before = (await window.board.boards.list()).length;
    a.newBoard(true);                       // a fresh board nobody has drawn on
    await new Promise(r => setTimeout(r, 900));
    const after = (await window.board.boards.list()).length;
    a.store.add({ id: 'proof', type: 'shape', kind: 'rect', x: 0, y: 0, w: 10, h: 10,
                  rotation: 0, stroke: '#000', fill: 'none', lineWidth: 2 });
    await new Promise(r => setTimeout(r, 900));
    const afterDrawing = (await window.board.boards.list()).length;
    return { before, after, afterDrawing };
  `);
  check('an untouched new board is not written to disk',
    litter.after === litter.before, `${litter.before} -> ${litter.after}`);
  check('but it is saved the moment something is drawn on it',
    litter.afterDrawing === litter.before + 1, `${litter.before} -> ${litter.afterDrawing}`);

  await js(`window.app.newBoard(true); window.app.store.clear();`);

  /* ---- boards from the OpenBoard days are not stranded ---- *
   * The app folder is named after productName, so the rename to GazBoard left
   * the old boards behind in a folder called "OpenBoard" - with capitals. The
   * migration used to look for a literal lower-case "openboard", which only
   * matched because Windows ignores case in paths.
   */
  const legacyDir = path.join(path.dirname(userData), 'OpenBoard', 'boards');
  await fs.mkdir(legacyDir, { recursive: true });
  await fs.writeFile(path.join(legacyDir, 'legacy-1.json'), JSON.stringify({
    id: 'legacy-1', name: 'From OpenBoard', order: ['l1'],
    objects: [{ id: 'l1', type: 'shape', kind: 'rect', x: 0, y: 0, w: 40, h: 40,
                rotation: 0, stroke: '#000', fill: 'none', lineWidth: 2 }],
    background: { pattern: 'grid', color: '#fff' }
  }));
  const mig = await js(`return await window.board.boards.migrate();`);
  check('boards from the old OpenBoard folder are carried over, capitals and all',
    mig && mig.moved >= 1 && mig.from.includes('OpenBoard'),
    JSON.stringify(mig));
  check('the carried-over board really lands in the new folder',
    (await fs.readFile(path.join(boardsDir, 'legacy-1.json'), 'utf8')).includes('From OpenBoard'));
  check('the originals are left where they were',
    !!(await fs.readFile(path.join(legacyDir, 'legacy-1.json'), 'utf8')));
  const migAgain = await js(`return await window.board.boards.migrate();`);
  check('running the migration again copies nothing and overwrites nothing',
    migAgain.moved === 0, JSON.stringify(migAgain));
  await fs.rm(path.join(boardsDir, 'legacy-1.json'), { force: true });
  await fs.rm(path.join(path.dirname(userData), 'OpenBoard'), { recursive: true, force: true });

  /* ---- infinite canvas vs a fixed sheet ---- */
  const canvas = await js(`
    const a = window.app;
    const { pageWorldSize, paperForPage } = await import('app://board/js/ui/pdfdialog.js');
    const { pageRect } = await import('app://board/js/core/render.js');
    const r = {};
    a.newBoard(true);
    r.defaultIsInfinite = a.store.doc.page === null;

    await a.setPageSize('a4', 'landscape');
    r.a4 = a.store.doc.page && { ...a.store.doc.page };
    r.expected = pageWorldSize('a4', 'landscape');
    r.roundTrip = paperForPage(a.store.doc.page);

    // ink outside the sheet must survive - a page is a guide, not a crop
    a.store.add({ id: 'faroff', type: 'shape', kind: 'rect', x: 5000, y: 5000, w: 100, h: 100,
                  rotation: 0, stroke: '#000', fill: 'none', lineWidth: 2 });
    r.objectsWithPage = a.store.objects.length;
    await a.setPageSize('infinite');
    r.backToInfinite = a.store.doc.page === null;
    r.objectsAfter = a.store.objects.length;
    r.farStillThere = !!a.store.get('faroff');

    // and it survives a save/load round trip
    await a.setPageSize('letter', 'portrait');
    const saved = a.store.toJSON();
    r.savedPage = saved.page && { ...saved.page };
    a.newBoard(true);
    await a.loadBoard(saved, { silent: true });
    r.loadedPage = a.store.doc.page && { ...a.store.doc.page };

    // the sheet is drawn centred on the origin
    const rect = pageRect({ w: 800, h: 600 }, { x: 0, y: 0, z: 1 });
    r.sheetAtOrigin = rect;
    r.sheetZoomed = pageRect({ w: 800, h: 600 }, { x: 0, y: 0, z: 0.5 });

    // undo steps back to whatever the canvas was before, infinite included
    await a.setPageSize('infinite');
    await a.setPageSize('a3', 'landscape');
    const beforeUndo = a.store.doc.page && a.store.doc.page.w;
    a.command('edit.undo');
    r.undoWent = { before: beforeUndo, after: a.store.doc.page };

    a.newBoard(true); a.store.clear();
    return r;
  `);

  check('a new board is an infinite canvas', canvas.defaultIsInfinite === true);
  check('choosing A4 landscape sets a sheet of the right size',
    canvas.a4 && canvas.a4.w === canvas.expected.w && canvas.a4.h === canvas.expected.h,
    JSON.stringify(canvas.a4));
  check('the sheet is recognised as the paper it came from',
    canvas.roundTrip && canvas.roundTrip.paper === 'a4' && canvas.roundTrip.orientation === 'landscape',
    JSON.stringify(canvas.roundTrip));
  check('work outside the sheet is never destroyed',
    canvas.objectsAfter === canvas.objectsWithPage && canvas.farStillThere,
    `${canvas.objectsWithPage} -> ${canvas.objectsAfter}`);
  check('switching back to infinite is one click', canvas.backToInfinite === true);
  check('the page size is saved with the board and comes back',
    canvas.loadedPage && canvas.savedPage && canvas.loadedPage.w === canvas.savedPage.w
      && canvas.loadedPage.h === canvas.savedPage.h,
    JSON.stringify([canvas.savedPage, canvas.loadedPage]));
  check('the sheet is centred on the origin',
    canvas.sheetAtOrigin.x === -400 && canvas.sheetAtOrigin.y === -300
      && canvas.sheetAtOrigin.w === 800 && canvas.sheetAtOrigin.h === 600,
    JSON.stringify(canvas.sheetAtOrigin));
  check('the sheet scales with the zoom',
    canvas.sheetZoomed.w === 400 && canvas.sheetZoomed.h === 300, JSON.stringify(canvas.sheetZoomed));
  check('changing the canvas size can be undone',
    canvas.undoWent.before > 0 && canvas.undoWent.after === null, JSON.stringify(canvas.undoWent));

  const pageOpen = await js(`
    const a = window.app;
    a.newBoard(true);
    await a.setPageSize('a4', 'portrait');
    const saved = a.store.toJSON();
    saved.camera = { x: 0, y: 0, z: 1 };          // a camera that shows a corner
    a.newBoard(true);
    await a.loadBoard(saved, { silent: true, startup: true });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const sf = a.surface, page = a.store.doc.page;
    // the whole sheet has to be inside the window
    const view = sf.cam.viewport(sf.width, sf.height);
    return {
      z: sf.cam.z,
      fits: view.w >= page.w && view.h >= page.h,
      pageH: page.h, viewH: Math.round(view.h)
    };
  `);
  check('a board on a sheet opens showing the whole sheet, not a corner of it',
    pageOpen.fits && pageOpen.z < 1, JSON.stringify(pageOpen));

  const pageTpl = await js(`
    const { TEMPLATES } = await import('app://board/js/templates.js');
    const a = window.app;
    a.newBoard(true);
    const tpl = TEMPLATES.find(t => t.id === 'page-a4-p');
    a.applyTemplate(tpl);
    await new Promise(r => setTimeout(r, 60));
    return {
      group: tpl.group,
      count: TEMPLATES.filter(t => t.page).length,
      page: a.store.doc.page && { ...a.store.doc.page },
      objectsAdded: a.store.objects.length
    };
  `);
  check('page sizes are offered in Templates, before you start inking',
    pageTpl.count >= 5 && pageTpl.group === 'Canvas size', `${pageTpl.count} in "${pageTpl.group}"`);
  check('picking one sets the page and adds nothing to the board',
    pageTpl.page && pageTpl.page.h > pageTpl.page.w && pageTpl.objectsAdded === 0,
    JSON.stringify(pageTpl));

  const pageExport = await js(`
    const a = window.app;
    a.newBoard(true);
    a.store.add({ id: 'tiny', type: 'shape', kind: 'rect', x: -20, y: -20, w: 40, h: 40,
                  rotation: 0, stroke: '#000', fill: 'none', lineWidth: 2 });
    await a.setPageSize('a4', 'portrait');
    const { exportBoundsForTest } = await import('app://board/js/export.js');
    return exportBoundsForTest(a);
  `);
  check('exports use the sheet, not just what you happened to draw',
    Math.abs(pageExport.w - 794) < 2 && Math.abs(pageExport.h - 1123) < 2,
    JSON.stringify(pageExport));

  await js(`window.app.newBoard(true); window.app.store.clear();`);

  /* ---- nothing falls off the sheet without you knowing ---- *
   * A slide imports at about 1536 units wide; A4 is 794. Before this was
   * handled, importing onto a sheet put half the page over the edge and the
   * export cropped it silently.
   */
  const offpage = await js(`
    const a = window.app;
    const { insertDocument } = await import('app://board/js/insert.js');
    const r = {};

    a.newBoard(true);
    await a.setPageSize('a4', 'portrait');
    await insertDocument(a, ${JSON.stringify(path.join(FIX, 'lecture-09-greedy.pptx'))}, { pages: [1], layout: 'row' });
    const page = a.store.doc.page;
    const img = a.store.objects.find(o => o.type === 'image');
    r.imported = img && { w: Math.round(img.w), h: Math.round(img.h), x: Math.round(img.x), y: Math.round(img.y) };
    r.page = { w: page.w, h: page.h };
    r.fitsOnSheet = a.offPageObjects().length === 0;

    // something dragged well off the sheet is detected
    a.store.add({ id: 'stray', type: 'shape', kind: 'rect', x: 4000, y: 4000, w: 100, h: 100,
                  rotation: 0, stroke: '#000', fill: 'none', lineWidth: 2 });
    r.strayDetected = a.offPageObjects().length;

    // and the one-click fix brings it back inside, without distorting anything
    const beforeAspect = (() => { const o = a.store.get(img.id); return o.w / o.h; })();
    a.fitContentToPage();
    const after = a.store.get(img.id);
    r.afterFit = { off: a.offPageObjects().length, aspect: after.w / after.h, beforeAspect };
    r.strayStillExists = !!a.store.get('stray');

    // and it is one undo
    a.command('edit.undo');
    r.afterUndo = a.offPageObjects().length;

    // an infinite board never reports anything off-page
    await a.setPageSize('infinite');
    r.infiniteOff = a.offPageObjects().length;

    a.newBoard(true); a.store.clear();
    return r;
  `);

  check('an imported page is scaled to land on the sheet',
    offpage.imported && offpage.imported.w <= offpage.page.w && offpage.imported.h <= offpage.page.h,
    JSON.stringify(offpage.imported) + ' vs ' + JSON.stringify(offpage.page));
  check('and it lands on the sheet, not hanging off the edge', offpage.fitsOnSheet === true);
  check('work dragged off the sheet is detected', offpage.strayDetected === 1,
    String(offpage.strayDetected));
  check('fitting everything on brings it all back inside',
    offpage.afterFit.off === 0, String(offpage.afterFit.off));
  check('fitting keeps the aspect ratio, so pages are not squashed',
    Math.abs(offpage.afterFit.aspect - offpage.afterFit.beforeAspect) < 0.01,
    `${offpage.afterFit.beforeAspect} -> ${offpage.afterFit.aspect}`);
  check('fitting moves things, it never deletes them', offpage.strayStillExists === true);
  check('fitting the board to the page is a single undo', offpage.afterUndo === 1,
    String(offpage.afterUndo));
  check('an infinite canvas has no off-page concept', offpage.infiniteOff === 0);

  /* ---- PDF export with page sizes ---- */
  const pdfDir = path.join(OUT, 'pdf');
  await fs.mkdir(pdfDir, { recursive: true });
  const pdfPaths = {
    a4: path.join(pdfDir, 'a4-landscape.pdf'),
    tiled: path.join(pdfDir, 'a5-tiled.pdf'),
    fitted: path.join(pdfDir, 'board-shaped.pdf')
  };
  const pdfL = await js(`
    const a = window.app;
    const { layoutPages } = await import('app://board/js/ui/pdfdialog.js');
    const { exportPdf } = await import('app://board/js/export.js');
    const r = {};
    r.a4 = layoutPages({x:0,y:0,w:1200,h:700}, {paper:'a4', orientation:'landscape', margin:'narrow', mode:'fit'});
    r.tile = layoutPages({x:0,y:0,w:2400,h:3000}, {paper:'a4', orientation:'portrait', margin:'narrow', mode:'tile', scale:1});
    r.shaped = layoutPages({x:0,y:0,w:960,h:540}, {paper:'fit', margin:'none'});
    r.letterPortrait = layoutPages({x:0,y:0,w:400,h:400}, {paper:'letter', orientation:'portrait', margin:'normal', mode:'fit'});

    a.newBoard(true);
    a.store.add({ id:'pt', type:'text', x:100, y:100, w:500, h:60, text:'PDF export test',
      fontSize:40, color:'#201f1e', align:'left', valign:'top', rotation:0, font:'hand', background:'none' });
    a.store.add({ id:'ps', type:'shape', kind:'ellipse', x:120, y:200, w:300, h:180,
      rotation:0, stroke:'#e81123', fill:'none', lineWidth:4 });
    r.wroteA4     = await exportPdf(a, { paper:'a4', orientation:'landscape', margin:'narrow', mode:'fit',  quality:2,   filePath:${JSON.stringify(pdfPaths.a4)} });
    r.wroteTiled  = await exportPdf(a, { paper:'a5', orientation:'portrait',  margin:'none',   mode:'tile', scale:1, quality:1.5, filePath:${JSON.stringify(pdfPaths.tiled)} });
    r.wroteFitted = await exportPdf(a, { paper:'fit', margin:'narrow', mode:'fit', quality:2, filePath:${JSON.stringify(pdfPaths.fitted)} });
    a.store.clear();
    return r;
  `);

  check('A4 landscape is 297 x 210 mm and one sheet',
    pdfL.a4.cols === 1 && pdfL.a4.rows === 1 && Math.round(pdfL.a4.pageW) === 297 && Math.round(pdfL.a4.pageH) === 210,
    `${pdfL.a4.pageW} x ${pdfL.a4.pageH}, ${pdfL.a4.cols}x${pdfL.a4.rows}`);
  check('fitting a wide board on one page scales it down, never up',
    pdfL.a4.scale > 0 && pdfL.a4.scale < 1, String(pdfL.a4.scale));
  check('a board taller than the paper tiles across several sheets',
    pdfL.tile.cols === 4 && pdfL.tile.rows === 3, `${pdfL.tile.cols} x ${pdfL.tile.rows}`);
  check('Letter portrait is 215.9 x 279.4 mm',
    Math.round(pdfL.letterPortrait.pageW * 10) === 2159 && Math.round(pdfL.letterPortrait.pageH * 10) === 2794,
    `${pdfL.letterPortrait.pageW} x ${pdfL.letterPortrait.pageH}`);
  check('"Fit board" makes the page the shape of the board',
    Math.abs(pdfL.shaped.pageW / pdfL.shaped.pageH - 960 / 540) < 0.01,
    `${pdfL.shaped.pageW} x ${pdfL.shaped.pageH}`);
  check('the margin is subtracted from the printable area',
    Math.round(pdfL.letterPortrait.pageW - pdfL.letterPortrait.innerW) === 30, // 15mm each side
    String(pdfL.letterPortrait.pageW - pdfL.letterPortrait.innerW));

  // and the files themselves
  const mediaBoxes = async (file) => {
    const buf = await fs.readFile(file);
    const txt = buf.toString('latin1');
    const boxes = [...txt.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g)]
      .map((m) => ({ w: +m[3] - +m[1], h: +m[4] - +m[2] }));
    return { header: txt.slice(0, 5), size: buf.length, boxes };
  };
  const fA4 = await mediaBoxes(pdfPaths.a4);
  const fTiled = await mediaBoxes(pdfPaths.tiled);
  const fFitted = await mediaBoxes(pdfPaths.fitted);
  const mm = (pt) => (pt / 72) * 25.4;

  check('the export writes a real PDF file', fA4.header === '%PDF-' && fA4.size > 2000,
    `${fA4.header} ${fA4.size} bytes`);
  check('the A4 file really is one A4 landscape page',
    fA4.boxes.length === 1 && Math.abs(mm(fA4.boxes[0].w) - 297) < 1 && Math.abs(mm(fA4.boxes[0].h) - 210) < 1,
    JSON.stringify(fA4.boxes.map((b) => [Math.round(mm(b.w)), Math.round(mm(b.h))])));
  check('the tiled file really has more than one page, all A5 portrait',
    fTiled.boxes.length > 1 && fTiled.boxes.every((b) => Math.abs(mm(b.w) - 148) < 1 && Math.abs(mm(b.h) - 210) < 1),
    JSON.stringify(fTiled.boxes.map((b) => [Math.round(mm(b.w)), Math.round(mm(b.h))])));
  check('the board-shaped file is one page that is not a standard size',
    fFitted.boxes.length === 1 && Math.abs(mm(fFitted.boxes[0].w) - 297) > 2,
    JSON.stringify(fFitted.boxes.map((b) => [Math.round(mm(b.w)), Math.round(mm(b.h))])));
  check('an empty board refuses to export rather than writing a blank PDF',
    (await js(`const a = window.app; a.newBoard(true); const r = await a.exportPdfWithSetup(); return r;`)) === null);

  /* ---- the name plate ---- */
  const document_title = await js(`return document.title;`);
  await js(`await window.app.showAbout();`);
  await sleep(250);
  const about = await js(`const c = document.getElementById('overlayCard');
    return { title: c.querySelector('h3').textContent, html: c.innerHTML };`);
  check('About names the app GazBoard', /^GazBoard \d+\.\d+\.\d+$/.test(about.title.trim()), about.title);
  check('About carries the theBoringCode brand', about.html.includes('theBoringCode'));
  check('About credits the developer and a way to reach him',
    about.html.includes('MD. Fakhruddin Gazzali') && about.html.includes('mailto:fahim9778@gmail.com'));
  check('About says how it was built', about.html.includes('Claude Cowork'));
  check('the window still answers to the new name', document_title.includes('GazBoard'), document_title);
  await shot(win, '21-about');
  await js(`document.getElementById('overlay').classList.remove('show');`);

  /* ---- errors ---- */
  const errs = await js(`return window.__errors || [];`);
  check('no uncaught renderer errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  await fs.writeFile(path.join(OUT, 'results.txt'), results.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  app.exit(fail ? 1 : 0);
}

module.exports = { run };
