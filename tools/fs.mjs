import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(import.meta.dirname);
const PORT = 9352;

let demo = fs.readFileSync(`${ROOT}/index.html`, 'utf8');
demo = demo.replace('if(!seen){', 'if(false){');
demo = demo.replace(/function gameOver\(fell\)\{/, 'function gameOver(fell){ if(window.__DEMO) return;');
demo = demo.replace(/\}\)\(\);\s*<\/script>/, `window.__G = {
  player, obstacles, pickups, get state(){return state}, get W(){return W},
  get vy(){return player.vy}
};
})();
</script>`);
fs.writeFileSync(`${ROOT}/shots/fs.html`, demo);

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
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map(); const errors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description||''));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error');
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: `file://${ROOT}/shots/fs.html` });
await sleep(1800);
await ev(`localStorage.setItem('naiwa_tut','1')`);
await ev(`document.getElementById('startBtn').click()`);

const CASES = [
  [1280, 720, false], [1600, 900, false], [1920, 1080, false],
  [844, 390, true], [1024, 768, false], [2560, 1080, false]
];
for (const [w, h, mobile] of CASES) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await sleep(700);
  const info = await ev(`JSON.stringify({
    W: __G.W, iw: innerWidth, ih: innerHeight,
    cv: [document.getElementById('game').width, document.getElementById('game').height],
    frogX: Math.round(__G.player.x), obs: __G.obstacles.length
  })`);
  console.log(`${w}x${h}  ${info}`);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${ROOT}/shots/fs_${w}x${h}.png`, Buffer.from(data, 'base64'));
}
console.log('errors:', errors.length ? errors.slice(0,3).join(' | ') : '(none)');
ws.close(); proc.kill(); await sleep(150); process.exit(0);
