'use strict';
const path=require('node:path'), fs=require('node:fs/promises');
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  const shot=async(n)=>fs.writeFile(path.join(__dirname,'out',n+'.png'),(await win.webContents.capturePage()).toPNG());
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  await sleep(900);
  const r = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true);
    sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.setTool('pen'); a.settings.penColor = '#0078d4'; a.settings.penWidth = 8; a.settings.edgePan = true;
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y, id, type, extra) => Object.assign({ pointerId: id, pointerType: type, button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.6 }, extra || {});
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    it.onDown(ev(120, 200, 1, 'pen'));
    for (let x = 120; x <= sf.width - 20; x += 14) {
      it.onMove(ev(x, 200 + Math.sin(x / 60) * 60, 1, 'pen'));
      await sleep(6);
    }
    await sleep(1400);                                  // parked at the edge: auto-pan runs
    it.onUp(ev(sf.width - 20, 200, 1, 'pen'));

    const s = a.store.objects.find(o => o.type === 'stroke');
    a.command('fit');
    return { width: Math.round(s.bbox.w), viewport: Math.round(sf.width), points: s.points.length, strokes: a.store.objects.length };
  `);
  console.log('PAN ' + JSON.stringify(r));
  await sleep(500);
  await shot('08-edge-autopan');
  app.exit(0);
}
module.exports={run};
