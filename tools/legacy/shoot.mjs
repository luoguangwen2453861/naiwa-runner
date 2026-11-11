# 早期原型，已被 shoot3/4/5 等专用脚本取代，仅作历史参考
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(path.dirname(import.meta.dirname));
const PORT = 9335;
const PAGE_URL = 'file:///' + ROOT.replace(/\\/g, '/') + '/index.html';

const sleep = ms => new Promise(r => setTimeout(r, ms));
console.log('[1] launching chrome');

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${ROOT}/.chrome-profile`,
  '--window-size=1280,720', '--force-device-scale-factor=1',
  'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'], detached: false });

proc.stderr.on('data', d => {
  const s = d.toString();
  if (s.includes('DevTools listening')) console.log('   ', s.trim());
});
proc.on('exit', c => console.log('[chrome exited]', c));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* retry */ }
    await sleep(300);
  }
  throw new Error('CDP target not found');
}

const wsUrl = await getWsUrl();
console.log('[2] ws url ok');

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('ws open timeout')), 8000);
  ws.onopen = () => { clearTimeout(t); res(); };
  ws.onerror = e => { clearTimeout(t); rej(new Error('ws error: ' + (e.message || e.type))); };
});
console.log('[3] ws connected');

let msgId = 0;
const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    console.log('!! EXCEPTION:', m.params.exceptionDetails.text,
      m.params.exceptionDetails.exception?.description || '');
  }
};
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const evalJS = expr => send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280, height: 720, deviceScaleFactor: 1, mobile: false
});
await send('Page.navigate', { url: PAGE_URL });
await sleep(2000);
console.log('[4] page loaded');

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${ROOT}/shots/${name}.png`, Buffer.from(data, 'base64'));
  console.log('    shot:', name);
}
async function key(code, holdMs = 70) {
  await evalJS(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}'}))`);
  await sleep(holdMs);
  await evalJS(`window.dispatchEvent(new KeyboardEvent('keyup',{code:'${code}'}))`);
}

await shot('cdp_start');

await evalJS(`document.getElementById('startBtn').click()`);
await sleep(1000);
await shot('cdp_run_a');

await key('Space');
await sleep(420);
await shot('cdp_jump');

await sleep(1100);
await shot('cdp_run_b');

await key('Space');
await sleep(400);
await key('Space');
await sleep(240);
await shot('cdp_doublejump');

await sleep(1400);
await shot('cdp_run_c');

await evalJS(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowDown'}))`);
await sleep(300);
await shot('cdp_slide');
await evalJS(`window.dispatchEvent(new KeyboardEvent('keyup',{code:'ArrowDown'}))`);

await sleep(2200);
await shot('cdp_run_d');
await sleep(2600);
await shot('cdp_run_e');

const info = await evalJS(`JSON.stringify({w:innerWidth,h:innerHeight,dpr:devicePixelRatio,state:document.getElementById('scoreVal').textContent})`);
console.log('[5] viewport/score:', info.result.value);

ws.close();
proc.kill();
await sleep(300);
process.exit(0);
