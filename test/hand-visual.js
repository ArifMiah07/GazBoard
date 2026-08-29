'use strict';
const path=require('node:path'), fs=require('node:fs/promises');

// A cursive-ish "this is what it looks like" traced as pressure points, so the
// result can be compared with the reference screenshot.
function word(x0, y0, scale, seed) {
  const pts = [];
  let t = 0;
  for (let i = 0; i <= 900; i++) {
    t = i / 900;
    const wob = Math.sin(t * 61 + seed) * 0.5 + Math.sin(t * 23 + seed * 2) * 0.9;
    const x = x0 + t * 620 * scale;
    const y = y0 + (Math.sin(t * 37 + seed) * 26 + Math.sin(t * 11 + seed) * 14 + wob * 3) * scale;
    // realistic stylus pressure: rises fast, drifts, drops at the end
    const p = Math.min(1, Math.max(0.15,
      0.62 + Math.sin(t * 9 + seed) * 0.22 + Math.sin(t * 31) * 0.08));
    pts.push({ x, y, p });
  }
  return pts;
}

async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  await new Promise(r=>setTimeout(r,900));
  await js(`
    const a = window.app, sf = a.surface;
    a.newBoard(true); sf.cam.x = 30; sf.cam.y = 30; sf.cam.z = 1;
    const data = ${JSON.stringify([word(60, 140, 1, 0.3), word(60, 320, 1, 1.7), word(60, 500, 1, 3.1)])};
    const widths = [5, 8, 12];
    data.forEach((pts, i) => {
      a.store.add({ id: 'h' + i, type: 'stroke', tool: 'pen', color: '#e81123', width: widths[i],
        effect: 'none', points: pts, rotation: 0,
        bbox: { x: 40, y: 100 + i * 180, w: 700, h: 140 } });
    });
    // a long underline: the classic place a taper shows as a brush flare
    const line = [];
    for (let i = 0; i <= 300; i++) line.push({ x: 70 + i * 2.4, y: 640 + Math.sin(i / 40) * 5, p: 0.55 + Math.sin(i / 60) * 0.25 });
    a.store.add({ id: 'ul', type: 'stroke', tool: 'pen', color: '#e81123', width: 8, effect: 'none',
      points: line, rotation: 0, bbox: { x: 60, y: 620, w: 740, h: 40 } });
    sf.invalidate();
  `);
  await new Promise(r=>setTimeout(r,700));
  await fs.writeFile(path.join(__dirname,'out','16-handwriting.png'), (await win.webContents.capturePage()).toPNG());
  const stats = await js(`
    const { strokeRibbon } = await import('app://board/js/core/ink.js');
    const s = window.app.store.get('h1');
    const rib = strokeRibbon(s.points, s.width, { pressure: true, taper: true });
    const w = rib.centre.map((_, i) => Math.hypot(rib.left[i].x - rib.right[i].x, rib.left[i].y - rib.right[i].y));
    const mid = w.slice(20, w.length - 20);
    return { nominal: s.width, min: +Math.min(...mid).toFixed(2), max: +Math.max(...mid).toFixed(2),
             ratio: +(Math.max(...mid) / Math.min(...mid)).toFixed(2), endW: +w[0].toFixed(2) };
  `);
  console.log('HAND ' + JSON.stringify(stats));
  app.exit(0);
}
module.exports={run};
