'use strict';
const path=require('node:path'), fs=require('node:fs/promises');
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  const shot=async(n)=>fs.writeFile(path.join(__dirname,'out',n+'.png'),(await win.webContents.capturePage()).toPNG());
  await new Promise(r=>setTimeout(r,900));
  await js(`
    const a = window.app, sf = a.surface;
    a.newBoard(true); sf.cam.x = 40; sf.cam.y = 20; sf.cam.z = 1;
    const mk = (y, color, width, effect, tool) => {
      const pts = [];
      for (let i = 0; i <= 150; i++) {
        const t = i / 150;
        pts.push({ x: 40 + i * 8.4, y: y + Math.sin(i / 11) * 46 + Math.sin(i / 3.1) * 4,
                   p: 0.18 + Math.abs(Math.sin(i / 26)) * 0.82 });
      }
      return { id: 'k' + y + tool, type: 'stroke', tool: tool || 'pen', color, width, effect, hue: 30,
               opacity: tool === 'highlighter' ? 0.38 : 1,
               points: pts, bbox: { x: 40, y: y - 55, w: 1270, h: 110 }, rotation: 0 };
    };
    a.store.addMany([
      mk(90, '#201f1e', 9, 'none'),
      mk(230, '#e81123', 16, 'none'),
      mk(370, '#0078d4', 12, 'rainbow'),
      mk(510, '#8764b8', 13, 'galaxy'),
      mk(650, '#fff100', 34, 'none', 'highlighter')
    ]);
    // a tight cursive loop - where joints used to show
    const loop = [];
    for (let i = 0; i <= 260; i++) {
      const t = i / 260 * Math.PI * 6;
      loop.push({ x: 220 + t * 52, y: 810 + Math.sin(t) * 58 + Math.cos(t * 2) * 14,
                  p: 0.35 + Math.abs(Math.sin(t)) * 0.6 });
    }
    a.store.add({ id: 'cursive', type: 'stroke', tool: 'pen', color: '#111', width: 7, effect: 'none',
                  points: loop, bbox: { x: 200, y: 730, w: 1100, h: 160 }, rotation: 0 });
    sf.invalidate();
  `);
  await new Promise(r=>setTimeout(r,700));
  await shot('15-ink-quality');
  console.log('INK done');
  app.exit(0);
}
module.exports={run};
