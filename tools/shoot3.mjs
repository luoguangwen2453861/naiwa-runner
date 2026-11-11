import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(import.meta.dirname);
const PORT = 9337;
const PAGE = 'file:///' + ROOT.replace(/\\/g, '/') + '/shots/demo.html';

const src = fs.readFileSync(`${ROOT}/index.html`, 'utf8');
fs.writeFileSync(`${ROOT}/shots/demo.html`,
  src.replace(/function gameOver\(fell\)\{/, 'function gameOver(fell){ if(window.__DEMO) return;'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${ROOT}/.chrome-profile`,
  'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find(t => t.type === 'page');
      if (p) return p.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('no target');
}

const ws = new WebSocket(await wsUrl());
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('ws timeout')), 8000);
  ws.onopen = () => { clearTimeout(t); res(); };
  ws.onerror = () => { clearTimeout(t); rej(new Error('ws err')); };
});

let id = 0; const pend = new Map(); const errors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id); pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
  if (m.method === 'Runtime.exceptionThrown')
    errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    errors.push('console.error: ' + m.params.args.map(a => a.value).join(' '));
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = e => send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });

await send('Page.enable'); await send('Runtime.enable');

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${ROOT}/shots/${name}.png`, Buffer.from(data, 'base64'));
  console.log('  shot', name);
}
async function viewport(w, h, mobile) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile
  });
}

// ---- 桌面 ----
await viewport(1280, 720, false);
await send('Page.navigate', { url: PAGE });
await sleep(1800);
await shot('f_start_desktop');
await ev(`window.__DEMO = true; document.getElementById('startBtn').click()`);
await sleep(9000);
await shot('f_play_desktop');

// ---- 手机横屏 ----
await viewport(844, 390, true);
await sleep(400);
await ev(`location.reload()`);
await sleep(2000);
await shot('f_start_landscape');
await ev(`window.__DEMO = true; document.getElementById('startBtn').click()`);
await sleep(5000);
await shot('f_play_landscape');

// ---- 手机竖屏 ----
await viewport(390, 844, true);
await sleep(400);
await ev(`location.reload()`);
await sleep(1800);
await shot('f_portrait_tip');

console.log('errors:', errors.length ? errors.join('\n') : '(none)');
ws.close(); proc.kill(); await sleep(200); process.exit(0);
