'use strict';
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  await new Promise(r=>setTimeout(r,900));
  const out = await js(`
    const a = window.app;
    const { layoutPages, paperById } = await import('app://src/js/ui/pdfdialog.js');
    const r = {};
    r.a4fit   = layoutPages({x:0,y:0,w:1200,h:700},  {paper:'a4', orientation:'landscape', margin:'narrow', mode:'fit'});
    r.a4tile  = layoutPages({x:0,y:0,w:2400,h:3000}, {paper:'a4', orientation:'portrait', margin:'narrow', mode:'tile', scale:1});
    r.fitPaper= layoutPages({x:0,y:0,w:960,h:540},   {paper:'fit', margin:'none'});
    r.letter  = paperById('letter');
    a.newBoard(true);
    a.store.add({ id:'t', type:'text', x:100, y:100, w:500, h:60, text:'PDF export test',
      fontSize:40, color:'#201f1e', align:'left', valign:'top', rotation:0, font:'hand', background:'none' });
    a.store.add({ id:'s', type:'shape', kind:'ellipse', x:120, y:200, w:300, h:180,
      rotation:0, stroke:'#e81123', fill:'none', lineWidth:4 });
    const { exportPdf } = await import('app://src/js/export.js');
    r.onePage  = await exportPdf(a, { paper:'a4', orientation:'landscape', margin:'narrow', mode:'fit', quality:2, filePath:'/tmp/probe-1.pdf' });
    r.tiled    = await exportPdf(a, { paper:'a5', orientation:'portrait', margin:'none', mode:'tile', scale:1, quality:1.5, filePath:'/tmp/probe-tiled.pdf' });
    r.boardFit = await exportPdf(a, { paper:'fit', margin:'narrow', mode:'fit', quality:2, filePath:'/tmp/probe-fit.pdf' });
    return r;
  `);
  console.log('RESULT ' + JSON.stringify(out));
  app.exit(0);
}
module.exports = { run };
