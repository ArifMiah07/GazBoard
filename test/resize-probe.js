'use strict';
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  await new Promise(r=>setTimeout(r,900));
  const out = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.setTool('select');
    const o = { id:'box', type:'shape', kind:'rect', x:200, y:200, w:300, h:200, rotation:0,
                stroke:'#000', fill:'#eee', lineWidth:2 };
    a.store.add(o);
    a.setSelection(['box']);
    sf.draw();

    const box = sf.selectionScreenBox();
    const { handlePositions } = await import('app://board/js/core/render.js');
    const hp = handlePositions(box);
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (p, extra) => Object.assign({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
      clientX: rect.left + p.x, clientY: rect.top + p.y, shiftKey: false, altKey: false, pressure: 0.5 }, extra||{});

    const before = { w: o.w, h: o.h };
    it.onDown(ev(hp.se));
    const action = it.action ? it.action.type : 'none';
    it.onMove(ev({ x: hp.se.x + 100, y: hp.se.y + 60 }));
    const during = { w: a.store.get('box').w, h: a.store.get('box').h };
    it.onUp(ev({ x: hp.se.x + 100, y: hp.se.y + 60 }));
    const after = { w: a.store.get('box').w, h: a.store.get('box').h };
    it.action = null; it.pointers.clear();

    return { box, se: hp.se, action, before, during, after, selBox: sf.selectionScreenBox() };
  `);
  console.log('RESIZE ' + JSON.stringify(out));
  app.exit(0);
}
module.exports={run};
