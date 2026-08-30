// In-page File/Edit/View menubar for the web build.
//
// The desktop gets File/Edit/View from the native Electron menu, which sends
// 'menu:command' ids into the renderer. A browser has no native menu, so web
// mode injects a small menubar that emits the *same ids* through
// window.board.runMenu - app.command() in app.js already knows every one of
// them, which is the whole trick: the menu is the only new piece.
//
// Loaded by index.html only as a classic script; it self-guards on window.board.web.

(function () {
  if (!window.board || !window.board.web) return;

  const run = (id) => window.board.runMenu(id);

  const style = document.createElement('style');
  style.textContent = `
    #menubar { display:flex; align-items:center; gap:2px; margin-right:6px; }
    #menubar .menu-top {
      background:none;border:0;border-radius:4px;padding:5px 9px;cursor:default;
      font:inherit;font-size:13px;color:var(--text, #201f1e);line-height:1;
    }
    #menubar .menu-top:hover, #menubar .menu-top.open { background:var(--hover, #eaeae8); }
    .menu-drop {
      position:absolute;top:38px;left:0;min-width:230px;z-index:1000;
      background:var(--pop-bg, #fff);border:1px solid var(--stroke, #e3e2e0);
      border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.18);padding:6px;
      display:flex;flex-direction:column;gap:1px;
    }
    .menu-drop .mi {
      display:flex;align-items:center;justify-content:space-between;gap:24px;
      border:0;background:none;font:inherit;font-size:13px;color:var(--text, #201f1e);
      padding:7px 10px;border-radius:5px;text-align:left;white-space:nowrap;
    }
    .menu-drop .mi:hover { background:var(--hover, #f0f0ee); }
    .menu-drop .mi .k { font-size:11px;color:var(--text-2, #777); }
    .menu-drop .sep { height:1px;background:var(--stroke, #e3e2e0);margin:4px 6px; }
  `;
  document.head.appendChild(style);

  function drop(parent, items) {
    const div = document.createElement('div');
    div.className = 'menu-drop';
    div.style.display = 'none';
    for (const it of items) {
      if (it === '-') { div.appendChild(Object.assign(document.createElement('div'), { className: 'sep' })); continue; }
      const b = document.createElement('button');
      b.className = 'mi';
      const label = document.createElement('span');
      label.textContent = it.label;
      b.appendChild(label);
      if (it.key) { const k = document.createElement('span'); k.className = 'k'; k.textContent = it.key; b.appendChild(k); }
      b.addEventListener('click', () => { div.style.display = 'none'; parent.classList.remove('open'); it.run(); });
      div.appendChild(b);
    }
    document.body.appendChild(div);

    function place() {
      const r = parent.getBoundingClientRect();
      div.style.left = r.left + 'px';
      div.style.top = (r.bottom + 4) + 'px';
    }

    parent.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = div.style.display !== 'none';
      document.querySelectorAll('#menubar .drop').forEach((d) => { d.style.display = 'none'; });
      document.querySelectorAll('#menubar .menu-top').forEach((m) => m.classList.remove('open'));
      if (!open) { place(); div.style.display = 'flex'; parent.classList.add('open'); }
    });
    document.addEventListener('click', (e) => {
      if (!div.contains(e.target)) { div.style.display = 'none'; parent.classList.remove('open'); }
    });
    window.addEventListener('resize', () => { if (div.style.display !== 'none') place(); });
  }

  function topItem(label, items) {
    const b = document.createElement('button');
    b.className = 'menu-top';
    b.textContent = label;
    document.getElementById('menubar').appendChild(b);
    drop(b, items);
  }

  const bar = document.createElement('nav');
  bar.id = 'menubar';
  bar.setAttribute('aria-label', 'Menus');
  const header = document.getElementById('topbar');
  header.insertBefore(bar, header.firstChild);

  topItem('File', [
    { label: 'New board', key: 'Ctrl+N', run: () => run('board.new') },
    { label: 'Open board…', key: 'Ctrl+O', run: () => run('board.open') },
    { label: 'Save a copy…', key: 'Ctrl+S', run: () => run('board.save') },
    '-',
    { label: 'Insert image…', run: () => run('insert.image') },
    { label: 'Insert document (Word / PowerPoint / PDF)…', run: () => run('insert.document') },
    '-',
    { label: 'Export as PNG…', run: () => run('export.png') },
    { label: 'Export as PDF…', run: () => run('export.pdf') },
    { label: 'Export as SVG…', run: () => run('export.svg') }
  ]);

  topItem('Edit', [
    { label: 'Undo', key: 'Ctrl+Z', run: () => run('edit.undo') },
    { label: 'Redo', key: 'Ctrl+Shift+Z', run: () => run('edit.redo') },
    '-',
    { label: 'Cut', key: 'Ctrl+X', run: () => run('edit.cut') },
    { label: 'Copy', key: 'Ctrl+C', run: () => run('edit.copy') },
    { label: 'Paste', key: 'Ctrl+V', run: () => run('edit.paste') },
    { label: 'Duplicate', key: 'Ctrl+D', run: () => run('edit.duplicate') },
    { label: 'Delete', run: () => run('edit.delete') },
    '-',
    { label: 'Select all', key: 'Ctrl+A', run: () => run('edit.selectAll') },
    { label: 'Clear canvas', run: () => run('edit.clear') }
  ]);

  topItem('View', [
    { label: 'Zoom in', key: 'Ctrl+=', run: () => run('view.zoomIn') },
    { label: 'Zoom out', key: 'Ctrl+-', run: () => run('view.zoomOut') },
    { label: 'Reset zoom', key: 'Ctrl+0', run: () => run('view.zoomReset') },
    { label: 'Fit to board', key: 'Ctrl+Shift+F', run: () => run('view.fit') },
    '-',
    { label: 'Format background…', run: () => run('view.background') },
    { label: 'Toggle ruler', key: 'Ctrl+R', run: () => run('view.ruler') },
    '-',
    { label: 'Full screen', key: 'F11', run: () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    } }
  ]);
})();