// Board templates - each returns a list of objects laid out around (0,0).

import { uid } from './core/util.js';
import { drawObject } from './core/render.js';

const T = (text, x, y, w, size = 34, align = 'left') => ({
  id: uid('t'), type: 'text', x, y, w, h: size * 1.5, text, fontSize: size,
  color: '#201f1e', align, valign: 'middle', rotation: 0, bold: true, font: 'ui'
});

const Body = (text, x, y, w, size = 18, align = 'left') => ({
  id: uid('t'), type: 'text', x, y, w, h: size * 1.6, text, fontSize: size,
  color: '#605e5c', align, valign: 'top', rotation: 0, font: 'ui'
});

const Box = (x, y, w, h, opts = {}) => ({
  id: uid('sh'), type: 'shape', kind: opts.kind || 'roundRect', x, y, w, h, rotation: 0,
  stroke: opts.stroke ?? '#8a8886', fill: opts.fill ?? '#ffffff', lineWidth: opts.lineWidth ?? 2,
  text: opts.text || '', textColor: opts.textColor || '#201f1e', fontSize: opts.fontSize || 0, dash: opts.dash
});

const Note = (x, y, text, color = '#ffd94a', size = 160) => ({
  id: uid('n'), type: 'note', x, y, w: size, h: size, color, text, rotation: 0, align: 'center', font: 'ui'
});

const Head = (x, y, w, h, label, color) => Box(x, y, w, h, { fill: color, stroke: 'none', text: label, textColor: '#ffffff', fontSize: Math.min(30, h * 0.5) });

function columns(labels, colors, { x = -700, y = -260, w = 340, h = 620, gap = 24 } = {}) {
  const out = [];
  labels.forEach((label, i) => {
    const cx = x + i * (w + gap);
    out.push(Box(cx, y, w, h, { fill: '#faf9f8', stroke: '#e1dfdd', lineWidth: 2 }));
    out.push(Head(cx, y, w, 60, label, colors[i % colors.length]));
  });
  return out;
}

function quadrants(labels, colors, { x = -620, y = -380, w = 620, h = 380, gap = 16 } = {}) {
  const out = [];
  labels.forEach((label, i) => {
    const cx = x + (i % 2) * (w + gap);
    const cy = y + Math.floor(i / 2) * (h + gap);
    out.push(Box(cx, cy, w, h, { fill: '#ffffff', stroke: '#e1dfdd', lineWidth: 2 }));
    out.push(Head(cx, cy, w, 54, label, colors[i % colors.length]));
  });
  return out;
}

const PALETTE = ['#6264a7', '#0078d4', '#038387', '#498205', '#ca5010', '#8764b8'];

// Page sizes come first, because the commenter who asked for them was right:
// you want to choose the shape of the paper before you start writing on it,
// not after. `page` is handled by the app rather than build() - these add no
// objects, they just set the canvas size.
const PAGE = (id, paper, orientation, name) => ({
  id, name, group: 'Canvas size', page: { paper, orientation }, build: () => []
});

export const TEMPLATES = [
  PAGE('page-infinite', 'infinite', 'portrait', 'Infinite canvas'),
  PAGE('page-a4-l', 'a4', 'landscape', 'A4 landscape'),
  PAGE('page-a4-p', 'a4', 'portrait', 'A4 portrait'),
  PAGE('page-letter-l', 'letter', 'landscape', 'Letter landscape'),
  PAGE('page-letter-p', 'letter', 'portrait', 'Letter portrait'),
  PAGE('page-a3-l', 'a3', 'landscape', 'A3 landscape'),
  {
    id: 'blank', name: 'Blank board', group: 'General',
    build: () => []
  },
  {
    id: 'brainstorm', name: 'Brainstorm', group: 'General',
    build: () => [
      T('Brainstorm', -700, -360, 700, 44),
      Body('Add a sticky note for every idea. No idea is a bad idea — group them later.', -700, -300, 700, 18),
      ...columns(['Ideas', 'Promising', 'Next steps'], PALETTE),
      Note(-660, -160, '', '#ffd94a'), Note(-480, -160, '', '#ffd94a'),
      Note(-296, -160, '', '#a4e7a0'), Note(68, -160, '', '#9ad9f5')
    ]
  },
  {
    id: 'swot', name: 'SWOT analysis', group: 'Strategy',
    build: () => [
      T('SWOT analysis', -620, -450, 700, 44),
      ...quadrants(['Strengths', 'Weaknesses', 'Opportunities', 'Threats'], ['#498205', '#ca5010', '#0078d4', '#a4262c'])
    ]
  },
  {
    id: 'kanban', name: 'Kanban board', group: 'Project',
    build: () => [
      T('Kanban board', -760, -340, 700, 44),
      ...columns(['Backlog', 'In progress', 'Review', 'Done'], PALETTE, { x: -760, w: 300, gap: 20 })
    ]
  },
  {
    id: 'retro', name: 'Retrospective', group: 'Team',
    build: () => [
      T('Sprint retrospective', -700, -340, 700, 44),
      ...columns(['Start doing', 'Stop doing', 'Continue doing'], ['#498205', '#a4262c', '#0078d4'])
    ]
  },
  {
    id: 'project', name: 'Project planning', group: 'Project',
    build: () => {
      const out = [T('Project plan', -760, -360, 700, 44)];
      const weeks = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'];
      weeks.forEach((w, i) => {
        const x = -760 + i * 300;
        out.push(Box(x, -280, 280, 90, { fill: PALETTE[i % PALETTE.length], stroke: 'none', text: w, textColor: '#fff', fontSize: 26 }));
        out.push(Box(x, -180, 280, 460, { fill: '#faf9f8', stroke: '#e1dfdd' }));
      });
      return out;
    }
  },
  {
    id: 'meeting', name: 'Effective meeting', group: 'Team',
    build: () => [
      T('Meeting', -640, -400, 700, 44),
      Box(-640, -330, 620, 200, { fill: '#ffffff', stroke: '#e1dfdd' }),
      Head(-640, -330, 620, 50, 'Agenda', '#6264a7'),
      Box(-640, -110, 620, 260, { fill: '#ffffff', stroke: '#e1dfdd' }),
      Head(-640, -110, 620, 50, 'Notes', '#0078d4'),
      Box(20, -330, 620, 200, { fill: '#ffffff', stroke: '#e1dfdd' }),
      Head(20, -330, 620, 50, 'Decisions', '#038387'),
      Box(20, -110, 620, 260, { fill: '#ffffff', stroke: '#e1dfdd' }),
      Head(20, -110, 620, 50, 'Action items', '#ca5010')
    ]
  },
  {
    id: 'kwl', name: 'KWL chart', group: 'Learning',
    build: () => [
      T('KWL chart', -700, -340, 700, 44),
      ...columns(['What I Know', 'What I Want to know', 'What I Learned'], ['#0078d4', '#8764b8', '#498205'])
    ]
  },
  {
    id: 'frayer', name: 'Frayer model', group: 'Learning',
    build: () => [
      ...quadrants(['Definition', 'Characteristics', 'Examples', 'Non-examples'], PALETTE),
      Box(-190, -100, 180, 180, { kind: 'ellipse', fill: '#6264a7', stroke: '#ffffff', lineWidth: 6, text: 'Concept', textColor: '#fff', fontSize: 24 })
    ]
  },
  {
    id: 'mindmap', name: 'Mind map', group: 'General',
    build: () => {
      const out = [Box(-130, -70, 260, 140, { kind: 'ellipse', fill: '#6264a7', stroke: 'none', text: 'Main idea', textColor: '#fff', fontSize: 26 })];
      const spokes = [[-520, -300], [200, -300], [-520, 190], [200, 190], [-620, -60], [420, -60]];
      spokes.forEach(([x, y], i) => {
        out.push(Box(x, y, 220, 110, { kind: 'roundRect', fill: '#ffffff', stroke: PALETTE[i % PALETTE.length], lineWidth: 3, text: 'Idea ' + (i + 1), fontSize: 20 }));
        out.push({
          id: uid('sh'), type: 'shape', kind: 'line', rotation: 0, stroke: '#a19f9d', lineWidth: 2, fill: 'none',
          x: x + 110, y: y + 55, w: 0 - (x + 110), h: 0 - (y + 55)
        });
      });
      return out;
    }
  },
  {
    id: 'decision', name: 'Decision matrix', group: 'Strategy',
    build: () => [
      T('Decision matrix', -560, -340, 700, 44),
      {
        id: uid('tb'), type: 'table', x: -560, y: -270, w: 1120, h: 500, rows: 5, cols: 5, rotation: 0,
        stroke: '#605e5c', fill: '#ffffff', lineWidth: 2, headerRow: true, headerColor: '#eceafb',
        cells: { '0,0': 'Option', '0,1': 'Cost', '0,2': 'Impact', '0,3': 'Effort', '0,4': 'Score' }
      }
    ]
  },
  {
    id: 'weekly', name: 'Weekly planner', group: 'Project',
    build: () => [
      T('Weekly planner', -840, -330, 700, 44),
      ...columns(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], PALETTE, { x: -840, w: 320, gap: 16, y: -260, h: 560 })
    ]
  },
  {
    id: 'empathy', name: 'Empathy map', group: 'Strategy',
    build: () => [
      ...quadrants(['Says', 'Thinks', 'Does', 'Feels'], ['#0078d4', '#8764b8', '#498205', '#ca5010']),
      Box(-150, -120, 300, 200, { kind: 'ellipse', fill: '#ffffff', stroke: '#6264a7', lineWidth: 4, text: 'Who?', fontSize: 28 })
    ]
  },
  {
    id: 'flow', name: 'Flowchart starter', group: 'General',
    build: () => {
      const out = [];
      const nodes = [
        ['Start', 'ellipse', -140, -420, 280, 100, '#6264a7'],
        ['Step', 'roundRect', -140, -250, 280, 110, '#0078d4'],
        ['Decision?', 'diamond', -170, -80, 340, 190, '#ca5010'],
        ['Yes path', 'roundRect', 260, -30, 260, 110, '#498205'],
        ['No path', 'roundRect', -520, -30, 260, 110, '#a4262c'],
        ['End', 'ellipse', -140, 160, 280, 100, '#323130']
      ];
      for (const [text, kind, x, y, w, h, color] of nodes)
        out.push(Box(x, y, w, h, { kind, fill: '#ffffff', stroke: color, lineWidth: 3, text, fontSize: 22 }));
      const arrows = [[0, -320, 0, -260], [0, -140, 0, -90], [0, 120, 0, 155]];
      for (const [x1, y1, x2, y2] of arrows)
        out.push({ id: uid('sh'), type: 'shape', kind: 'arrow', x: x1, y: y1, w: x2 - x1, h: y2 - y1, rotation: 0, stroke: '#605e5c', fill: 'none', lineWidth: 3 });
      return out;
    }
  }
];

/** Small canvas preview for the templates gallery. */
export function templateThumb(tpl, w = 150, h = 88) {
  const objs = tpl.build();
  const c = document.createElement('canvas');
  c.width = w * 2; c.height = h * 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  // a page template draws the sheet it would give you, not an empty frame
  if (tpl.page) {
    ctx.fillStyle = '#f3f2f1';
    ctx.fillRect(0, 0, c.width, c.height);
    if (tpl.page.paper === 'infinite') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.strokeStyle = '#d2d0ce'; ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 1; i < 4; i++) {
        ctx.moveTo((c.width / 4) * i, 0); ctx.lineTo((c.width / 4) * i, c.height);
        ctx.moveTo(0, (c.height / 4) * i); ctx.lineTo(c.width, (c.height / 4) * i);
      }
      ctx.stroke();
    } else {
      const ratios = { a4: 210 / 297, letter: 215.9 / 279.4, a3: 297 / 420 };
      let r = ratios[tpl.page.paper] || 210 / 297;
      if (tpl.page.orientation === 'landscape') r = 1 / r;
      const m = 16;
      let pw = c.width - m * 2, ph = pw / r;
      if (ph > c.height - m * 2) { ph = c.height - m * 2; pw = ph * r; }
      const px = (c.width - pw) / 2, py = (c.height - ph) / 2;
      ctx.fillStyle = 'rgba(0,0,0,.13)';
      ctx.fillRect(px + 3, py + 4, pw, ph);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = '#c8c6c4'; ctx.lineWidth = 2;
      ctx.strokeRect(px, py, pw, ph);
    }
    return c.toDataURL();
  }
  if (!objs.length) {
    ctx.strokeStyle = '#e1dfdd'; ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, c.width - 20, c.height - 20);
    return c.toDataURL();
  }
  let box = null;
  for (const o of objs) {
    const b = { x: o.x, y: o.y, w: o.w, h: o.h };
    if (b.w < 0) { b.x += b.w; b.w = -b.w; }
    if (b.h < 0) { b.y += b.h; b.h = -b.h; }
    box = box ? {
      x: Math.min(box.x, b.x), y: Math.min(box.y, b.y),
      w: Math.max(box.x + box.w, b.x + b.w) - Math.min(box.x, b.x),
      h: Math.max(box.y + box.h, b.y + b.h) - Math.min(box.y, b.y)
    } : b;
  }
  const pad = 14;
  const s = Math.min((c.width - pad * 2) / box.w, (c.height - pad * 2) / box.h);
  ctx.setTransform(s, 0, 0, s, pad - box.x * s + (c.width - pad * 2 - box.w * s) / 2, pad - box.y * s);
  for (const o of objs) drawObject(ctx, o);
  return c.toDataURL();
}
