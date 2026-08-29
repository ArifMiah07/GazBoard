'use strict';
async function run(win, app){
  const js=(c)=>win.webContents.executeJavaScript(`(async()=>{${c}})()`,true);
  await new Promise(r=>setTimeout(r,900));
  const out = await js(`
    const a = window.app, it = a.interaction, sf = a.surface;
    a.newBoard(true); sf.cam.x = 0; sf.cam.y = 0; sf.cam.z = 0.36;
    a.settings.inkWithMouse = 'yes';
    const rect = sf.canvas.getBoundingClientRect();
    const ev = (x, y) => ({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
      clientX: rect.left + x, clientY: rect.top + y, shiftKey: false, altKey: false, pressure: 0.5 });
    const click = (x, y) => { it.onDown(ev(x, y)); it.onMove(ev(x, y)); it.onUp(ev(x, y)); it.action = null; it.pointers.clear(); };
    a.setTool('text');
    click(400, 400);
    const afterClick = { tool: a.tool, editing: a.textEditor.active, count: a.store.count,
                         types: a.store.objects.map(o => o.type) };
    if (a.textEditor.active) a.textEditor.el.value = 'hello';
    a.textEditor.commit();
    const afterCommit = { count: a.store.count, types: a.store.objects.map(o => o.type),
                          texts: a.store.objects.filter(o=>o.type==='text').map(o=>({t:o.text, f:Math.round(o.fontSize)})) };
    return { afterClick, afterCommit };
  `);
  console.log('PLACE ' + JSON.stringify(out, null, 1));
  app.exit(0);
}
module.exports={run};
