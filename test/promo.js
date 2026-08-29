'use strict';
const path = require('node:path'), fs = require('node:fs/promises');

async function run(win, app) {
  const js = (c) => win.webContents.executeJavaScript(`(async()=>{${c}})()`, true);
  const shot = async (n) => fs.writeFile(path.join(__dirname, 'promo', n + '.png'),
    (await win.webContents.capturePage()).toPNG());
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  await fs.mkdir(path.join(__dirname, 'promo'), { recursive: true });
  await sleep(1000);

  // Shared helpers injected once into the page.
  await js(`
    window.P = {};
    P.rnd = (() => { let s = 7; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; })();
    // a hand-drawn looking path through waypoints, with the wobble a real hand leaves
    P.ink = (pts, jitter = 1.6, step = 0.045) => {
      const out = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        for (let t = 0; t < 1; t += step) {
          const e = 3 * t * t - 2 * t * t * t;              // ease so speed varies like a hand
          out.push({ x: a[0] + (b[0] - a[0]) * e + (P.rnd() - .5) * jitter,
                     y: a[1] + (b[1] - a[1]) * e + (P.rnd() - .5) * jitter,
                     p: 0.45 + 0.35 * Math.sin(t * 3 + i) + P.rnd() * 0.12 });
        }
      }
      out.push({ x: pts[pts.length-1][0], y: pts[pts.length-1][1], p: 0.5 });
      return out;
    };
    P.arc = (cx, cy, rx, ry, from, to, jitter = 1.4) => {
      const out = [];
      for (let a = from; a <= to; a += 0.06)
        out.push({ x: cx + Math.cos(a) * rx + (P.rnd()-.5)*jitter,
                   y: cy + Math.sin(a) * ry + (P.rnd()-.5)*jitter,
                   p: 0.5 + 0.25 * Math.sin(a * 2) });
      return out;
    };
    P.bbox = (pts) => {
      let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
      for (const p of pts){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}
      return { x:x0, y:y0, w:x1-x0, h:y1-y0 };
    };
    let n = 0;
    P.stroke = (pts, color, width, effect) => {
      const a = window.app;
      a.store.add({ id: 'k' + (n++), type: 'stroke', tool: effect === 'hl' ? 'highlighter' : 'pen',
        color, width, effect: 'none', opacity: effect === 'hl' ? 0.32 : 1,
        points: pts, rotation: 0, bbox: P.bbox(pts) });
    };
    P.text = (x, y, w, s, size, color, font) => window.app.store.add({
      id: 't' + (n++), type: 'text', x, y, w, h: size * 1.5, text: s, fontSize: size,
      color, align: 'left', valign: 'top', rotation: 0, font: font || 'hand', background: 'none' });
    P.note = (x, y, w, color, s, font) => window.app.store.add({
      id: 'n' + (n++), type: 'note', x, y, w, h: w, color, text: s, rotation: 0,
      align: 'center', font: font || 'hand' });
    P.shape = (o) => window.app.store.add(Object.assign({ id: 's' + (n++), type: 'shape',
      rotation: 0, stroke: '#201f1e', fill: 'none', lineWidth: 2.5 }, o));
    P.reset = (pattern, name) => {
      const a = window.app;
      a.newBoard(true);
      a.store.setBackground({ pattern: pattern || 'grid' });
      a.setTool('select'); a.setSelection([]);
      if (name) { a.store.rename(name); document.getElementById('boardTitle').value = name; }
      const pill = document.getElementById('zoomPill'); if (pill) pill.style.display = 'none';
      a.surface.cam.x = 0; a.surface.cam.y = 0; a.surface.cam.z = 1;
    };
    // smooth freehand through waypoints - a curve, not a zigzag
    P.curve = (pts, jitter = 1.4) => {
      const out = [];
      const at = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = at(i-1), p1 = at(i), p2 = at(i+1), p3 = at(i+2);
        for (let t = 0; t < 1; t += 0.04) {
          const t2 = t*t, t3 = t2*t;
          const x = 0.5*((2*p1[0]) + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3);
          const y = 0.5*((2*p1[1]) + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3);
          out.push({ x: x + (P.rnd()-.5)*jitter, y: y + (P.rnd()-.5)*jitter, p: 0.5 + 0.22*Math.sin(t*4+i) });
        }
      }
      return out;
    };
    P.frame = (z) => { const sf = window.app.surface; sf.cam.z = z; window.app.syncUI(); sf.invalidate(); };
  `);

  /* ---------------- 1. the hero board: a real lecture ---------------- */
  await js(`
    const a = window.app;
    P.reset('grid', 'CSE221 · shortest paths');

    P.text(70, 55, 760, 'Dijkstra — why greedy works here', 40, '#201f1e');
    P.stroke(P.curve([[72,108],[240,105],[420,110],[620,106]], 1.2), '#e81123', 4);

    const V = { A:[150,240], B:[330,190], C:[330,320], D:[520,240], E:[690,290] };
    for (const k in V) {
      const [x,y] = V[k];
      P.stroke(P.arc(x, y, 30, 30, 0, 6.5, 1.7), '#201f1e', 3);
      P.text(x - 9, y - 17, 40, k, 30, '#201f1e');
    }
    const edge = (p, q, w, lx, ly) => {
      const [x1,y1] = V[p], [x2,y2] = V[q];
      const d = Math.hypot(x2-x1, y2-y1), ux = (x2-x1)/d, uy = (y2-y1)/d;
      P.stroke(P.curve([[x1+ux*32, y1+uy*32],[x2-ux*32, y2-uy*32]], 1.4), '#0078d4', 3);
      P.text(lx, ly, 60, String(w), 24, '#0078d4');
    };
    edge('A','B',4,225,185); edge('A','C',2,215,290); edge('B','D',5,415,190);
    edge('C','D',8,420,300); edge('C','B',1,336,248); edge('D','E',6,595,240);
    P.stroke(P.arc(690, 290, 44, 42, 0, 6.5, 2.2), '#107c10', 4);
    P.text(748, 272, 240, 'target', 26, '#107c10');

    P.text(70, 410, 900, 'dist[v] = min( dist[v],  dist[u] + w(u,v) )', 30, '#6264a7', 'mono');
    P.stroke(P.curve([[68,452],[400,449],[720,453]], 1.6), '#fff100', 26, 'hl');

    P.text(70, 500, 820, 'Question for Sunday: what breaks with a negative edge?', 28, '#201f1e');
    P.stroke(P.curve([[70,556],[300,566],[560,560],[790,552]], 1.6), '#e81123', 3.5);

    P.note(880, 60, 200, '#ffd94a', 'relax every edge once the node is settled');
    P.note(1110, 60, 200, '#a4d4ff', 'no negative weights — that is the catch');
    P.note(880, 290, 200, '#c8f0c8', 'O(E log V) with a binary heap');
    P.note(1110, 290, 200, '#ffc0cb', 'draw it before you code it');

    P.text(70, 610, 900, 'trace from A', 30, '#201f1e');
    P.stroke(P.curve([[72,652],[160,649],[250,653]], 1.2), '#8764b8', 3.5);
    const steps = [['A',0],['C',2],['B',3],['D',8],['E',14]];
    steps.forEach(([k, d], i) => {
      const x = 90 + i * 165;
      P.stroke(P.arc(x, 700, 34, 32, 0, 6.5, 1.8), '#8764b8', 3.5);
      P.text(x - 11, 682, 50, k, 28, '#201f1e');
      P.text(x - 16, 742, 90, String(d), 24, '#8764b8');
      if (i < 4) P.stroke(P.curve([[x + 40, 700],[x + 105, 698]], 1.2), '#605e5c', 3);
      if (i < 4) { P.stroke(P.curve([[x + 105, 698],[x + 88, 689]], 1), '#605e5c', 3);
                   P.stroke(P.curve([[x + 105, 698],[x + 89, 708]], 1), '#605e5c', 3); }
    });
    P.note(880, 610, 200, '#c8f0c8', 'settled order, never revisited');
    P.note(1110, 610, 200, '#ffd94a', 'the heap does the choosing');
    a.surface.invalidate();
  `);
  await sleep(900); await shot('01-hero');

  /* ---------------- 2. annotating an imported slide ---------------- */
  await js(`
    const a = window.app;
    P.reset('dots', 'Greedy algorithms · lecture 9');
    const { insertDocument } = await import('app://board/js/insert.js');
    await insertDocument(a, ${JSON.stringify(path.join(__dirname, 'fixtures', 'lecture-09-greedy.pptx'))},
      { pages: [1], layout: 'row' });
  `);
  await sleep(3000);
  await js(`
    const a = window.app;
    const page = a.store.objects.find(o => o.type === 'image');
    if (page) {
      a.setSelection([page.id]); a.command('object.lock'); a.setSelection([]);
      const x = page.x, y = page.y, w = page.w, h = page.h;
      // ring the left-hand heading
      P.stroke(P.arc(x + w*0.235, y + h*0.268, w*0.175, h*0.048, 0, 6.5, 2.2), '#e81123', 4);
      // circle the counterexample and label it in the margin
      P.stroke(P.arc(x + w*0.605, y + h*0.345, w*0.085, h*0.040, 0, 6.5, 2), '#e81123', 3.5);
      P.stroke(P.curve([[x+w*0.70, y+h*0.325],[x+w*0.755, y+h*0.300],[x+w*0.82, y+h*0.292]], 1.3), '#0078d4', 4);
      P.stroke(P.curve([[x+w*0.70, y+h*0.325],[x+w*0.735, y+h*0.309]], 1.1), '#0078d4', 4);
      P.stroke(P.curve([[x+w*0.70, y+h*0.325],[x+w*0.729, y+h*0.348]], 1.1), '#0078d4', 4);
      P.text(x + w*0.828, y + h*0.272, 260, 'exam favourite', 23, '#0078d4');
      // underline the claim, tick the proof
      P.stroke(P.curve([[x+w*0.068, y+h*0.687],[x+w*0.36, y+h*0.684],[x+w*0.63, y+h*0.689]], 1.4), '#fff100', 24, 'hl');
      P.stroke(P.curve([[x+w*0.70, y+h*0.757],[x+w*0.722, y+h*0.784],[x+w*0.775, y+h*0.722]], 1.2), '#107c10', 5);
      P.stroke(P.curve([[x+w*0.062, y+h*0.648],[x+w*0.24, y+h*0.651],[x+w*0.44, y+h*0.646]], 1.4), '#e81123', 3);
      a.surface.fitToContent && a.surface.fitToContent();
    }
    const pill = document.getElementById('zoomPill'); if (pill) pill.style.display = 'none';
    a.surface.invalidate();
  `);
  await sleep(900); await shot('02-annotate-slide');

  /* ---------------- 3. ink, colour and the pen tray ---------------- */
  await js(`
    const a = window.app;
    P.reset('grid', 'Ink');
    P.text(90, 60, 900, 'Ink that stays exactly as you wrote it', 38, '#201f1e');

    // colour flourishes, drawn as curves rather than lines
    const pens = [['#201f1e',6],['#e81123',7],['#0078d4',8],['#107c10',6],['#8764b8',8],['#ff8c00',7]];
    pens.forEach(([c, w], i) => {
      const y = 175 + i * 62;
      P.stroke(P.curve([[110,y],[190,y-34],[280,y+26],[380,y-30],[470,y+22],[560,y-16],[650,y+6],[740,y-2]], 1.1), c, w);
    });
    P.stroke(P.curve([[110,560],[400,553],[740,558]], 1.5), '#fff100', 32, 'hl');

    // a few things a hand actually draws
    P.stroke(P.arc(920, 200, 78, 74, 0, 6.5, 2.4), '#e81123', 5);
    P.stroke(P.curve([[1080,170],[1120,225],[1230,120]], 1.4), '#107c10', 8);
    P.stroke(P.curve([[880,340],[960,330],[1050,345],[1140,332],[1220,340]], 1.4), '#0078d4', 5);
    P.stroke(P.curve([[1220,340],[1188,322]], 1.2), '#0078d4', 5);
    P.stroke(P.curve([[1220,340],[1186,358]], 1.2), '#0078d4', 5);
    P.note(880, 430, 190, '#ffd94a', 'no smoothing at pen-up');
    P.note(1090, 430, 190, '#a4d4ff', 'pressure from the stylus');
    P.text(110, 620, 900, 'Six pens, a highlighter, and a partial eraser', 34, '#201f1e');
    P.text(110, 680, 1000, 'Erase the crossing of a letter without losing the letter.', 27, '#605e5c');
    P.stroke(P.curve([[108,724],[420,721],[720,725]], 1.5), '#fff100', 26, 'hl');
    P.stroke(P.curve([[880,690],[940,700],[1010,688],[1080,698],[1150,690]], 1.3), '#201f1e', 6);
    P.stroke(P.curve([[1180,690],[1240,700],[1290,688]], 1.3), '#201f1e', 6);

    a.setTool('pen'); a.settings.penColor = '#e81123'; a.syncUI();
    const pill = document.getElementById('zoomPill'); if (pill) pill.style.display = 'none';
    a.surface.invalidate();
  `);
  await sleep(800); await shot('03-pens');

  /* ---------------- 4. a planning wall of sticky notes ---------------- */
  await js(`
    const a = window.app;
    P.reset('plain', 'CSE221 · semester plan');
    P.text(80, 45, 900, 'Semester plan', 44, '#201f1e');
    P.stroke(P.curve([[82,100],[210,97],[330,101]], 1.2), '#e81123', 4);
    const notes = [
      ['#ffd94a','wk 1–3  recurrences'],
      ['#a4d4ff','wk 4–6  divide & conquer'],
      ['#c8f0c8','wk 7–9  greedy proofs'],
      ['#ffc0cb','wk 10–12  DP'],
      ['#ffd94a','wk 13  graphs, shortest paths'],
      ['#a4d4ff','wk 14  NP-hardness'],
      ['#c8f0c8','quiz after every block'],
      ['#ffc0cb','one open-ended project']
    ];
    notes.forEach(([c, t], i) =>
      P.note(90 + (i % 4) * 260, 145 + Math.floor(i / 4) * 260, 225, c, t));
    P.text(90, 690, 900, 'moved a whole block in ten seconds — try that in a slide deck', 26, '#605e5c');
    const pill = document.getElementById('zoomPill'); if (pill) pill.style.display = 'none';
    a.surface.invalidate();
  `);
  await sleep(800); await shot('04-notes');

  /* ---------------- 5. shapes, text and structure ---------------- */
  await js(`
    const a = window.app;
    P.reset('lines', 'System sketch');
    P.text(80, 45, 900, 'How a stroke reaches the screen', 38, '#201f1e');
    const box = (x, y, w, h, label, fill, stroke) => {
      P.shape({ kind: 'roundRect', x, y, w, h, fill, stroke, lineWidth: 2.5 });
      P.text(x + 20, y + h/2 - 16, w - 36, label, 23, '#201f1e');
    };
    box(90, 150, 250, 88, 'pointer events', '#eaf3fb', '#0078d4');
    box(90, 300, 250, 88, 'operation log', '#eaf3fb', '#0078d4');
    box(440, 150, 250, 88, 'ink model', '#f3eefb', '#8764b8');
    box(440, 300, 250, 88, 'canvas 2D', '#f3eefb', '#8764b8');
    box(790, 225, 250, 88, 'your board', '#eafaea', '#107c10');
    P.shape({ kind: 'arrow', x: 215, y: 240, w: 0, h: 58, stroke: '#605e5c', lineWidth: 2.5 });
    P.shape({ kind: 'arrow', x: 342, y: 194, w: 94, h: 0, stroke: '#605e5c', lineWidth: 2.5 });
    P.shape({ kind: 'arrow', x: 342, y: 344, w: 94, h: 0, stroke: '#605e5c', lineWidth: 2.5 });
    P.shape({ kind: 'arrow', x: 692, y: 194, w: 94, h: 62, stroke: '#605e5c', lineWidth: 2.5 });
    P.shape({ kind: 'arrow', x: 692, y: 344, w: 94, h: -62, stroke: '#605e5c', lineWidth: 2.5 });
    P.text(90, 450, 1000, 'the log is the document — undo, redo, and one day a sync layer', 27, '#605e5c');
    P.stroke(P.curve([[88,492],[420,489],[760,493]], 1.5), '#fff100', 24, 'hl');
    P.note(1090, 150, 200, '#ffd94a', 'shapes, arrows and text, not just ink');
    P.text(90, 560, 900, 'and how a document gets in', 32, '#201f1e');
    P.stroke(P.curve([[92,604],[240,601],[400,605]], 1.2), '#e81123', 3.5);
    box(90, 640, 250, 84, 'Word / PPT / PDF', '#fdf3e7', '#d97706');
    box(440, 640, 250, 84, 'pages you pick', '#fdf3e7', '#d97706');
    box(790, 640, 250, 84, 'draw on top', '#eafaea', '#107c10');
    P.shape({ kind: 'arrow', x: 342, y: 682, w: 94, h: 0, stroke: '#605e5c', lineWidth: 2.5 });
    P.shape({ kind: 'arrow', x: 692, y: 682, w: 94, h: 0, stroke: '#605e5c', lineWidth: 2.5 });
    P.note(1090, 560, 200, '#c8f0c8', 'lock the page and the ink rides with it');
    const pill = document.getElementById('zoomPill'); if (pill) pill.style.display = 'none';
    a.surface.invalidate();
  `);
  await sleep(800); await shot('05-shapes');

  console.log('promo shots done');
  app.exit(0);
}
module.exports = { run };
