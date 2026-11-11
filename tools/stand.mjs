import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(import.meta.dirname);
const PORT = 9347;

let demo = fs.readFileSync(`${ROOT}/dist/index.html`, 'utf8');
demo = demo.replace('if(!seen){', 'if(false){');
demo = demo.replace(/function gameOver\(fell\)\{/, 'function gameOver(fell){ if(window.__DEMO) return;');
demo = demo.replace('o.x -= effSpeed * dt;', 'if(!(window.__PIN && o.type === "mushroom")) o.x -= effSpeed * dt;');
demo = demo.replace(/\}\)\(\);\s*<\/script>/, `window.__G = {
  player, obstacles,
  clearObs(){ obstacles.length = 0; },
  addMush(x){ obstacles.push({type:'mushroom', x, w:112, h:112, hit:true, seed:.4}); },
  drop(y){ const p=__G.player; p.y=y; p.vy=0; p.onGround=false; p.jumps=1; p.rideT=0; p.noPlat=null; },
  hold(v){ window.__HOLD = v; }
};
})();
</script>`);
// 冻结 rideT：让奶蛙停在伞面上以便截图
demo = demo.replace('player.rideT -= dt;', 'if(!window.__HOLD) player.rideT -= dt;');
fs.writeFileSync(`${ROOT}/shots/stand.html`, demo);

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
await send('Page.navigate', { url: `file://${ROOT}/shots/stand.html` });
await sleep(2000);
await ev('window.__DEMO = true; window.__PIN = true; window.__HOLD = true; document.getElementById("startBtn").click()');
await sleep(1000);

async function stand(off, name) {
  await ev(`(()=>{
    __G.clearObs();
    __G.addMush(268 + ${off} - 56);
    __G.drop(400);
    return 1;
  })()`);
  for (let i = 0; i < 40; i++) { if (await ev('__G.player.onGround')) break; await sleep(30); }
  await sleep(120);
  const y = await ev('Math.round(__G.player.y)');
  const { data } = await send('Page.captureScreenshot', {
    format: 'png', clip: { x: 130, y: 400, width: 320, height: 240, scale: 3 }
  });
  fs.writeFileSync(`${ROOT}/shots/stand_${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  offset ${off} → 站立 y=${y}  (${name})`);
}

await stand(0, 'mid');
await stand(30, 'r30');
await stand(50, 'r50');
ws.close(); proc.kill(); await sleep(150); process.exit(0);
