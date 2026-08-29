'use strict';
const path=require('node:path'), fs=require('node:fs/promises');
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  await sleep(900);
  await js(`
    const a = window.app; a.newBoard(true);
    a.store.setBackground({ pattern: 'grid' });
    a.store.add({ id:'m', type:'text', x:-300, y:-40, w:600, h:80, text:'edge to edge',
      fontSize:44, color:'#6264a7', align:'center', valign:'middle', rotation:0 });
    a.command('fit');
  `);
  win.setSize(1400, 900); await sleep(700);
  const info = await js(`
    const sf = window.app.surface, c = sf.canvas;
    const r = c.getBoundingClientRect();
    return {
      dpr: window.devicePixelRatio,
      innerW: window.innerWidth, innerH: window.innerHeight,
      canvas: Math.round(r.width) + 'x' + Math.round(r.height),
      buffer: c.width + 'x' + c.height,
      right: Math.round(r.right), docW: document.documentElement.clientWidth,
      fillsWidth: Math.abs(r.right - document.documentElement.clientWidth) < 1.5,
      bottomGap: Math.round(document.documentElement.clientHeight - r.bottom)
    };
  `);
  console.log('DPI ' + JSON.stringify(info));
  await fs.writeFile(path.join(__dirname,'out','12-dpi-scaled.png'), (await win.webContents.capturePage()).toPNG());
  app.exit(0);
}
module.exports={run};
