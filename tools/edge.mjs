import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(import.meta.dirname);
const PORT = 9346;

let demo = fs.readFileSync(`${ROOT}/index.html`, 'utf8');
demo = demo.replace('if(!seen){', 'if(false){');
demo = demo.replace(/function gameOver\(fell\)\{/, 'function gameOver(fell){ window.__DEATHS=(window.__DEATHS||0)+1; if(window.__DEMO) return;');
demo = demo.replace('o.x -= effSpeed * dt;', 'if(!(window.__PIN && o.type === "mushroom")) o.x -= effSpeed * dt;');
demo = demo.replace(/\}\)\(\);\s*<\/script>/, `window.__G = {
  player, obstacles, get state(){return state},
  clearObs(){ obstacles.length = 0; },
  addMush(x){ obstacles.push({type:'mushroom', x, w:112, h:112, hit:true, seed:.4}); },
  drop(y){ const p=__G.player; p.y=y; p.vy=0; p.onGround=false; p.jumps=1; p.rideT=0; p.noPlat=null; }
};
})();
</script>`);
fs.writeFileSync(`${ROOT}/shots/edge.html`, demo);

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
await send('Page.navigate', { url: `file://${ROOT}/shots/edge.html` });
await sleep(2000);
await ev('window.__DEMO = true; document.getElementById("startBtn").click()');
await sleep(1200);

// 冻住蘑菇：不让它随场景移动，才能精确控制落点偏移
await ev('window.__PIN = true');

async function caseAt(off, cpuRate) {
  if (cpuRate) await send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  await ev('window.__DEATHS = 0');
  await ev(`(()=>{
    __G.clearObs();
    const cx = 268 + ${off};
    __G.addMush(cx - 56);
    __G.drop(300);
    return 1;
  })()`);
  // 等落地或判死
  let landed = false, died = false, y = 0; const trace = [];
  for (let i = 0; i < 60; i++) {
    await sleep(40);
    const s = JSON.parse(await ev(`JSON.stringify({y:Math.round(__G.player.y), g:__G.player.onGround, d:window.__DEATHS})`));
    y = s.y; if (trace.length < 16) trace.push(s.y + (s.g?'g':'') + (s.d?'D':''));
    if (s.d > 0) { died = true; break; }
    if (s.g && s.y < 555) { landed = true; break; }
    if (s.g && s.y > 560) break;  // 落在地面
  }
  if (cpuRate) await send('Emulation.setCPUThrottlingRate', { rate: 1 });
  if (cpuRate && died) console.log('    轨迹:', trace.join(' '));
  return { off, landed, died, y };
}

console.log('偏移(px)  结果');
console.log('-----------------');
for (const off of [0, 20, 35, 45, 52, 58, 63, 68, 75, 90, 110]) {
  const r = await caseAt(off, 0);
  console.log(`${String(off).padStart(6)}   ${r.died ? '✗ 死亡' : r.landed ? '✓ 落到伞盖 y=' + r.y : '— 落到地面 y=' + r.y}`);
}

console.log('\n-- 低帧率模拟（CPU 6x 降速，重复 3 次检查稳定性）--');
for (const off of [0, 0, 0, 40, 55, 62]) {
  const r = await caseAt(off, 6);
  console.log(`${String(off).padStart(6)}   ${r.died ? '✗ 死亡' : r.landed ? '✓ 落到伞盖 y=' + r.y : '— 落到地面 y=' + r.y}`);
}
await send('Emulation.setCPUThrottlingRate', { rate: 1 });

ws.close(); proc.kill(); await sleep(150); process.exit(0);
