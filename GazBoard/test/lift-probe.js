'use strict';
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  await new Promise(r=>setTimeout(r,900));
  const out = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.settings.inkToShape = false; a.settings.inkWithMouse = 'yes';
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y) => ({ pointerId: 1, pointerType: 'pen', button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.6 });

    // cursive-ish: gentle curves, the shape of real handwriting
    const path = [];
    for (let t = 0; t <= Math.PI * 5; t += 0.06)
      path.push([120 + t * 22, 300 + 26 * Math.sin(t) + 9 * Math.sin(2.6 * t)]);

    a.setTool('pen');
    it.onDown(ev(path[0][0], path[0][1]));
    for (const p of path.slice(1)) it.onMove(ev(p[0], p[1]));
    const wet = sf.wet ? sf.wet.points.length : 0;
    it.onUp(ev(path[path.length-1][0], path[path.length-1][1]));
    it.action = null; it.pointers.clear();
    const s = a.store.objects.find(o => o.type === 'stroke');
    return { fed: path.length, wetPoints: wet, storedPoints: s.points.length,
             dropped: wet - s.points.length,
             pct: Math.round((1 - s.points.length / wet) * 100) };
  `);
  console.log('LIFT ' + JSON.stringify(out));
  app.exit(0);
}
module.exports={run};
