import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(import.meta.dirname);
const PORT = 9349;

let demo = fs.readFileSync(`${ROOT}/index.html`, 'utf8');
demo = demo.replace('if(!seen){', 'if(false){');
demo = demo.replace(/function gameOver\(fell\)\{/, 'function gameOver(fell){ window.__DEATHS=(window.__DEATHS||0)+1; if(window.__DEMO) return;');
demo = demo.replace(/\}\)\(\);\s*<\/script>/, `window.__G = {
  obstacles, player, get state(){return state},
  clearObs(){ obstacles.length = 0; },
  addMush(x){ obstacles.push({type:'mushroom', x, w:112, h:112, hit:true, seed:.4}); },
  jump(){ jump(); },
  reset(){ const p=player; p.y=GROUND_Y; p.vy=0; p.onGround=true; p.jumps=0; p.sliding=false; p.rideT=0; p.noPlat=null; p.x=268; }
};
})();
</script>`);
fs.writeFileSync(`${ROOT}/shots/play.html`, demo);

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
await send('Page.navigate', { url: `file://${ROOT}/shots/play.html` });
await sleep(2000);
await ev('window.__DEMO = true; document.getElementById("startBtn").click()');
await sleep(1200);

// 蘑菇从右边滚过来，在"距离触发值"时起跳，看结果
console.log('起跳距离  结果');
console.log('----------------');
for (const trig of [-1, 620, 460, 420, 380, 300]) {
  await ev('window.__DEATHS = 0; __G.reset(); __G.clearObs(); __G.addMush(1280);');
  // 等它滚到触发距离
  let jumped = false, died = false, landedMush = false, minY = 999;
  for (let i = 0; i < 400; i++) {
    const s = JSON.parse(await ev(`(()=>{
      const o = __G.obstacles.find(o=>o.type==='mushroom');
      return JSON.stringify({
        cx: o ? Math.round(o.x + 56) : -1,
        y: Math.round(__G.player.y),
        g: __G.player.onGround,
        d: window.__DEATHS,
        n: __G.obstacles.filter(o=>o.type==='mushroom').length
      });
    })()`));
    if (s.d > 0) { died = true; break; }
    if (trig > 0 && !jumped && s.cx > 0 && s.cx - 268 <= trig) { await ev('__G.jump()'); jumped = true; }
    if (s.g && s.y < 560 && s.y > 440) landedMush = true;
    if (jumped && s.g && s.y >= 585 && s.cx < 100) break;
    await sleep(16);
  }
  console.log(`${String(trig).padStart(6)}    ${died ? '✗ 死亡' : landedMush ? '✓ 曾站上伞盖' : '— 跳过去了/落地面'}`);
}

ws.close(); proc.kill(); await sleep(150); process.exit(0);
