# GazBoard Web Port — Project Requirements

Status: **draft → accepted** · Owner: theBoringCode · Date: 2026-08-30

This document defines the requirements for porting the Electron desktop app
**GazBoard** to run as a regular web application (PWA-eligible) in a browser.
It is written from a close reading of the existing codebase (`main.js`,
`preload.js`, `src/`, `package.json`), so every requirement below maps to a
concrete piece of the current implementation.

---

## 1. Background

GazBoard is a free-form digital whiteboard (a local, offline replica of
Microsoft Whiteboard 21.x) with Word / PowerPoint / PDF import. Today it is a
single-window Electron app:

| Layer | Files | Role |
|---|---|---|
| Main process | `main.js` (602 lines) | Windows, native menus, file dialogs, board storage on disk, PDF export via hidden `BrowserWindow` + `printToPDF`, LibreOffice discovery & document conversion, IPC |
| Preload bridge | `preload.js` (35 lines) | Exposes a single `window.board` API to the renderer |
| Renderer (web tech) | `src/` (~8000 lines) | All UI, canvas rendering, pointer/stylus handling, tools, pages, export. **Pure HTML/CSS/ES modules — no Node APIs** |

The renderer has zero direct Node/file-system usage. Every OS capability is
reached through the ~20 functions of `window.board.*` defined in `preload.js`.
That single seam is what a web port replaces.

**Electron-only concepts inventory** (from grep of `src/` and `main.js`):

- `window.board.info()` — versions, platform, LibreOffice flag, userData path.
- `window.board.readFile(p)` / `writeFile(p, data)` — arbitrary path IO.
- `window.board.openDialog(opts)` / `saveDialog(opts)` — OS file dialogs.
- `window.board.showItem(p)` — reveal a file in the OS file manager.
- `window.board.boards.{list,load,save,remove,last,setLast,resume,migrate}` —
  board persistence under Electron `userData`.
- `window.board.importToPdf(filePath)` — anything → PDF bytes (`native` for
  PDF, `libreoffice` via soffice, `builtin` via hidden conversion window).
- `window.board.exportPdf({html,widthIn,heightIn})` — renderer-built sheet HTML →
  real PDF bytes via `printToPDF`.
- `window.board.onMenu(id)` / `onOpenFile(data)` / `onWindowResized()` /
  `onFlush(cb)` — native-menu commands, OS-opened board files, window geometry,
  pre-quit flush.
- `app://board/...` — custom protocol serving `src/` with real ES module +
  worker support; referenced only in `src/js/importers/pdf.js` (pdf.js paths)
  and `src/convert.html`.
- `f.path` on dropped `File` objects (Electron-only) — used once in
  `src/js/app.js` drag-and-drop handling.
- `src/convert.html` — the hidden window that converts docx/pptx to HTML for
  `printToPDF` (used only by the main process).

---

## 2. Goals & Non-Goals

### Goals
1. Run the existing GazBoard UI and canvas in a normal browser with **no code
   rewrite of the editor** (the ~8000 renderer lines stay untouched except for
   a handful of web-aware display tweaks).
2. Preserve the core whiteboard experience: pen/stylus, PDF import, docx/pptx
   import, PNG/SVG/PDF export, multi-page pads, board library, autosave.
3. Keep everything **local and private** (no account, no server, no cloud) —
   matching GazBoard's ethos, using browser storage.
4. Ship as a static, installable **PWA** (service worker + manifest) so it works
   offline and can be installed to the desktop/home screen.

### Non-Goals (v1)
- Real-time collaboration / sync.
- Native LibreOffice-fidelity Office conversion in-browser (no server, no
  LibreOffice WASM).
- Perfect print-pagination fidelity for Word documents (client-side page
  slicing is "good enough", see §5).
- Packaging for mobile touch UX (works, but keyboard/mouse/stylus-first).
- Replacing the Electron desktop build — the web build is additive.

---

## 3. Functional Requirements

### FR-1 — Runs in a browser (must)
- `npm run web` serves `src/` over HTTP; the app boots at `index.html` without
  any build step (the renderer already uses relative ES-module imports).
- `window.board` must be defined in the browser via a shim. When the shim runs
  inside Electron (preload already set) it must **no-op** and defer to preload.
- Works on current Chrome/Edge/Firefox/Safari. Graceful degradation when the
  File System Access API is absent (fall back to `<input type=file>` and
  download blobs).

### FR-2 — Board persistence in the browser (must)
- `boards.list/load/save/remove/resume/setLast` backed by **IndexedDB**.
- `resume()` mirrors Electron semantics exactly: last-open pointer first, then
  newest non-empty board, then newest board, then `{board:null, reason:'none'}`.
- `last()` and `setLast()` (power-loss-safe pointer) stored in IndexedDB.
- `migrate()` returns `{moved:0, from:[]}` (nothing to migrate on the web).

### FR-3 — File open/save (must)
- `openDialog` → File System Access API (`showOpenFilePicker`) when present,
  else a hidden `<input type="file">`. Multi-select honoured (`properties`
  with `multiSelections`). Returns a stable key per chosen file so the existing
  renderer code (which treats keys as paths) keeps working.
- `saveDialog(opts)` → `showSaveFilePicker` when present, else a plain key
  (the default filename) that `writeFile` resolves to a download.
- `readFile(key)` returns the file's `ArrayBuffer`; `writeFile(key, data)` writes
  to the handle, or triggers a download with the proper filename.

### FR-4 — Document import (must)
- **PDF**: unchanged behaviour — read bytes, render pages with the bundled
  pdf.js (`openPdf` in `src/js/importers/pdf.js`). pdf.js asset paths must be
  made browser-safe (`import.meta.url`-relative).
- **DOCX**: mammoth → HTML → render to a tall bitmap → slice into A4 pages →
  assemble into a real PDF (via pdf-lib) → feed the *existing* pdf.js pipeline.
- **PPTX**: existing built-in OOXML reader (`src/js/importers/pptx.js`) → one
  page per slide → assemble PDF via pdf-lib → pdf.js.
- **TXT**: wrapped plain text through the same page-slicing path.
- `.doc/.ppt/.odt/.odp/…` (legacy/ODF) return a clear error telling the user to
  save as `.docx`/`.pptx`/`.pdf` (native LibreOffice is not available in-browser).
- The renderer contract `importToPdf(filePath) → {ok, engine, data, name}` is
  preserved. `engine` is `'native'` for PDF and `'builtin'` for the rest.
- Progress overlays and the multi-page page picker keep working unchanged.

### FR-5 — PDF export (must)
- `exportPdf({html, widthIn, heightIn})` produces **real PDF bytes in-browser**
  with pdf-lib by extracting the per-sheet bitmap `<img>` elements the renderer
  already embeds. No hidden window, no `printToPDF`, no browser print dialog.
- Result is saved through the normal `saveDialog`/`writeFile` path.

### FR-6 — Menus (should)
- The native File/Edit/View menu is recreated as an in-page menubar (File,
  Edit, View) shown only in web mode, emitting the same `menu:command` ids the
  renderer already handles (`board.new`, `edit.undo`, `view.zoomIn`, …).
- Full screen uses the Fullscreen API; the rest reuse existing commands.

### FR-7 — Native-file opening (nice to have)
- Dropping a `.gazboard`/`.openboard`/`.json` board file onto the window opens it
  (replaces OS double-click-to-open via `onOpenFile`).

### FR-8 — Drag & drop of images/documents (must)
- `src/js/app.js` drop handler already supports browser `File` objects in its
  fallback branch; it must be extended so **document** files dropped into the
  browser (not just images) are imported.

### FR-9 — Electron-only UI text (should)
- Panels/About must not claim "Electron", "LibreOffice", or an on-disk boards
  folder in web mode; web-appropriate wording or the item is hidden
  (`window.board.web` guards).

### FR-10 — PWA (should)
- `manifest.webmanifest` (icons from `src/assets`) + a minimal service worker
  (cache-first for app assets), registered only over `http(s)` in web mode.
  IndexedDB storage is unaffected by SW caching.

---

## 4. Non-Functional Requirements

- **NFR-1 Privacy**: no network calls except the app's own static assets (vendored
  libs are served from `src/vendor`, never CDNs at runtime).
- **NFR-2 Performance**: shim lazy-loads heavy UMD libs (`pdf-lib`,
  `html-to-image`) on first use, not at startup. Startup path unchanged.
- **NFR-3 Testability**: an automated smoke test (`test/web-smoke.js`, run via
  `npm run web:smoke`, uses the repo's Electron devDependency as a headless
  Chromium harness) asserts: shim active, board round-trip via IndexedDB,
  txt→PDF import returns `%PDF`, and `exportPdf` returns `%PDF`.
- **NFR-4 Portability**: zero new runtime dependencies for serving (a
  dependency-free `serve.js`). No build step, no bundler.
- **NFR-5 Compatibility**: File System Access API optional; every feature has a
  fallback so the app is fully usable without it.

---

## 5. Known Trade-offs / Accepted Limitations

1. **Office conversion fidelity** — LibreOffice cannot run in a browser. DOCX
   and PPTX go through the built-in renderers. Results are "readable", not
   pixel-perfect, exactly like the desktop's non-LibreOffice fallback.
2. **Word pagination** — client-side page slicing cuts content at fixed page
   boundaries (no re-flow to avoid splitting a paragraph). On the desktop the
   hidden Chromium window does real pagination; in-browser this is a documented
   approximation.
3. **Very long documents** — canvas height limits cap the number of pages
   converted in one pass; larger exports drop to a lower DPR automatically.
4. **Storage quotas** — IndexedDB quota (per-origin) replaces disk. Board
   files with many imported pages are the largest structures; users can
   export/import `.gazboard` files to move work elsewhere.

---

## 6. Architecture

```
src/
  index.html        (unchanged markup; adds web shim script + PWA hooks)
  web/
    board.js        window.board browser shim (self-guarding): dialogs, fs,
                    boards (IndexedDB), import/export, events
    storage.js      IndexedDB helpers (boards store + last-pointer)
    documentToPdf.js docx / pptx / txt -> real PDF bytes (mammoth + pptx.js +
                    html-to-image + pdf-lib)
    menu.js         in-page File/Edit/View menubar (web only)
    sw.js           service worker (cache-first)
    manifest.webmanifest
  vendor/
    pdf-lib.min.js        (new, UMD global PDFLib)
    html-to-image.js      (new, UMD global htmlToImage)
    pdf.min.mjs / pdf.worker.min.mjs / cmaps / standard_fonts  (existing)
    mammoth.browser.min.js / jszip.min.js  (existing)
serve.js           dependency-free static server for `npm run web`
test/web-smoke.js  headless browser smoke test (Electron as a harness)
```

Everything outside `src/web/` + `serve.js` + `test/web-smoke.js` is either a
tiny, web-agnostic patch (relative pdf.js paths; `window.board.web` guards;
document-file drop handling) or documentation.

---

## 7. Acceptance Criteria

1. `npm run web` boots the app at `http://localhost:4173`.
2. Drawing, pages, tools, and templates work as in the desktop app.
3. Boards autosave to IndexedDB; the "My boards" panel lists/opens/deletes them;
   a reload resumes the last board.
4. Insert a PDF and a `.docx`/`.pptx`/`.txt`; each lands as legible pages
   through the page picker.
5. Export PNG, SVG, and PDF; the PDF opens in any viewer and matches the sheet.
6. `npm run web:smoke` passes.
7. No network requests to third-party hosts at runtime.

---

## 8. Out of Scope (explicitly deferred)

- Editing Office files; collaborative/real-time sync; server-side conversion;
  LibreOffice WASM; touch-only tablet UX; iOS Safari-specific polish.