'use strict';
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  await new Promise(r=>setTimeout(r,900));
  const out = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 1;
    a.settings.inkWithMouse = 'yes';
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y, type) => ({ pointerId: 1, pointerType: type || 'mouse', button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.5 });
    a.setTool('pen'); a.setTool('text');
    it.onDown(ev(400, 400));
    const afterDown = { action: it.action && it.action.type, tool: a.tool };
    it.onMove(ev(400, 400));
    it.onUp(ev(400, 400));
    it.action = null; it.pointers.clear();
    const afterUp = { tool: a.tool, editing: a.textEditor.active, count: a.store.count,
                      restore: a.restoreToolAfterEdit };
    if (a.textEditor.active) a.textEditor.el.value = 'hi';
    a.textEditor.commit();
    const box = a.store.objects.find(o => o.type === 'text');
    return { afterDown, afterUp, tool: a.tool,
             box: box ? { w: Math.round(box.w), h: Math.round(box.h), size: box.fontSize, text: box.text } : null };
  `);
  console.log('TEXT ' + JSON.stringify(out, null, 1));
  app.exit(0);
}
module.exports={run};
