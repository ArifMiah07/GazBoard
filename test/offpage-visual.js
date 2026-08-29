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
    await a.setPageSize('a4', 'portrait');
    const { insertDocument } = await import('app://board/js/insert.js');
    await insertDocument(a, ${JSON.stringify(path.join(__dirname,'fixtures','lecture-09-greedy.pptx'))}, { pages: [1], layout: 'row' });
  `);
  await sleep(2500);
  await js(`
    const a = window.app;
    a.setSelection([]); a.setTool('select'); a.fitToPage();
    const pill = document.getElementById('zoomPill'); if (pill) pill.style.display='none';
    a.surface.invalidate();
  `);
  await sleep(700); await shot('27-import-fits-page');
  console.log('offpage shot done');
  app.exit(0);
}
module.exports = { run };
