# GazBoard

A free-form digital whiteboard for Windows, macOS and Linux — an offline rebuild of the
classic **Microsoft Whiteboard 21.x** experience, with one deliberate difference: **there is
no Microsoft sign-in and no cloud.** Everything runs locally. On top of the original feature
set it can **import Word, PowerPoint and PDF files** onto the canvas as pages you draw over.

![toolbar](test/out/01-board.png)

---

## Running it

```bash
npm install      # pulls Electron (~200 MB) — the app's own libraries are already vendored
npm start
```

Development mode with DevTools: `npm run dev`

### Building installers

```bash
npm run dist:win     # NSIS installer + portable .exe
npm run dist:mac     # .dmg + .zip
npm run dist:linux   # AppImage + .deb
```

Installers land in `dist/`. Build on the target OS (or use a CI matrix) — electron-builder
does not cross-compile Windows installers from Linux without extra tooling.

On Linux the AppImage needs FUSE 2 to run. Most desktops already have it; on newer Ubuntu
it is `sudo apt install libfuse2`. Otherwise `./GazBoard-*.AppImage --appimage-extract`
unpacks it and `squashfs-root/gazboard` runs directly. The `.deb` has no such requirement.

---

## What it does

### Canvas
- Infinite pan/zoom canvas (5 %–800 %), pinch-zoom and trackpad panning
- Boards always open at 100%, centred on wherever you were last looking — a saved zoom of 36%
  from fitting a document no longer greets you on the next launch
- **The stylus inks, the mouse points.** The first time a stylus touches the tablet the app
  remembers it, and from then on the mouse stops being a pen: with the pen or highlighter
  selected, a mouse press on an object selects and drags it, and a drag on bare canvas pans. Tablet in one hand, mouse in the
  other, no conflict and nothing to switch. On a machine that has never seen a stylus the
  mouse draws as normal, so a mouse-only setup is unaffected. Settings ▸ Inking ▸ *Draw with
  the mouse* pins it to Always or Never if you'd rather not rely on detection.
- Notes, text, shapes, tables, select, lasso and the eraser all still take the mouse — only
  inking is reserved for the stylus.
- With an ink tool active the mouse drags objects and pans, but leaves no selection behind:
  handles and the selection bar belong to Select and Lasso, so they never clutter your
  handwriting.
- Colours are sticky: recolour something from the selection bar and the next pen stroke, note,
  text box or shape of that kind starts in the same colour.
- Holding a mouse button *during* a stylus stroke drags the canvas under the moving pen; the
  scroll wheel does the same.
- **Edge auto-pan** — run the pen (or a dragged object) into the edge of the window and the
  canvas scrolls on its own, speed rising the closer you get. The stroke carries on unbroken.
  Toggle in Settings.
- Backgrounds: eight paper colours plus a custom picker, and plain / grid / dots / lines /
  columns / graph patterns that scale sensibly with zoom
- Fit-to-board, reset zoom, zoom readout

### Inking
- Pen with pressure support (Wacom, Surface Pen, any PointerEvent-capable stylus), five
  thicknesses, twelve colours. A stroke is drawn as **one stroked path down its centreline**,
  curved through the midpoints of the samples. That has two properties worth the words: a
  midpoint curve stays inside its control triangle so it can never overshoot into a loop or a
  spike, and a single `stroke()` call rasterises the whole stroke once so a highlighter that
  crosses itself cannot darken at the overlap. Width is constant along a stroke, like a felt
  pen; pressure sets the weight of the whole stroke rather than wobbling along it.
- **Ink is kept exactly as drawn.** Points are stored as captured — nothing is thinned or
  re-fitted when you lift the pen, so the stroke you were watching is the stroke you keep.
- Highlighter with multiply blending, six colours, four widths
- Pen-tail-button erasing on styluses that report it
- **Partial (point) erase** — dragging the eraser rubs ink out where it crosses, splitting a
  stroke into the runs that survive rather than deleting the whole thing. Four eraser sizes.
- Eraser modes: *erase parts of ink* (default), *erase whole objects*, *erase everything*
- The eraser **grows as you scrub** — keep going and it widens up to 2.8x, then returns to the
  size you picked when you lift, so clearing an area is one sweep rather than forty passes
- Lasso select, then drag from inside the selection to move it without changing tools
- **Straighten shapes I draw** (off by default) — a hand-drawn line, arrow, rectangle, circle,
  ellipse, triangle, diamond, pentagon or hexagon snaps to clean geometry when you lift the
  pen. The guess is checked against your ink before it is accepted: the candidate outline is
  sampled and every point measured against it, so a scribble that happens to have four corners
  is left as ink. One undo always returns the original stroke.
- **Ruler** — drag to move, scroll over it to rotate (Shift for 5° steps); ink snaps to its edge

### Objects
- Sticky notes in eight colours and three sizes, with auto-fitting text
- Text boxes with five sizes, alignment and a handwriting font option. Sizes are what you see:
  a 32px text box or a 200px note placed while zoomed out to 36% is created large enough in
  board units to still measure 32px and 200px on screen.
- Placing a note or a text box hands the board back to the pen the moment you finish typing,
  so the next stylus touch writes instead of dragging a marquee. Editing existing text from
  Select stays in Select.
- A text box shrinks to fit what you typed; a long line wraps at the width it started with
  rather than running off. Resize it by hand and that size is kept.
- Clicking existing text or a note with the Text or Note tool selects and opens it rather than
  dropping a new one on top.
- Fourteen shapes (rectangle, rounded rectangle, ellipse, triangle, right triangle, diamond,
  pentagon, hexagon, octagon, star, cloud, line, arrow, double arrow) with outline, fill and
  line-weight controls, and text inside any of them
- Tables with editable cells and a header row
- Images: insert, paste from clipboard, or drag and drop
- Full transform model — move, resize from eight handles, rotate, Shift-constrain,
  arrow-key nudge, z-order
- Transform handles work under **any** tool: if you can see a handle you can drag it, without
  switching back to Select first
- **Lock** pins an object in place: it shows a padlock badge, marquee select and the eraser
  skip it, Delete leaves it alone, and it has no drag handles. Click it to select it, then use
  the unlock button on the selection bar (or right-click ▸ Unlock) to release it.
- **Annotations belong to what they are drawn on.** Lock an imported page, mark it up, and the
  ink is attached to it: unlock the page and move, resize or rotate it, and the annotations
  travel with it. Delete the page and they go too — undo restores the pair. This is how
  marking up a document is meant to work, and it is why locking exists.
- Dragging with an ink tool draws a dashed outline of what you have hold of, so you can see
  what is moving even though there is no persistent selection in that mode.

### Selection
- Marquee select, **lasso select**, Shift to add or remove, select all
- Floating contextual toolbar over the selection (recolour, duplicate, order, lock, delete)
- Right-click menu everywhere

### Templates
Fourteen built-in templates with live thumbnails: Brainstorm, SWOT, Kanban, Retrospective,
Project planning, Effective meeting, KWL chart, Frayer model, Mind map, Decision matrix,
Weekly planner, Empathy map, Flowchart starter, Blank.

### Documents (the addition to the original)
`Insert ▸ Document` — or just drag a file onto the canvas — accepts:

| Format | Handled by |
| --- | --- |
| `.pdf` | pdf.js, rendered directly |
| `.docx` `.doc` `.rtf` `.odt` | LibreOffice if installed, otherwise the built-in converter |
| `.pptx` `.ppt` `.odp` | LibreOffice if installed, otherwise the built-in converter |
| `.xlsx` `.xls` `.ods` `.txt` | LibreOffice |

**You choose the pages.** Anything longer than one page opens a picker first: thumbnails of
every page with checkboxes, a range box (`1-3, 7, 10-12`), and a choice of row, grid or
stacked layout. Take page 4 of a 90-page PDF instead of all ninety.

Every page becomes its own independent object on the board - never a group. Annotate over it,
move it, resize it, lock it, export it with the rest of the board. **The ink eraser never
touches it**: in ink mode the eraser only cuts ink, so you can rub an annotation off a page
without harming the page. Removing a whole page is the eraser's explicit "erase whole objects"
mode, or select it and press Delete.

**Quality.** The picker offers Standard (144 dpi), High (216 dpi) and Maximum (300 dpi, print
resolution) with a running estimate of what it will add to the board file. The page's size in
board units is identical at every setting — only the number of pixels behind it changes, so
raising it is purely about how far you can zoom in before it softens.

**Fidelity note.** If LibreOffice is on the machine the app shells out to it
(`soffice --headless --convert-to pdf`) and you get the real layout. If it is not, a built-in
converter runs instead — `mammoth` for Word, a small OOXML reader for PowerPoint — rendered in
a hidden window and printed to PDF. That path is readable rather than pixel-perfect: it keeps
text, formatting, pictures, tables, shape positions and slide geometry, but it does not
reproduce Word's exact pagination or PowerPoint's theme backgrounds. Settings ▸ About tells you
which engine is active. Set `GAZBOARD_DISABLE_LIBREOFFICE=1` to force the built-in path.

### Export and files
- PNG (whole board or just the selection, 2× scale)
- SVG (real vectors — strokes, shapes and text stay editable in Illustrator/Inkscape)
- PDF (A4 / Letter / A3 / Legal / A5 or the board's own shape; portrait or landscape; margins;
  the whole board on one sheet, or tiled at actual size across as many sheets as it takes)
- `.gazboard` document files (Save a copy / Open); `.openboard` files from earlier versions still open
- Autosave to a local board library, browsable from **Boards**

Boards live in `<userData>/boards` — on Windows that is `%APPDATA%\GazBoard\boards`, on
Linux `~/.config/GazBoard/boards`. **Uninstalling does not remove them**, so reinstalling
picks up exactly where you left off. The Boards panel shows the folder and can open it.

Boards are written atomically (temp file plus rename), and which board was open is
recorded in a file by the main process rather than in browser storage — so a machine
that is switched off rather than shut down cleanly still comes back to your work. If
that pointer is ever lost, the app opens the most recent board that has something on
it; it will not greet you with a blank canvas while your boards sit on disk.

---

## Keyboard shortcuts

| | |
| --- | --- |
| `V` `L` `P` `H` `E` `N` `T` `S` | Select, Lasso, Pen, Highlighter, Eraser, Note, Text, Shape |
| `Space` + drag, middle-drag | Pan |
| Mouse drag with pen/highlighter selected | Pan (once a stylus has been used) |
| Any mouse button during a pen stroke | Drag the canvas under the pen |
| Run the pointer into the window edge | Auto-pan while drawing or dragging |
| `Ctrl` + wheel, pinch | Zoom |
| `Ctrl` `0` / `Ctrl` `+` / `Ctrl` `-` | Reset / in / out |
| `Ctrl` `Shift` `F` | Fit to board |
| `Ctrl` `Z` / `Ctrl` `Y` | Undo / redo |
| `Ctrl` `C` `X` `V` `D` | Copy, cut, paste, duplicate |
| `Ctrl` `A` / `Delete` | Select all / delete |
| `F2`, double-click | Edit text of selection |
| Arrow keys (`Shift` = ×10) | Nudge |
| `Ctrl` `Shift` `]` / `[` | Bring to front / send to back |
| `Ctrl` `R` | Ruler |
| `Ctrl` `N` `O` `S` | New / open / save a copy |

---

## Architecture

```
main.js              Electron main: window, menus, app:// protocol, dialogs,
                     board storage, document→PDF conversion
preload.js           The only bridge into the renderer (contextIsolation on, no nodeIntegration)
src/convert.html     Hidden window used by the built-in Office converter
src/js/core/
  store.js           Document model + operation log + undo/redo
  surface.js         Canvas view, culling, draw loop
  camera.js          Pan/zoom transform
  render.js          Every object type, backgrounds, selection chrome
  tools.js           Pointer state machine for all tools
  hit.js             Hit testing, marquee, lasso, eraser sweeps
  recognize.js       Ink → shape classifier
  transform.js       Move / scale / rotate maths
src/js/importers/    pdf.js rasteriser, OOXML PowerPoint reader
src/js/ui/           Toolbar, popovers, panels, context menu, text editing
```

### About "structured for collaboration later"

Nothing mutates the document directly. Every change is an **operation**
(`add` / `del` / `set` / `order` / `doc`) that is applied, pushed onto the undo stack, and
broadcast on `store.onOp()`. Two methods complete the seam:

```js
const snapshot = store.checkpoint();   // full state, resets the op log
store.applyRemote(ops);                // replay a peer's ops, no undo entry, no echo
```

A sync layer only has to move `checkpoint()` once per peer and then stream ops — the editor
itself needs no changes. The smoke suite asserts this: it checkpoints a board, performs
edits, replays the log into a fresh `Store` and checks the two documents match.

---

## Tests

```bash
npm run smoke            # headless, uses LibreOffice if present
npm run smoke:builtin    # forces the built-in Office converter
npm run test:restart     # kills the app mid-session and checks the board comes back
```

193 assertions covering boot, ink, partial and whole-object erase, stylus/mouse device roles,
pan-while-drawing and edge auto-pan, shape recognition, notes/text/shapes/tables, undo/redo,
transforms, hit testing, the pen tray, click-away deselect, the zoom readout, the handwriting
font, the pen-nib cursor, the About plate, the handwriting default and its settings migration,
PDF export page sizes and the pages it actually writes, board recovery after an unclean
shutdown, carrying boards over from an older install, lock adoption of ink already drawn, templates, backgrounds, the ruler, PDF/Word/PowerPoint import,
PNG rendering, save/load round-trips, the op-log seam, tool switching and panel UI.
Erase coverage includes the split, the undo restore, a near miss, whole-object mode, and
erasing off the end of a stroke. HiDPI coverage samples the far corner of the canvas buffer at
1x / 1.25x / 1.5x / 2x to prove the whole surface is painted, and the suite is also run end to
end under `--force-device-scale-factor` at each of those scales.
Screenshots and a results file are written to `test/out/`.

---

## Not included

Everything in Microsoft Whiteboard 21.x that only exists because of the Microsoft account:
sign-in, cloud boards, sharing links, real-time co-authoring, presence cursors, reactions,
Bing image search, and the Teams meeting integration. Ink, canvas, objects, templates,
export and settings are all here.

MIT licensed. Not affiliated with or endorsed by Microsoft.

*by theBoringCode — created with ♥ with Claude Cowork*
