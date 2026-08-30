'use strict';
/*
 * Headless smoke test for the web build.
 *
 * Loads test/web-driver.html in a real headless Chromium and polls the page
 * (over the Chrome DevTools Protocol, via Node's built-in WebSocket/fetch) for
 * the driver's id="smoke-result" P A S S / F A I L marker.
 *
 * Chromium is never held on a virtual-time leash (the board's canvas render
 * loop keeps rAF running forever, which starves --virtual-time-budget) so we
 * use real time: launch, connect to DevTools, poll until the driver answers.
 *
 * Requires a system Chrome/Chromium (or CHROME_BIN). Pure Node deps only.
 * Run:  npm run web:smoke   (or: node test/web-smoke.js)
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../serve.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.CHROMIUM_BIN,
    '/snap/bin/chromium',
    'chromium-browser',
    'chromium',
    'google-chrome',
    'google-chrome-stable',
    'chrome'
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['--version'], { timeout: 15000 });
      if (r.status === 0) return { exe: c, version: r.stdout.toString().trim() };
    } catch {}
  }
  return null;
}

let msgId = 0;
function cdp(ws) {
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message));
      else resolve(m.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { send };
}

async function waitForResult(ws) {
  const api = cdp(ws);
  await api.send('Runtime.enable');
  const deadline = Date.now() + 150000;
  let last = null;
  let step = null;
  while (Date.now() < deadline) {
    const r = await api.send('Runtime.evaluate', {
      expression: `(() => { const el = document.getElementById('smoke-result'); return { text: el ? el.textContent : null, step: window.__dstep || null }; })()`,
      returnByValue: true
    });
    last = r.result && r.result.value && r.result.value.text;
    step = r.result && r.result.value && r.result.value.step;
    if (last) return { text: last };
    await sleep(300);
  }
  return { text: '', error: `timed out after 150s (step=${step}, last=${last})` };
}

async function main() {
  const { server, port, host } = await createServer();
  const pageUrl = `http://${host}:${port}/test/web-driver.html`;
  const child = {};

  const browser = findChromium();
  if (!browser) {
    server.close();
    console.error('No Chromium/Chrome found. Install one (apt install chromium) or set CHROME_BIN before rerunning.');
    process.exitCode = 2;
    return;
  }
  console.log(`[web-smoke] ${browser.version}`);

try {
    const profiles = [
      path.join(os.homedir(), '.gazboard-web-smoke'),
      path.join(os.homedir(), 'snap', 'chromium', 'common', 'gazboard-web-smoke')
    ];
    for (const profile of profiles) {
    await fsp.rm(profile, { recursive: true, force: true });
    await fsp.mkdir(profile, { recursive: true });
    child.proc = spawn(browser.exe, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, pageUrl
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.profile = profile;

    child.proc.stderr.on('data', () => {});
    child.proc.on('error', (e) => { console.error('[browser]', e.message); server.close(); process.exit(1); });

    // chromium writes the chosen debug port here; poll until present
    const portFile = path.join(profile, 'DevToolsActivePort');
    let devPort = null;
    for (let i = 0; i < 60 && devPort === null; i++) {
      try {
        const f = await fsp.readFile(portFile, 'utf8');
        devPort = Number(f.split('\n')[0]);
      } catch { await sleep(200); }
    }
    if (devPort) { child.devPort = devPort; break; }
    child.proc.kill('SIGKILL');
    await sleep(300);
  }
  if (!child.devPort) throw new Error('DevToolsActivePort never appeared in any profile dir');

  // find our page target
    const devPort = child.devPort;
    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${devPort}/json/list`)).json();
        target = list.find((t) => t.type === 'page' && t.url.startsWith(`http://${host}:${port}`));
      } catch {}
      if (!target) await sleep(200);
    }
    if (!target) throw new Error('page target not found on the devtools endpoint');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('devtools ws error')), { once: true }); });

    const { text, error } = await waitForResult(ws);
    console.log(text || (error ? `[web-smoke] driver: ${error}` : '[web-smoke] no smoke-result'));
    ws.close();
    process.exitCode = text && /^SMOKE PASS/.test(text) ? 0 : 1;
  } catch (e) {
    console.error('[web-smoke] crashed:', (e && e.message) || e);
    process.exitCode = 1;
  } finally {
    server.close();
    if (child.proc) child.proc.kill('SIGKILL');
  }
}

main();