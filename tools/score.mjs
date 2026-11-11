import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(import.meta.dirname);
const PORT = 9343;

let demo = fs.readFileSync(`${ROOT}/index.html`, 'utf8');
demo = demo.replace('if(!seen){', 'if(false){');   // 测试构建里不弹首次引导
demo = demo.replace(/\}\)\(\);\s*<\/script>/, `window.__G = {
  player, obstacles,
  get score(){return score}, get bonus(){return scoreBonus}, get shown(){return lastShownScore},
  get dist(){return distance}, get bottles(){return bottles},
  kill(){ gameOver(false); }
};
})();
</script>`);
fs.writeFileSync(`${ROOT}/shots/demo2.html`, demo);

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
await send('Page.navigate', { url: `file://${ROOT}/shots/demo2.html` });
await sleep(1800);

// 第一局：跑一段，积点分（含先前的分数）
await ev(`document.getElementById('startBtn').click()`);
await sleep(6000);
console.log('第一局中途:', await ev(`JSON.stringify({score:Math.round(__G.score), bonus:__G.bonus, hud:document.getElementById('scoreVal').textContent})`));

// 强制结束 + 重开
await ev(`__G.kill()`);
await sleep(1200);
console.log('结算后:', await ev(`JSON.stringify({final:document.getElementById('finalScore').textContent, bonus:__G.bonus})`));

await ev(`document.getElementById('retryBtn').click()`);
await sleep(160);
console.log('重开瞬间:', await ev(`JSON.stringify({score:Math.round(__G.score), bonus:__G.bonus, bottles:__G.bottles, dist:Math.round(__G.dist), hud:document.getElementById('scoreVal').textContent, energy:document.getElementById('energyFill').style.width})`));

await sleep(1200);
console.log('重开1.2s:', await ev(`JSON.stringify({score:Math.round(__G.score), hud:document.getElementById('scoreVal').textContent})`));

ws.close(); proc.kill(); await sleep(150); process.exit(0);
