import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(import.meta.dirname);
const PORT = 9341;

let demo = fs.readFileSync(`${ROOT}/index.html`, 'utf8');
demo = demo.replace('if(!seen){', 'if(false){');
demo = demo.replace(/function gameOver\(fell\)\{/, 'function gameOver(fell){ if(window.__DEMO) return;');
demo = demo.replace(/\}\)\(\);\s*<\/script>/, `window.__G = {
  player, obstacles, RIG, get state(){return state},
  clearObs(){ obstacles.length = 0; },
  setPhase(v){ player.runPhase = v; }
};
})();
</script>`);
fs.writeFileSync(`${ROOT}/shots/demo.html`, demo);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${ROOT}/.chrome-profile`,
  '--window-size=1280,720', '--force-device-scale-factor=1', 'about:blank'
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
let id = 0; const pend = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `file://${ROOT}/shots/demo.html` });
await sleep(2000);
await ev('window.__DEMO = true; document.getElementById("startBtn").click()');
await sleep(1200);

async function shot(n, clip) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: clip.scale || 8 } });
  fs.writeFileSync(`${ROOT}/shots/${n}.png`, Buffer.from(data, 'base64'));
  console.log('  shot', n);
}

// 髋部：screen 髋点 ≈ (272, 542)，取 90x80 区域放大 8 倍
const HIP = { x: 220, y: 500, width: 100, height: 92, scale: 6 };
await ev('__G.clearObs()');
for (const [i, ph] of [0, Math.PI/4, Math.PI/2, 3*Math.PI/4].entries()) {
  await ev(`__G.setPhase(${ph.toFixed(4)})`);
  await sleep(40);
  await shot(`z_hip${i}`, HIP);
}
ws.close(); proc.kill(); await sleep(150); process.exit(0);
