# 早期原型，已被 shoot3/4/5 等专用脚本取代，仅作历史参考
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(path.dirname(import.meta.dirname));
const PORT = 9336;
const PAGE_URL = 'file:///' + ROOT.replace(/\\/g, '/') + '/shots/demo.html';

// 生成 demo 版本：撞到障碍不会结束
const src = fs.readFileSync(`${ROOT}/index.html`, 'utf8');
const demo = src.replace(
  /function gameOver\(fell\)\{/,
  'function gameOver(fell){ if(window.__DEMO) return;'
);
fs.writeFileSync(`${ROOT}/shots/demo.html`, demo);
console.log('demo built, patched =', demo.includes('window.__DEMO'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${ROOT}/.chrome-profile`,
  '--window-size=1280,720', '--force-device-scale-factor=1',
  'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('CDP target not found');
}

const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('ws timeout')), 8000);
  ws.onopen = () => { clearTimeout(t); res(); };
  ws.onerror = e => { clearTimeout(t); rej(new Error('ws err')); };
});

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
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJS = expr => send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: PAGE_URL });
await sleep(1800);

await evalJS(`window.__DEMO = true`);
await evalJS(`document.getElementById('startBtn').click()`);

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${ROOT}/shots/${name}.png`, Buffer.from(data, 'base64'));
  console.log('  shot', name);
}
async function key(code, hold = 70) {
  await evalJS(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}'}))`);
  await sleep(hold);
  await evalJS(`window.dispatchEvent(new KeyboardEvent('keyup',{code:'${code}'}))`);
}

await sleep(2500); await shot('d1_early');
await sleep(3000); await shot('d2_mid');

await key('Space'); await sleep(380); await shot('d3_jump');

await sleep(1200);
await evalJS(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowDown'}))`);
await sleep(300); await shot('d4_slide');
await evalJS(`window.dispatchEvent(new KeyboardEvent('keyup',{code:'ArrowDown'}))`);

await sleep(4000); await shot('d5_late');
await sleep(5000); await shot('d6_later');
await sleep(6000); await shot('d7_fast');

const info = await evalJS(`JSON.stringify({
  score: document.getElementById('scoreVal').textContent,
  energy: document.getElementById('energyFill').style.width
})`);
console.log('state:', info.result.value);

ws.close(); proc.kill(); await sleep(200); process.exit(0);
