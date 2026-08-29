// A single lightweight popover manager shared by the toolbar and menus.

let current = null;

export function closePopover() {
  if (current) { current.el.remove(); current.onClose?.(); current = null; }
}

export function isOpen(key) { return current?.key === key; }

/**
 * @param {HTMLElement|{x:number,y:number}} anchor
 * @param {HTMLElement} content
 * @param {{key?:string, placement?:'top'|'bottom'|'point', align?:'center'|'start'|'end', onClose?:Function, className?:string}} opts
 */
export function openPopover(anchor, content, opts = {}) {
  const key = opts.key;
  if (key && isOpen(key)) { closePopover(); return null; }
  closePopover();

  const el = document.createElement('div');
  el.className = 'pop ' + (opts.className || '');
  el.appendChild(content);
  document.body.appendChild(el);

  const r = el.getBoundingClientRect();
  let left, top;
  if (anchor instanceof HTMLElement) {
    const a = anchor.getBoundingClientRect();
    const align = opts.align || 'center';
    left = align === 'start' ? a.left : align === 'end' ? a.right - r.width : a.left + a.width / 2 - r.width / 2;
    top = opts.placement === 'bottom' ? a.bottom + 8 : a.top - r.height - 8;
    if (top < 8) top = a.bottom + 8;
  } else {
    left = anchor.x; top = anchor.y;
    if (top + r.height > innerHeight - 8) top = Math.max(8, anchor.y - r.height);
  }
  el.style.left = Math.max(8, Math.min(left, innerWidth - r.width - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(top, innerHeight - r.height - 8)) + 'px';

  current = { el, key, onClose: opts.onClose };

  const off = (e) => {
    if (!current) return;
    if (current.el.contains(e.target)) return;
    if (anchor instanceof HTMLElement && anchor.contains(e.target)) return;
    closePopover();
    document.removeEventListener('pointerdown', off, true);
  };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  return el;
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}
