import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(import.meta.dirname);
const PORT = 9348;

let demo = fs.readFileSync(`${ROOT}/index.html`, 'utf8');
demo = demo.replace(/function gameOver\(fell\)\{/, 'function gameOver(fell){ if(window.__DEMO) return;');
demo = demo.replace(/\}\)\(\);\s*<\/script>/, `window.__G = {
  obstacles, pickups, player,
  obstacleBox, get state(){return state},
  types(){ return obstacles.map(o=>o.type+':'+Math.round(o.x+o.w/2)); },
  bottleOverlap(){
    const bad = [];
    for(const p of pickups){
      for(const o of obstacles){
        if(o.type === 'pit') continue;
        const ob = obstacleBox(o); if(!ob) continue;
        const hw=22, hh=28, pad=2;
        if(p.x > ob.x-hw-pad && p.x < ob.x+ob.w+hw+pad &&
           p.y > ob.y-hh-pad && p.y < ob.y+ob.h+hh+pad){
          bad.push(o.type+'@'+Math.round(o.x+o.w/2)+'/'+Math.round(p.x)+','+Math.round(p.y));
        }
      }
    }
    return bad;
  }
};
})();
</script>`);
fs.writeFileSync(`${ROOT}/shots/spawn.html`, demo);

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
await send('Page.navigate', { url: `file://${ROOT}/shots/spawn.html` });
await sleep(2000);
await ev('window.__DEMO = true; document.getElementById("startBtn").click()');
await sleep(1500);

// 记录所有生成过的障碍类型（按生成顺序）
await ev(`
  window.__SEQ = [];
  const origPush = Array.prototype.push;
  'ok'
`);

// 每 80ms 采样一次，记录新出现的障碍（以对象引用去重）
await ev(`window.__seen = new Set(); window.__order = [];`);
let overlaps = [];
const t0 = Date.now();
while (Date.now() - t0 < 26000) {
  await ev(`
    for(const o of __G.obstacles){
      if(!window.__seen.has(o)){ window.__seen.add(o); window.__order.push(o.type); }
    }
  `);
  const bad = await ev('JSON.stringify(__G.bottleOverlap())');
  const arr = JSON.parse(bad);
  if (arr.length) overlaps.push(...arr);
  await sleep(80);
}

const order = await ev('JSON.stringify(window.__order)');
console.log('障碍生成顺序（共 %d 个）:', JSON.parse(order).length);
console.log(JSON.parse(order).join(' → '));
console.log('\n奶瓶压在障碍上的采样次数:', overlaps.length);
if (overlaps.length) console.log('  样例:', overlaps.slice(0, 8).join(' | '));

ws.close(); proc.kill(); await sleep(150); process.exit(0);
