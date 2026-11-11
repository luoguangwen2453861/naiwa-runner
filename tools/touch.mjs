import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(import.meta.dirname);
const PORT = 9344;

let demo = fs.readFileSync(`${ROOT}/dist/index.html`, 'utf8');
demo = demo.replace('if(!seen){', 'if(false){');   // 测试构建里不弹首次引导
demo = demo.replace(/\}\)\(\);\s*<\/script>/, `window.__G = {
  player, get state(){return state}, get score(){return score},
  get slides(){return player.sliding}
};
})();
</script>`);
fs.writeFileSync(`${ROOT}/shots/touch.html`, demo);

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
// 手机横屏：844x390，DPR 3，mobile
await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 3, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `file://${ROOT}/shots/touch.html` });
await sleep(2000);

// 记录页面收到的指针/触摸事件
await ev(`
  window.__EVT = [];
  ['touchstart','touchend','pointerdown','pointerup','mousedown','click'].forEach(t=>{
    window.addEventListener(t, e=>window.__EVT.push(t+':'+(e.pointerType||'')+':'+(e.target.id||e.target.tagName)), true);
  });
  'ok'
`);

async function touch(x, y, hold = 90) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await sleep(hold);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(60);
}

console.log('stage 尺寸:', await ev(`JSON.stringify((()=>{const r=document.getElementById('stage').getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),t:Math.round(r.top),l:Math.round(r.left)}})())`));
console.log('viewport:', await ev(`JSON.stringify({iw:innerWidth,ih:innerHeight,dpr:devicePixelRatio})`));

// 点开始按钮
const btn = await ev(`JSON.stringify((()=>{const r=document.getElementById('startBtn').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})())`);
const b = JSON.parse(btn);
console.log('开始按钮:', btn);
await touch(b.x, b.y);
await sleep(500);
console.log('state =', await ev('__G.state'));

// 点上半屏 → 应该跳
console.log('起跳前 y =', await ev('Math.round(__G.player.y)'));
await touch(422, 120);
await sleep(120);
console.log('起跳后 y =', await ev('Math.round(__G.player.y)'), ' onGround =', await ev('__G.player.onGround'));

// 等落地再测滑铲
for(let i=0;i<40;i++){ if(await ev('__G.player.onGround')) break; await sleep(50); }
await sleep(200);
console.log('落地后 onGround =', await ev('__G.player.onGround'));

// 按住下半屏 → 应该滑铲
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 422, y: 330, id: 2 }] });
await sleep(150);
console.log('按住下半屏 sliding =', await ev('__G.slides'));
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(200);
console.log('松手后 sliding =', await ev('__G.slides'));

// 点击开始界面外的任意位置不应重复开局；验证 ready 态点击能开局
// 点击左侧黑边（舞台外）也应能跳
console.log('黑边点击前 y =', await ev('Math.round(__G.player.y)'));
await touch(30, 120);
await sleep(140);
console.log('黑边点击后 y =', await ev('Math.round(__G.player.y)'), ' onGround =', await ev('__G.player.onGround'));
await sleep(900);
// 下半屏黑边也应滑铲
for(let i=0;i<40;i++){ if(await ev('__G.player.onGround')) break; await sleep(50); }
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 30, y: 350, id: 3 }] });
await sleep(150);
console.log('黑边下半屏 sliding =', await ev('__G.slides'));
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
console.log('事件计数:', await ev('window.__EVT.length'));

console.log('捕获到的事件:', await ev('JSON.stringify(window.__EVT.slice(0,20))'));

ws.close(); proc.kill(); await sleep(150); process.exit(0);
