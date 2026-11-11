import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(import.meta.dirname);
const PORT = 9350;

let demo = fs.readFileSync(`${ROOT}/index.html`, 'utf8');
demo = demo.replace(/\}\)\(\);\s*<\/script>/, `window.__G = {
  player, get state(){return state}, get slides(){return player.sliding},
  get jumps(){return player.jumps}, get tut(){return tutorialOpen}, get boost(){return boostT},
  setBoost(v){ boostT = v; hudEl.classList.add('hud-boost'); }
};
})();
</script>`);
fs.writeFileSync(`${ROOT}/shots/ui.html`, demo);

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
  if (m.method === 'Runtime.exceptionThrown') console.log('!! EXC:', m.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

async function shot(n, clip) {
  const p = { format: 'png' };
  if (clip) p.clip = { ...clip, scale: clip.scale || 2 };
  const { data } = await send('Page.captureScreenshot', p);
  fs.writeFileSync(`${ROOT}/shots/${n}.png`, Buffer.from(data, 'base64'));
  console.log('  shot', n);
}
async function touch(x, y, hold = 90) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await sleep(hold);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(60);
}

// ---- 1. 首次打开：清掉标记后重载 ----
await send('Page.navigate', { url: `file://${ROOT}/shots/ui.html` });
await sleep(1500);
await ev(`localStorage.removeItem('naiwa_tut'); location.reload(); 'ok'`);
await sleep(1600);
console.log('首次打开 tutorialOpen =', await ev('__G.tut'),
            ' 引导层可见 =', await ev(`!document.getElementById('tutScreen').classList.contains('hidden')`));
await shot('ui_tut');

// 点"知道了"
const btn = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.getElementById('tutBtn').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})())`));
await touch(btn.x, btn.y);
await sleep(300);
console.log('点击后 tutorialOpen =', await ev('__G.tut'),
            ' 标记 =', await ev(`localStorage.getItem('naiwa_tut')`));

// ---- 2. 再次打开：不再弹 ----
await ev(`location.reload(); 'ok'`);
await sleep(1600);
console.log('二次打开 引导层可见 =', await ev(`!document.getElementById('tutScreen').classList.contains('hidden')`));
await shot('ui_start', { x: 0, y: 0, width: 844, height: 390, scale: 2 });

// ---- 3. 左右分区操作 ----
await touch(422, 200);        // 任意位置开局
await sleep(600);
console.log('state =', await ev('__G.state'));
// 等落地
for (let i = 0; i < 40; i++) { if (await ev('__G.player.onGround')) break; await sleep(50); }
await sleep(300);

// 左半屏按住 → 趴下
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 200, id: 2 }] });
await sleep(160);
console.log('左半屏按住 sliding =', await ev('__G.slides'));
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(200);
console.log('松开 sliding =', await ev('__G.slides'));

// 右半屏点击 → 跳跃
const y0 = await ev('Math.round(__G.player.y)');
await touch(660, 200);
await sleep(120);
console.log('右半屏点击  y:', y0, '→', await ev('Math.round(__G.player.y)'), ' jumps =', await ev('__G.jumps'));

// ---- 4. 冲刺倒计时 ----
await sleep(1500);
await ev('__G.setBoost(3.4)');
await sleep(120);
console.log('冲刺框可见 =', await ev(`document.getElementById('boostBox').classList.contains('on')`),
            ' 文本 =', await ev(`document.getElementById('boostVal').textContent`),
            ' 进度条 =', await ev(`document.getElementById('boostFill').style.width`));
await shot('ui_boost');
await sleep(1200);
console.log('1.2s 后 文本 =', await ev(`document.getElementById('boostVal').textContent`),
            ' 进度条 =', await ev(`document.getElementById('boostFill').style.width`));
await sleep(5000);
console.log('结束后 冲刺框可见 =', await ev(`document.getElementById('boostBox').classList.contains('on')`),
            ' state =', await ev('__G.state'), ' boostT =', await ev('__G.boost'));

ws.close(); proc.kill(); await sleep(150); process.exit(0);
