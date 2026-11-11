import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(import.meta.dirname);
const PORT = 9342;

let demo = fs.readFileSync(`${ROOT}/index.html`, 'utf8');
demo = demo.replace('if(!seen){', 'if(false){');
demo = demo.replace(/function gameOver\(fell\)\{/, 'function gameOver(fell){ window.__DEATHS=(window.__DEATHS||0)+1; if(window.__DEMO) return;');
demo = demo.replace(/\}\)\(\);\s*<\/script>/, `window.__G = {
  player, obstacles, get state(){return state}, get speed(){return speed},
  clearObs(){ obstacles.length = 0; },
  addMush(x){ obstacles.push({type:'mushroom', x, w:112, h:112, hit:true, seed:.4}); },
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
await sleep(1600);

// 让奶蛙从高空落到蘑菇上，然后完全不操作，观察它是否自己回到地面
await ev(`(()=>{
  __G.clearObs(); window.__DEATHS = 0;
  __G.addMush(268 - 56);
  const p = __G.player;
  p.y = 300; p.vy = 0; p.onGround = false; p.jumps = 1;
  return 1;
})()`);

const CLIP = { x: 120, y: 330, width: 340, height: 300, scale: 2 };
const log = [];
for (let i = 0; i < 26; i++) {
  const st = await ev(`JSON.stringify({y:Math.round(__G.player.y), g:__G.player.onGround, s:__G.state,
    cx:__G.obstacles[0]?Math.round(__G.obstacles[0].x+56):-1, d:window.__DEATHS||0})`);
  log.push(st);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...CLIP, scale: 2 } });
  fs.writeFileSync(`${ROOT}/shots/seq_${String(i).padStart(2,'0')}.png`, Buffer.from(data, 'base64'));
  await sleep(70);
}
console.log(log.join('\n'));
ws.close(); proc.kill(); await sleep(150); process.exit(0);
