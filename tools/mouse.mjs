import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(import.meta.dirname);
const PORT = 9345;

let demo = fs.readFileSync(`${ROOT}/dist/index.html`, 'utf8');
demo = demo.replace('if(!seen){', 'if(false){');   // 测试构建里不弹首次引导
demo = demo.replace(/\}\)\(\);\s*<\/script>/, `window.__G = {
  player, get state(){return state}, get slides(){return player.sliding}, get jumps(){return player.jumps}
};
})();
</script>`);
fs.writeFileSync(`${ROOT}/shots/mouse.html`, demo);

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
await send('Page.navigate', { url: `file://${ROOT}/shots/mouse.html` });
await sleep(2000);

async function click(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(120);
}

console.log('stage:', await ev(`JSON.stringify((()=>{const r=document.getElementById('stage').getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),t:Math.round(r.top),l:Math.round(r.left)}})())`));

// 点任意位置开始（新逻辑）
await click(640, 360);
await sleep(400);
console.log('点击屏幕后 state =', await ev('__G.state'));

// 上半屏点击 → 应只跳一次（jumps = 1）
await click(640, 200);
await sleep(80);
console.log('点击上半屏 jumps =', await ev('__G.jumps'), ' vy =', await ev('Math.round(__G.player.vy)'));

// 等落地
for (let i = 0; i < 40; i++) { if (await ev('__G.player.onGround')) break; await sleep(50); }
await sleep(200);

// 按住下半屏 → 滑铲
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 620, button: 'left', clickCount: 1 });
await sleep(150);
console.log('按住下半屏 sliding =', await ev('__G.slides'));
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 620, button: 'left', clickCount: 1 });
await sleep(150);
console.log('松开后 sliding =', await ev('__G.slides'));

// 键盘仍可用
await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}))`);
await sleep(80);
console.log('键盘跳跃 jumps =', await ev('__G.jumps'));

ws.close(); proc.kill(); await sleep(150); process.exit(0);
