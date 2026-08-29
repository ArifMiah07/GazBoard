'use strict';
const path=require('node:path'), fs=require('node:fs/promises');
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  const shot=async(n)=>fs.writeFile(path.join(__dirname,'out',n+'.png'),(await win.webContents.capturePage()).toPNG());
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  await sleep(900);
  await js(`
    const a = window.app, sf = a.surface;
    a.newBoard(true); sf.cam.x = 60; sf.cam.y = 40; sf.cam.z = 1;
    a.store.setBackground({ pattern: 'grid' });
    const pts = [];
    for (let t = 0; t <= Math.PI * 4; t += 0.05)
      pts.push({ x: 80 + t * 34, y: 220 + 34 * Math.sin(t) + 12 * Math.sin(2.6 * t), p: 0.6 });
    a.store.add({ id: 'ink', type: 'stroke', tool: 'pen', color: '#201f1e', width: 6, effect: 'none',
      points: pts, rotation: 0, bbox: { x: 80, y: 160, w: 460, h: 120 } });
    a.store.add({ id: 'n', type: 'note', x: 620, y: 170, w: 190, h: 190, color: '#ffd94a',
      text: 'sticky note', rotation: 0, align: 'center', font: 'hand' });
    a.store.add({ id: 't', type: 'text', x: 120, y: 360, w: 420, h: 60, text: 'handwriting font',
      fontSize: 36, color: '#6264a7', align: 'left', valign: 'top', rotation: 0, font: 'hand' });
    a.setTool('pen'); a.settings.penColor = '#e81123'; a.settings.penEffect = 'none';
    a.syncUI();
  `);
  await sleep(500);
  await shot('18-toolbar');
  await js(`window.app.command('zoomIn');`);
  await sleep(200);
  await shot('19-zoom-pill');
  console.log('UI done');
  app.exit(0);
}
module.exports={run};
