# 早期原型，已被 shoot3/4/5 等专用脚本取代，仅作历史参考
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(path.dirname(import.meta.dirname));
const PORT = 9338;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--remote-allow-origins=*', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${ROOT}/.chrome-profile`, '--window-size=1280,720',
  '--force-device-scale-factor=1', 'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('no target');
}
const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = e => send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'file:///' + ROOT.replace(/\\/g, '/') + '/index.html' });
await sleep(2000);

for (const expr of ['typeof player', 'typeof state', 'typeof obstacles', '1+1', 'JSON.stringify({a:1})']) {
  const r = await ev(expr);
  console.log(JSON.stringify(expr), '=>', JSON.stringify(r).slice(0, 300));
}
ws.close(); proc.kill(); await sleep(150); process.exit(0);
