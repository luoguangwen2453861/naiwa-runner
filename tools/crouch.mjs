import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(import.meta.dirname);
const PORT = 9351;

let demo = fs.readFileSync(`${ROOT}/index.html`, 'utf8');
demo = demo.replace('if(!seen){', 'if(false){');   // 测试构建里不弹首次引导
demo = demo.replace(/\}\)\(\);\s*<\/script>/, `window.__G = {
  player, get state(){return state}, get slides(){return player.sliding},
  get onGround(){return player.onGround}, get squash(){return player.squash},
  get box(){ return playerBox(); }
};
})();
</script>`);
fs.writeFileSync(`${ROOT}/shots/crouch.html`, demo);

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
await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `file://${ROOT}/shots/crouch.html` });
await sleep(1800);
await ev(`localStorage.setItem('naiwa_tut','1'); location.reload(); 'ok'`);
await sleep(1500);
await ev('document.getElementById("startBtn").click()');
await sleep(900);

const down = x => send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: 200, id: 1 }] });
const up = () => send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

// 落地状态
for (let i = 0; i < 40; i++) { if (await ev('__G.onGround')) break; await sleep(50); }
await sleep(200);
const before = await ev('JSON.stringify({box:__G.box, sq:__G.squash})');
await down(180);
const afterNow = await ev('JSON.stringify({s:__G.slides, box:__G.box, sq:__G.squash})');
await up();
console.log('地面：按下前 ', before);
console.log('地面：按下瞬间', afterNow);

await sleep(500);
// 空中状态
await down(660);   // 右半屏跳跃
await sleep(30);
await up();
for (let i = 0; i < 30; i++) { if (!(await ev('__G.onGround'))) break; await sleep(20); }
await sleep(60);
console.log('空中 onGround =', await ev('__G.onGround'), ' sliding =', await ev('__G.slides'));
await down(180);
const airNow = await ev('JSON.stringify({s:__G.slides, box:__G.box, sq:__G.squash})');
await up();
console.log('空中：按下瞬间', airNow);

ws.close(); proc.kill(); await sleep(150); process.exit(0);
