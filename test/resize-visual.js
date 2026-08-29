'use strict';
const path=require('node:path'), fs=require('node:fs/promises');
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  const shot=async(n)=>fs.writeFile(path.join(__dirname,'out',n+'.png'),(await win.webContents.capturePage()).toPNG());
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  await sleep(900);
  await js(`
    const a = window.app; a.newBoard(true);
    a.store.setBackground({ pattern: 'grid' });
    a.store.add({ id:'m', type:'text', x:-260, y:-40, w:520, h:80, text:'canvas fills the window',
      fontSize:40, color:'#6264a7', align:'center', valign:'middle', rotation:0 });
    a.command('fit');
  `);
  win.setSize(1500, 950); await sleep(500);
  win.webContents.setZoomFactor(1.25);            // the display-scaling case from the report
  await sleep(700);
  await shot('11-resize-dpr');
  const info = await js(`
    const sf = window.app.surface, r = sf.canvas.getBoundingClientRect();
    const s = document.getElementById('stage').getBoundingClientRect();
    return { canvas: Math.round(r.width)+'x'+Math.round(r.height), stage: Math.round(s.width)+'x'+Math.round(s.height),
             dpr: sf.dpr, buffer: sf.canvas.width+'x'+sf.canvas.height };
  `);
  console.log('RESIZE ' + JSON.stringify(info));
  app.exit(0);
}
module.exports={run};
