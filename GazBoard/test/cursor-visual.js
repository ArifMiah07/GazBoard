'use strict';
const path=require('node:path'), fs=require('node:fs/promises');
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  const shot=async(n)=>fs.writeFile(path.join(__dirname,'out',n+'.png'),(await win.webContents.capturePage()).toPNG());
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  await sleep(900);
  await js(`
    const { inkCursor } = await import('app://src/js/core/cursors.js');
    const decode = (c) => decodeURIComponent(c.slice(c.indexOf(',')+1, c.lastIndexOf('")'))).replace(/'/g,'"');
    const box = document.createElement('div');
    box.style.cssText='position:fixed;inset:0;background:#fff;z-index:9999;display:flex;align-items:center;gap:40px;padding:60px;font:14px system-ui';
    const cell = (label, svg) => {
      const d=document.createElement('div');
      d.style.cssText='text-align:center';
      d.innerHTML = svg.replace('width="26" height="26"','width="180" height="180"') +
        '<div style="margin-top:8px;color:#555">'+label+'</div>';
      return d;
    };
    box.appendChild(cell('pen · black',   decode(inkCursor('pen','#201f1e'))));
    box.appendChild(cell('pen · red',     decode(inkCursor('pen','#e81123'))));
    box.appendChild(cell('pen · blue',    decode(inkCursor('pen','#0078d4'))));
    box.appendChild(cell('highlighter',   decode(inkCursor('highlighter','#fff100'))));
    document.body.appendChild(box);
  `);
  await sleep(400);
  await shot('20-cursors');
  console.log('cursor shot done');
  app.exit(0);
}
module.exports = { run };
