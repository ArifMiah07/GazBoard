'use strict';
const path=require('node:path'), fs=require('node:fs/promises');
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  const shot=async(n)=>fs.writeFile(path.join(__dirname,'out',n+'.png'),(await win.webContents.capturePage()).toPNG());
  await new Promise(r=>setTimeout(r,900));
  await js(`
    const a = window.app; a.newBoard(true);
    a.surface.cam.z = 1; a.surface.cam.x = 120; a.surface.cam.y = 120;
    const mk = (y, color, width, effect) => {
      const pts = [];
      for (let i = 0; i <= 160; i++) pts.push({ x: i * 7, y: y + Math.sin(i / 9) * 34, p: 0.35 + Math.abs(Math.sin(i / 20)) * 0.6 });
      return { id: 'ink' + y, type: 'stroke', tool: 'pen', color, width, effect, hue: 20,
        points: pts, bbox: { x: 0, y: y - 40, w: 1120, h: 80 }, rotation: 0 };
    };
    a.store.addMany([mk(90,'#201f1e',7,'none'), mk(230,'#e81123',12,'none'), mk(370,'#0078d4',9,'rainbow'), mk(510,'#8764b8',10,'galaxy')]);
    a.store.add({ id: 'hl', type: 'stroke', tool: 'highlighter', color: '#fff100', width: 34, opacity: .38,
      points: Array.from({length: 60}, (_, i) => ({ x: i * 19, y: 640, p: .5 })), bbox: { x: 0, y: 620, w: 1120, h: 40 }, rotation: 0 });
    a.setTool('eraser');
  `);
  await new Promise(r=>setTimeout(r,400));
  await shot('05-erase-before');
  await js(`
    const a = window.app, it = a.interaction;
    a.settings.eraserMode = 'partial'; a.settings.eraserSize = 46;
    // one continuous S-shaped sweep across every stroke
    const path = [];
    for (let i = 0; i <= 60; i++) path.push({ x: 360 + Math.sin(i / 9) * 180, y: 40 + i * 11 });
    it.startErase(path[0]);
    for (let i = 1; i < path.length; i++) it.eraseSweep(it.action, path[i-1], path[i]);
    it.finishErase(it.action); it.action = null;
    // and a short dab through the highlighter
    it.startErase({ x: 820, y: 610 });
    it.eraseSweep(it.action, { x: 820, y: 610 }, { x: 900, y: 670 });
    it.finishErase(it.action); it.action = null;
    a.surface.invalidate();
    return a.store.count;
  `).then(n => console.log('objects after erase:', n));
  await new Promise(r=>setTimeout(r,500));
  await shot('06-erase-after');
  const u = await js(`
    const a = window.app; a.store.undo(); a.store.undo(); a.surface.invalidate();
    return a.store.count;
  `);
  console.log('objects after undo x2:', u);
  await new Promise(r=>setTimeout(r,400));
  await shot('07-erase-undone');
  app.exit(0);
}
module.exports={run};
