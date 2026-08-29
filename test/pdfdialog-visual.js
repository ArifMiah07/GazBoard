'use strict';
const path=require('node:path'), fs=require('node:fs/promises');
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  const shot=async(n)=>fs.writeFile(path.join(__dirname,'out',n+'.png'),(await win.webContents.capturePage()).toPNG());
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  await sleep(900);
  await js(`
    const a = window.app;
    a.newBoard(true);
    a.store.setBackground({ pattern: 'grid' });
    a.store.add({ id:'t', type:'text', x:80, y:80, w:600, h:60, text:'Lecture notes',
      fontSize:42, color:'#201f1e', align:'left', valign:'top', rotation:0, font:'hand', background:'none' });
    a.store.add({ id:'n', type:'note', x:700, y:80, w:200, h:200, color:'#ffd94a', text:'export me', rotation:0, align:'center', font:'hand' });
    const { choosePageSetup } = await import('app://src/js/ui/pdfdialog.js');
    const b = a.store.contentBounds();
    choosePageSetup(a, { x:b.x-40, y:b.y-40, w:b.w+80, h:b.h+80 });   // left open for the shot
  `);
  await sleep(500);
  await shot('23-pdf-dialog');
  console.log('dialog shot done');
  app.exit(0);
}
module.exports = { run };
