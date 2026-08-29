// Tool cursors drawn as SVG and handed to CSS as data URIs.
//
// A crosshair is what a drawing program uses when it has nothing better; a pen
// tool should say "you are holding a pen". These glyphs are tinted with the
// colour actually loaded in the tool, so the cursor doubles as a colour readout,
// and the hotspot sits exactly on the nib point — what you click is what you draw.

const cache = new Map();

const esc = (svg) => svg.replace(/#/g, '%23').replace(/"/g, "'").replace(/\s+/g, ' ').trim();

/** A tilted pen: nib at the top-left, barrel running down to the bottom-right. */
function penSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
    <g stroke="#ffffff" stroke-width="2.6" stroke-linejoin="round" fill="none">
      <path d="M2 2 L10.4 5.6 L5.6 10.4 Z"/>
      <path d="M9.4 4.6 L21.2 16.4 A2.4 2.4 0 0 1 21.2 19.8 L19.8 21.2 A2.4 2.4 0 0 1 16.4 21.2 L4.6 9.4 Z"/>
    </g>
    <path d="M2 2 L10.4 5.6 L5.6 10.4 Z" fill="${color}"/>
    <path d="M9.4 4.6 L21.2 16.4 A2.4 2.4 0 0 1 21.2 19.8 L19.8 21.2 A2.4 2.4 0 0 1 16.4 21.2 L4.6 9.4 Z" fill="${color}"/>
    <path d="M7.2 7.2 L18.8 18.8" stroke="#ffffff" stroke-width="1.1" stroke-opacity=".55" fill="none"/>
  </svg>`;
}

/** A highlighter: the same tilt, but a flat chisel tip instead of a point. */
function markerSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
    <g stroke="#ffffff" stroke-width="2.6" stroke-linejoin="round" fill="none">
      <path d="M2.2 5.2 L6.4 1.9 L11.6 7.1 L7.4 10.4 Z"/>
      <path d="M9.6 5.2 L21.4 17 A2.4 2.4 0 0 1 21.4 20.4 L20 21.8 A2.4 2.4 0 0 1 16.6 21.8 L4.8 10 Z"/>
    </g>
    <path d="M2.2 5.2 L6.4 1.9 L11.6 7.1 L7.4 10.4 Z" fill="${color}" fill-opacity=".62"/>
    <path d="M9.6 5.2 L21.4 17 A2.4 2.4 0 0 1 21.4 20.4 L20 21.8 A2.4 2.4 0 0 1 16.6 21.8 L4.8 10 Z" fill="${color}"/>
  </svg>`;
}

/**
 * @param {'pen'|'highlighter'} kind
 * @param {string} color  the colour loaded in the tool
 * @param {string} fallback used when the browser refuses the image
 */
export function inkCursor(kind, color, fallback = 'crosshair') {
  const key = kind + color;
  let c = cache.get(key);
  if (!c) {
    const svg = kind === 'highlighter' ? markerSvg(color) : penSvg(color);
    // hotspot: the nib point. The pen tips at 2,2; the chisel meets the board at 2,5.
    const hot = kind === 'highlighter' ? '2 5' : '2 2';
    c = `url("data:image/svg+xml,${esc(svg)}") ${hot}, ${fallback}`;
    cache.set(key, c);
  }
  return c;
}
