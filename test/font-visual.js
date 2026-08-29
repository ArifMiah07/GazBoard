'use strict';
const path=require('node:path'), fs=require('node:fs/promises');
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  const shot=async(n)=>fs.writeFile(path.join(__dirname,'out',n+'.png'),(await win.webContents.capturePage()).toPNG());
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  await sleep(900);
  await js(`
    const a = window.app, sf = a.surface;
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.store.setBackground({ pattern: 'grid' });
    a.store.add({ id:'t1', type:'text', x:80, y:90, w:620, h:70, text:'The quick brown fox — 1.14.0',
      fontSize:44, color:'#201f1e', align:'left', valign:'top', rotation:0, font:'hand', background:'none' });
    a.store.add({ id:'t2', type:'text', x:80, y:180, w:620, h:60, text:'a sticky idea, written by hand',
      fontSize:32, color:'#6264a7', align:'left', valign:'top', rotation:0, font:'hand', background:'none' });
    a.store.add({ id:'t3', type:'text', x:80, y:260, w:620, h:50, text:'(this line is the Sans face, for contrast)',
      fontSize:26, color:'#a19f9d', align:'left', valign:'top', rotation:0, font:'ui', background:'none' });
    a.store.add({ id:'n1', type:'note', x:760, y:80, w:230, h:230, color:'#ffd94a',
      text:'notes are handwritten now too', rotation:0, align:'center', font:'hand' });
    a.store.add({ id:'n2', type:'note', x:1020, y:80, w:230, h:230, color:'#a4d4ff',
      text:'no picker visit required', rotation:0, align:'center', font:'hand' });
    a.setTool('select'); a.setSelection([]); a.syncUI(); sf.invalidate();
  `);
  await sleep(600);
  await shot('22-fonts');
  console.log('font shot done');
  app.exit(0);
}
module.exports = { run };
