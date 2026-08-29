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
    a.store.setBackground({ pattern: 'lines' });
    await a.setPageSize('a4', 'portrait');
    a.store.add({ id:'t', type:'text', x:-330, y:-480, w:660, h:60, text:'Lecture 9 — greedy proofs',
      fontSize:38, color:'#201f1e', align:'left', valign:'top', rotation:0, font:'hand', background:'none' });
    a.store.add({ id:'t2', type:'text', x:-330, y:-390, w:660, h:50, text:'exchange argument, then a counterexample',
      fontSize:26, color:'#605e5c', align:'left', valign:'top', rotation:0, font:'hand', background:'none' });
    a.store.add({ id:'n', type:'note', x:-330, y:-280, w:190, h:190, color:'#ffd94a',
      text:'sheet has edges now', rotation:0, align:'center', font:'hand' });
    a.store.add({ id:'n2', type:'note', x:-110, y:-280, w:190, h:190, color:'#a4d4ff',
      text:'still infinite by default', rotation:0, align:'center', font:'hand' });
    a.setSelection([]); a.setTool('select');
    const pill = document.getElementById('zoomPill'); if (pill) pill.style.display = 'none';
    a.surface.invalidate();
  `);
  await sleep(700); await shot('24-page-a4');
  await js(`window.app.panels.background();`);
  await sleep(500); await shot('25-canvas-size');
  await js(`window.app.panels.close(); window.app.panels.templates();`);
  await sleep(600); await shot('26-page-templates');
  console.log('page shots done');
  app.exit(0);
}
module.exports = { run };
