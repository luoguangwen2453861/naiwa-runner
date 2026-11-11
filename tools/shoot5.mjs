import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(import.meta.dirname);
const PORT = 9340;

let demo = fs.readFileSync(`${ROOT}/index.html`, 'utf8');
demo = demo.replace('if(!seen){', 'if(false){');   // 测试构建里不弹首次引导
demo = demo.replace(
  /function gameOver\(fell\)\{/,
  'function gameOver(fell){ if(window.__DEMO) return;'
);
demo = demo.replace(/\}\)\(\);\s*<\/script>/, `window.__G = {
  player, obstacles, get state(){return state},
  clearObs(){ obstacles.length = 0; },
  setDemo(v){ window.__DEMO = v; },
  kill(){ gameOver(false); },
  slide(){ startSlide(); },
  jump(){ jump(); }
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
let id = 0; const pend = new Map(); const errors = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
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
await sleep(1500);

async function shot(n, clip) {
  const p = { format: 'png' };
  if (clip) p.clip = { ...clip, scale: clip.scale || 3 };
  const { data } = await send('Page.captureScreenshot', p);
  fs.writeFileSync(`${ROOT}/shots/${n}.png`, Buffer.from(data, 'base64'));
  console.log('  shot', n);
}
const C = { x: 120, y: 300, width: 320, height: 320, scale: 3 };

// 滑铲
await ev('__G.clearObs(); __G.slide()');
await sleep(120);
await shot('p_slide', C);
await ev('__G.player.sliding = false; __G.player.slideHold = false;');

// 腾空（上升）
await sleep(300);
await ev('__G.jump()');
await sleep(110);
await shot('p_air_up', C);
await sleep(200);
await shot('p_air_down', C);
await sleep(700);

// 死亡
await ev('__G.clearObs(); __G.setDemo(false); __G.kill()');
await sleep(160);
await shot('p_dead1', C);
await sleep(300);
await shot('p_dead2', C);
await sleep(900);
await shot('p_over', { x: 0, y: 0, width: 1280, height: 720, scale: 1 });

console.log('errors:', errors.length ? errors.join('\n') : '(none)');
ws.close(); proc.kill(); await sleep(150); process.exit(0);
