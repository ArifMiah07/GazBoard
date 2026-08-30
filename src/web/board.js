// The browser half of the window.board seam.
//
// In Electron the preload script defines window.board and bridges to the main
// process. In a plain browser there is no preload, so this script provides the
// same surface, backed by browser features instead of the OS:
//   - file dialogs  -> File System Access API, else <input type=file>-style
//                      pickers and browser downloads
//   - boards        -> IndexedDB (see storage.js)
//   - document      -> mammoth + the OOXML reader + html-to-image + pdf-lib,
//                      producing the same "anything -> PDF bytes" contract
//   - PDF export    -> pdf-lib embeds the sheet bitmaps the renderer builds
// Self-guarding: if a preload already set window.board, this does nothing, so
// the exact same index.html serves the desktop and web builds.

(function () {
  if (window.board) return;
  window.board = { web: true };

  /* ---------------- lazy vendor loading ---------------- */
  const vendor = (file) => new URL('../vendor/' + file, document.baseURI).href;
  const mod = (file) => new URL('../web/' + file, document.baseURI).href;

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-vendor="${url}"]`)) return resolve();
      const s = document.createElement('script');
      s.dataset.vendor = url;
      s.src = url;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load ' + url));
      document.head.appendChild(s);
    });
  }

  const pdfLibReady = () => loadScript(vendor('pdf-lib.min.js'));

  /* ---------------- file registry ----------------
   * The renderer passes strings around as if they were file paths (it was
   * written against Electron). The web shim turns every "path" into a key that
   * resolves to a real File object; openDialog hands keys out, readFile turns
   * them back into bytes. Keys are the original file names, deduplicated the
   * way a browser does with "photo (2).png", so renderer code that displays
   * the last path segment keeps showing the right name. */

  const files = new Map();

  function uniqueKey(name) {
    const dot = name.lastIndexOf('.');
    const base = dot < 0 ? name : name.slice(0, dot);
    const ext = dot < 0 ? '' : name.slice(dot);
    let key = name, n = 2;
    while (files.has(key)) key = `${base} (${n++})${ext}`;
    files.set(key, null);
    return key;
  }

  window.board.registerFile = (file) => {
    const key = uniqueKey(file.name || 'file');
    files.set(key, file);
    return key;
  };

  /* ---------------- dialogs ---------------- */
  const extMime = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain', json: 'application/json', gazboard: 'application/octet-stream',
    openboard: 'application/octet-stream', html: 'text/html'
  };

  function pickTypes(filters) {
    if (!filters || !filters.length) return [];
    return filters.map((f) => ({
      description: f.name || 'Files',
      accept: Object.fromEntries((f.extensions || []).map((e) =>
        [extMime[e] || 'application/octet-stream', ['.' + e]]))
    }));
  }

  function pickViaInput(multiple) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = !!multiple;
      input.style.position = 'fixed';
      input.style.left = '-100000px';
      input.addEventListener('change', () => {
        document.body.removeChild(input);
        resolve([...input.files]);
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  window.board.openDialog = async (opts = {}) => {
    const multiple = !!((opts.properties || []).includes('multiSelections'));
    let chosen = [];
    if (window.showOpenFilePicker) {
      try {
        const handles = await window.showOpenFilePicker({ multiple });
        chosen = await Promise.all(handles.map((h) => h.getFile()));
      } catch (e) {
        if (e && e.name === 'AbortError') return [];
        throw e;
      }
    } else {
      chosen = await pickViaInput(multiple);
    }
    return chosen.map((f) => window.board.registerFile(f));
  };

  const saveHandles = new Map();   // key -> FileSystemFileHandle (FS Access API)
  const saveNames = new Map();     // key -> filename for the download fallback

  window.board.saveDialog = async (opts = {}) => {
    const name = (opts.defaultPath || 'untitled').split(/[\\/]/).pop() || 'untitled';
    saveNames.set(name, name);
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: pickTypes(opts.filters || [])
        });
        saveHandles.set(name, handle);
      } catch (e) {
        saveNames.delete(name);
        if (e && e.name === 'AbortError') return null;
        // a picker problem is not fatal - fall back to a plain download
        saveNames.set(name, name);
      }
    }
    return name;
  };

  /* ---------------- file IO ---------------- */
  window.board.readFile = async (key) => {
    const file = files.get(key);
    if (!file) throw new Error('Unknown file: ' + key);
    return file.arrayBuffer();
  };

  function download(name, bytes) {
    const blob = new Blob([bytes]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  window.board.writeFile = async (key, data) => {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const handle = saveHandles.get(key);
    if (handle) {
      const w = await handle.createWritable();
      await w.write(bytes);
      await w.close();
      saveHandles.delete(key);
      saveNames.delete(key);
      return true;
    }
    download(saveNames.get(key) || key, bytes);
    return true;
  };

  window.board.showItem = () => {};

  window.board.info = async () => ({
    version: '2.0.1',
    platform: 'web',
    web: true,
    electron: 'web',
    chrome: navigator.userAgent,
    libreoffice: false,
    userData: 'browser storage'
  });

  /* ---------------- board persistence -> IndexedDB ---------------- */
  const boards = {};
  window.board.boards = boards;

  const storage = () => import(mod('storage.js')).then((m) => {
    if (window.__webStorage) return window.__webStorage;
    window.__webStorage = m;
    return m;
  });

  boards.list = async () => (await storage()).listBoards();
  boards.load = async (id) => (await storage()).loadBoard(id);
  boards.save = async (b) => (await storage()).saveBoard(b);
  boards.remove = async (id) => (await storage()).removeBoard(id);
  boards.last = async () => (await storage()).getLast();
  boards.setLast = async (id) => (await storage()).setLast(id);
  boards.resume = async () => (await storage()).resumeBoard();
  boards.migrate = async () => ({ moved: 0, from: [] });

  /* ---------------- document import ---------------- */
  window.board.importToPdf = async (key) => {
    const file = files.get(key);
    if (!file) return { ok: false, error: 'Unknown file: ' + key };
    const name = file.name || 'document';
    const ext = (name.split('.').pop() || '').toLowerCase();

    if (ext === 'pdf') {
      return { ok: true, engine: 'native', data: await file.arrayBuffer(), name };
    }
    const kind = ext === 'docx' || ext === 'doc' || ext === 'rtf' || ext === 'odt' ? 'word'
      : ext === 'txt' ? 'txt'
        : ext === 'pptx' || ext === 'ppt' || ext === 'odp' ? 'slides' : null;
    if (!kind) {
      return { ok: false, error: 'This browser build imports PDF, DOCX, PPTX and TXT. Save Office files as .docx / .pptx / .pdf and try again.' };
    }
    if (ext === 'doc' || ext === 'ppt' || ext === 'odt' || ext === 'odp' || ext === 'rtf') {
      return { ok: false, error: ext + ' needs a converter this browser build does not have. Save it as .docx / .pptx and try again.' };
    }
    const { convertDocument } = await import(mod('documentToPdf.js'));
    return convertDocument(file, kind);
  };

  /* ---------------- PDF export (pdf-lib, no print dialog) ---------------- */
  const MM_PER_PT = 25.4 / 72;

  function parseMm(v) {
    const m = String(v || '').match(/[\d.]+/);
    return m ? parseFloat(m[0]) : 0;
  }

  window.board.exportPdf = async ({ html, widthIn, heightIn }) => {
    try {
      await pdfLibReady();
      const { PDFDocument } = window.PDFLib;
      const doc = await PDFDocument.create();
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const imgs = [...tmp.querySelectorAll('img')];
      if (!imgs.length) throw new Error('No sheets to export');

      const pageWpt = widthIn * 72, pageHpt = heightIn * 72;
      for (const img of imgs) {
        const src = img.getAttribute('src') || '';
        const comma = src.indexOf(',');
        const mime = (comma > 0 ? src.slice(5, comma) : 'image/png').toLowerCase();
        let data;
        try {
          data = Uint8Array.from(atob(src.slice(comma + 1)), (c) => c.charCodeAt(0));
        } catch { continue; }
        const wMm = parseMm(img.style.width) || parseMm(img.getAttribute('width')) || 0;
        const hMm = parseMm(img.style.height) || parseMm(img.getAttribute('height')) || 0;

        let embedded;
        if (/jpe?g/.test(mime)) embedded = await doc.embedJpg(data);
        else { try { embedded = await doc.embedPng(data); } catch { embedded = await doc.embedJpg(data); } }

        const page = doc.addPage([pageWpt, pageHpt]);
        const wPt = wMm / MM_PER_PT, hPt = hMm / MM_PER_PT;
        page.drawImage(embedded, {
          x: (pageWpt - wPt) / 2, y: (pageHpt - hPt) / 2,
          width: wPt, height: hPt
        });
      }

      const out = await doc.save();
      const data = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  };

  /* ---------------- events ---------------- */
  const menuCbs = [];
  const openCbs = [];

  window.board.onMenu = (cb) => menuCbs.push(cb);
  window.board.onOpenFile = (cb) => openCbs.push(cb);
  window.board.onFlush = () => {};
  window.board.onWindowResized = (cb) => {
    const onResize = () => cb();
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onResize);
  };

  /** The in-page menubar dispatches commands through here. */
  window.board.runMenu = (id) => { for (const cb of menuCbs) { try { cb(id); } catch {} } };

  /** Open a dropped .gazboard/.openboard/.json board file. */
  window.board.openBoardFile = async (file) => {
    try {
      const data = JSON.parse(await (await file.arrayBuffer()).text());
      for (const cb of openCbs) { try { cb(data); } catch {} }
    } catch (e) {
      console.warn('Could not open board file:', e);
    }
  };

  /* ---------------- PWA bits ---------------- */
  const manifest = document.createElement('link');
  manifest.rel = 'manifest';
  manifest.href = 'manifest.webmanifest';
  document.head.appendChild(manifest);

  const appleTouch = document.createElement('link');
  appleTouch.rel = 'apple-touch-icon';
  appleTouch.href = new URL('assets/icon-256.png', document.baseURI).href;
  document.head.appendChild(appleTouch);

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW failed:', e));
  }
})();