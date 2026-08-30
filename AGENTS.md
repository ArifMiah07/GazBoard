# AGENTS.md — GazBoard (Electron + Web)

Guidance for AI coding agents and human contributors working in this repo.
Read this file before editing anything.

## Project in one paragraph

GazBoard is a free-form digital whiteboard — an offline, local replica of
Microsoft Whiteboard 21.x — with Word / PowerPoint / PDF import. It ships as an
**Electron** desktop app and, since v2.1, also as a **static web build** (PWA)
served from `src/`. The editor itself (~8k lines in `src/`) is pure browser
HTML/CSS/ES-modules. Every OS capability is reached through one seam: the
`window.board.*` API (defined in Electron by `preload.js`, in the browser by
`src/web/board.js`).

## Repository layout

```
main.js            Electron main process (windows, menus, dialogs, storage, PDF, LibreOffice)
preload.js         Electron context-bridge -> window.board
src/               THE renderer. Pure web tech. Do not add Node APIs here.
  index.html       app bootstrap
  convert.html     hidden Electron conversion window (NOT used by the web build)
  css/app.css
  js/              app shell, core (store/surface/render/tools/pages/...), importers, ui
  vendor/          vendored libs only: pdf.js, mammoth, jszip, pdf-lib, html-to-image
  web/             THE WEB BUILD lives here: board.js, storage.js, documentToPdf.js,
                   menu.js, sw.js, manifest.webmanifest
serve.js           dependency-free static server (npm run web)
test/              Electron/Chromium smoke + visual tests (see npm scripts)
PROJECT_REQUIREMENTS.md   requirements for the web port (read before web work)
```

## The one rule that matters: don't cross the seam

- **Renderer (`src/`) must never touch `require()`, `process`, `electron`,
  `fs`, or any Node global.** Every OS capability goes through `window.board.*`.
- **Web-specific behaviour goes in `src/web/`** (or a guarded branch using the
  `window.board.web` flag). Do not fork the whole renderer into a separate web
  copy — the desktop and web builds must share the same editor code.
- `window.board` must remain the **only** bridge surface. If a feature needs a
  new OS capability, add it to `preload.js` + the IPC handler in `main.js` AND
  to the browser shim `src/web/board.js` — both, consistently, or the two
  builds drift apart.

## Architecture facts you will need

- **Undo/redo** is an operation log (`commit(label, ops)` in
  `src/js/core/store.js`). Ops are `{t:'add'|'del'|'set'|'order'|'doc'}`.
- **Pages**: a board is either an infinite canvas (`pages: []`) or a strip of
  sheets (`pages: [{w,h},...]`). Ink is clipped to the sheet on a pad.
- **PDF export** (desktop): renderer builds sheet HTML → `window.board.exportPdf`
  → main process prints it. **PDF export** (web): `src/web` turns the same HTML
  into a real PDF with pdf-lib.
- **Document import** goes file → `window.board.importToPdf` → real PDF bytes →
  pdf.js rasterises pages (`src/js/importers/pdf.js`). The web shim produces
  those PDF bytes with mammoth + pptx.js + html-to-image + pdf-lib and reuses
  the exact same pdf.js pipeline.
- **Autosave**: `Store.subscribe` → `persist()` (debounced) → `boards.save`.
  Brand-new empty boards are *not* written until they have content.

## Commands

```sh
npm start            # run the Electron desktop app
npm run web          # serve the web build: http://localhost:4173
npm run dev          # Electron with devtools
npm test             # (n/a: desktop suites are per-suite scripts)
npm run web:smoke    # headless Chromium smoke test of the web build
npm run smoke        # Electron smoke (needs xvfb)
npm test:restart     # restart persistence test
npm run dist[:win|:mac|:linux]
```

No bundler, no build step: `src/js/**` are native ES modules served as-is.

## Testing

- `npm run web:smoke` (`test/web-smoke.js`) is the CI-able check for the web
  build. **Run it whenever you change `src/web/`, `serve.js`, or anything that
  alters the `window.board` contract.** It uses the repo's Electron dependency
  as a headless Chromium harness (no user gesture needed).
- The renderer ships test hooks (e.g. `exportBoundsForTest`) used by the
  Electron visual/probe suites in `test/`. Keep them.
- A working change touches the two sides of the seam (Electron + web) and keeps
  the smoke green.

## Code conventions

- No comments unless they explain *why* (this repo comments decisions, not
  mechanics). Match that voice.
- ESM everywhere in `src/` (`import`/`export`), UMD globals only for vendored
  libs (`PDFLib`, `htmlToImage`, `mammoth`, `JSZip`) — load them lazily.
- Prefer small pure helpers in `src/js/core/`; UI shapes via `h()` in
  `src/js/ui/popover.js`; icons via `icon()` in `src/js/ui/icons.js`.
- World units are float board units; screen px divide by `cam.z` (`worldSize`).
- Keep privacy: no runtime network calls to third parties (assets are vendored).

## Before you finish any task

1. `node --check` any new/changed server-side or Node scripts.
2. Run `npm run web:smoke` for anything touching the web build or the bridge.
3. Check `git status`/`git diff` — stage only intended files, never secrets.
4. Do not commit unless the user explicitly asks.

## The web build at a glance (read this before touching `src/web/`)

- `src/web/board.js` is **self-guarding**: `if (window.board) return` so the
  same `src/index.html` works in Electron (preload wins) and in a browser.
- `File System Access API` is optional: open falls back to `<input type=file>`,
  save falls back to a browser download.
- Boards live in **IndexedDB** (`src/web/storage.js`), not files.
- All new vendor libs live in `src/vendor/`, loaded lazily (never at startup).