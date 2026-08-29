'use strict';
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  await new Promise(r=>setTimeout(r,900));
  const out = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    const { recognize } = await import('app://board/js/core/recognize.js');
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.settings.inkToShape = true; a.settings.inkWithMouse = 'yes';
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y) => ({ pointerId: 1, pointerType: 'pen', button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.6 });
    const path = [];
    for (let i = 0; i <= 30; i++) path.push([100 + i * 6, 100]);
    for (let i = 0; i <= 20; i++) path.push([280, 100 + i * 6]);
    for (let i = 30; i >= 0; i--) path.push([100 + i * 6, 220]);
    for (let i = 20; i >= 0; i--) path.push([100, 100 + i * 6]);
    a.setTool('pen');
    it.onDown(ev(path[0][0], path[0][1]));
    for (const p of path.slice(1)) it.onMove(ev(p[0], p[1]));
    it.onUp(ev(path[path.length-1][0], path[path.length-1][1]));
    it.action = null; it.pointers.clear();
    const objs = a.store.objects;
    const stroke = objs.find(o => o.type === 'stroke');
    return {
      types: objs.map(o => o.type),
      setting: a.settings.inkToShape,
      pts: stroke ? stroke.points.length : 0,
      recog: stroke ? recognize(stroke.points) : 'no stroke',
      recogRaw: recognize(path.map(([x,y]) => ({ x, y, p: 0.5 })))
    };
  `);
  console.log('SHAPE ' + JSON.stringify(out, null, 1));
  app.exit(0);
}
module.exports={run};
