'use strict';
const path=require('node:path'), fs=require('node:fs/promises');
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  const shot=async(n)=>fs.writeFile(path.join(__dirname,'out',n+'.png'),(await win.webContents.capturePage()).toPNG());
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  await sleep(900);
  await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.settings.inkWithMouse = 'auto'; a.settings.penSeen = false;
    a.setTool('pen'); a.settings.penColor = '#e81123'; a.settings.penWidth = 8;
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x,y,id,type) => ({ pointerId:id, pointerType:type, button:0, buttons:1,
      clientX: rect.left+x, clientY: rect.top+y, shiftKey:false, altKey:false, pressure:0.6 });
    // stylus writes
    it.onDown(ev(260,260,1,'pen'));
    for (let i=0;i<=40;i++) it.onMove(ev(260+i*12, 260+Math.sin(i/5)*45, 1,'pen'));
    it.onUp(ev(740,260,1,'pen'));
    it.action=null; it.pointers.clear();
  `);
  await sleep(700);
  await shot('09-roles-stylus');
  await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x,y,id,type) => ({ pointerId:id, pointerType:type, button:0, buttons:1,
      clientX: rect.left+x, clientY: rect.top+y, shiftKey:false, altKey:false, pressure:0.5 });
    // same pen tool still selected - now drag with the MOUSE
    it.onDown(ev(300,500,2,'mouse'));
    for (let i=1;i<=20;i++) it.onMove(ev(300-i*14, 500-i*6, 2,'mouse'));
    it.onUp(ev(20,380,2,'mouse'));
    it.action=null; it.pointers.clear();
    return { tool: a.tool, strokes: a.store.objects.filter(o=>o.type==='stroke').length, camX: Math.round(sf.cam.x) };
  `).then(r=>console.log('ROLES ' + JSON.stringify(r)));
  await sleep(600);
  await shot('10-roles-mouse-panned');
  app.exit(0);
}
module.exports={run};
