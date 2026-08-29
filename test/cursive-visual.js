'use strict';
const path=require('node:path'), fs=require('node:fs/promises');

// Parametric cursive: a looping baseline the way joined-up writing moves,
// sampled at a rate a stylus would report on a fast hand.
function cursive(ox, oy, size, step) {
  const P = [];
  for (let t = 0; t <= Math.PI * 7; t += step) {
    const x = ox + t * 26 * size;
    const y = oy - (28 * Math.sin(t) + 11 * Math.sin(2.6 * t + 0.7) + 5 * Math.sin(4.1 * t)) * size;
    // pressure as a stylus reports it: rises at the start, drifts, eases off
    const u = t / (Math.PI * 7);
    const p = Math.min(1, Math.max(0.2, 0.55 + 0.25 * Math.sin(u * 7) + 0.1 * Math.sin(u * 23)));
    P.push({ x, y, p });
  }
  return P;
}

async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  await new Promise(r=>setTimeout(r,900));
  await js(`
    const a = window.app, sf = a.surface;
    a.newBoard(true); sf.cam.x = 30; sf.cam.y = 10; sf.cam.z = 1;
    const rows = ${JSON.stringify([
      { pts: cursive(40, 150, 1, 0.05), w: 5, c: '#201f1e' },   // slow hand, thin pen
      { pts: cursive(40, 330, 1, 0.22), w: 5, c: '#201f1e' },   // fast hand: sparse samples
      { pts: cursive(40, 510, 1, 0.22), w: 9, c: '#e81123' },   // fast hand, thicker pen
      { pts: cursive(40, 690, 1, 0.34), w: 7, c: '#0078d4' }    // very sparse
    ])};
    rows.forEach((r, i) => a.store.add({
      id: 'c' + i, type: 'stroke', tool: 'pen', color: r.c, width: r.w, effect: 'none',
      points: r.pts, rotation: 0, bbox: { x: 20, y: 60 + i * 180, w: 900, h: 150 }
    }));
    sf.invalidate();
  `);
  await new Promise(r=>setTimeout(r,700));
  await fs.writeFile(path.join(__dirname,'out','17-cursive.png'), (await win.webContents.capturePage()).toPNG());
  const m = await js(`
    const { strokeRibbon } = await import('app://board/js/core/ink.js');
    const out = {};
    for (const id of ['c0', 'c1', 'c3']) {
      const s = window.app.store.get(id);
      const rib = strokeRibbon(s.points, s.width, { pressure: true, taper: true });
      const w = rib.centre.map((_, i) => Math.hypot(rib.left[i].x - rib.right[i].x, rib.left[i].y - rib.right[i].y));
      const body = w.slice(8, w.length - 8);
      let maxTurn = 0;
      for (let i = 2; i < rib.centre.length; i++) {
        const a1 = Math.atan2(rib.centre[i-1].y - rib.centre[i-2].y, rib.centre[i-1].x - rib.centre[i-2].x);
        const a2 = Math.atan2(rib.centre[i].y - rib.centre[i-1].y, rib.centre[i].x - rib.centre[i-1].x);
        let d = Math.abs(a2 - a1); if (d > Math.PI) d = Math.PI * 2 - d;
        maxTurn = Math.max(maxTurn, d);
      }
      out[id] = { input: s.points.length, samples: rib.centre.length,
                  ratio: +(Math.max(...body) / Math.min(...body)).toFixed(2),
                  maxTurnDeg: +(maxTurn * 180 / Math.PI).toFixed(1) };
    }
    return out;
  `);
  console.log('CURSIVE ' + JSON.stringify(m));
  app.exit(0);
}
module.exports={run};
