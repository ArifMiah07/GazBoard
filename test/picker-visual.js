'use strict';
const path=require('node:path'), fs=require('node:fs/promises');
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  const shot=async(n)=>fs.writeFile(path.join(__dirname,'out',n+'.png'),(await win.webContents.capturePage()).toPNG());
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  await sleep(900);
  js(`
    const { insertDocument } = await import('app://board/js/insert.js');
    window.__p = insertDocument(window.app, ${JSON.stringify(path.join(__dirname,'fixtures','sample.pdf'))});
  `);
  for (let i=0;i<40;i++){ await sleep(200); const ok = await js(`return document.querySelectorAll('.pick-tile').length===3 && !!document.querySelector('.pick-thumb-img[style*=url]');`); if (ok) break; }
  await sleep(500);
  await shot('13-page-picker');
  await js(`
    const r = document.querySelector('.range-input'); r.value = '1,3'; r.dispatchEvent(new Event('input'));
    [...document.querySelectorAll('.card.picker .actions .btn')].find(b=>/Import/.test(b.textContent)).click();
    await window.__p;
    // lock one of them so the badge shows
    const pages = window.app.store.objects.filter(o => o.kind === 'page');
    window.app.store.update(pages[0].id, { locked: true });
    window.app.setSelection([pages[1].id]);
    window.app.surface.invalidate();
  `);
  await sleep(900);
  await shot('14-pages-and-lock');
  console.log('PICKER done');
  app.exit(0);
}
module.exports={run};
