import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.dirname(import.meta.dirname);
const PORT = 9339;
const PAGE_URL = 'file:///' + ROOT.replace(/\\/g, '/') + '/shots/demo.html';

// 生成 demo：① 撞障碍不死 ② 暴露内部状态供 CDP 操作
let demo = fs.readFileSync(`${ROOT}/index.html`, 'utf8');
demo = demo.replace('if(!seen){', 'if(false){');   // 测试构建里不弹首次引导
demo = demo.replace(
  /function gameOver\(fell\)\{/,
  'function gameOver(fell){ window.__DEATHS=(window.__DEATHS||0)+1; if(window.__DEMO) return;'
);
// 调试：window.__PIN 为真时蘑菇不随场景左移，便于精确验证平台着陆
demo = demo.replace(
  'o.x -= effSpeed * dt;',
  'if(!(window.__PIN && o.type === "mushroom")) o.x -= effSpeed * dt;'
);
demo = demo.replace(
  /\}\)\(\);\s*<\/script>/,
  `window.__G = {
    player, obstacles, pickups, get state(){return state}, get GROUND_Y(){return GROUND_Y},
    mushroomTop, mushroomHalfW, mushroomTopAt, landOn, RIG, HERO_SCALE,
    setPhase(v){ player.runPhase = v; }, clearObs(){ obstacles.length = 0; },
    addMush(x){ obstacles.push({type:'mushroom', x, w:112, h:112, hit:true, seed:.4}); }
  };
})();
</script>`
);
fs.writeFileSync(`${ROOT}/shots/demo.html`, demo);
console.log('demo patched =', demo.includes('window.__G'), demo.includes('window.__DEMO'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--remote-allow-origins=*', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${ROOT}/.chrome-profile`, '--window-size=1280,720',
  '--force-device-scale-factor=1', 'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('no target');
}
const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  if (m.method === 'Runtime.exceptionThrown') console.log('!! EXC:', m.params.exceptionDetails.text, m.params.exceptionDetails.exception?.description || '');
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: PAGE_URL });
await sleep(2000);
console.log('typeof __G =', await ev('typeof window.__G'));

await ev('window.__DEMO = true');
await ev(`document.getElementById('startBtn').click()`);

async function shot(name, clip) {
  const p = { format: 'png' };
  if (clip) p.clip = { ...clip, scale: clip.scale || 2 };
  const { data } = await send('Page.captureScreenshot', p);
  fs.writeFileSync(`${ROOT}/shots/${name}.png`, Buffer.from(data, 'base64'));
  console.log('  shot', name);
}
const CLOSE = { x: 120, y: 330, width: 300, height: 300, scale: 3 };

await sleep(1200);

// ===== A. 跑步相位采样 =====
console.log('--- A 跑步相位 ---');
await ev('__G.clearObs()');
for (let i = 0; i < 6; i++) {
  await ev(`__G.setPhase(${(i * Math.PI / 3).toFixed(4)})`);
  await sleep(50);
  await shot(`r${i}`, CLOSE);
}
// 髋部特写
await ev(`__G.setPhase(${(Math.PI/2).toFixed(4)})`);
await sleep(50);
await shot('hip', { x: 200, y: 470, width: 150, height: 140, scale: 6 });
// 脚底是否贴地
console.log('  脚底检测:', await ev(`JSON.stringify({py:Math.round(__G.player.y), onGround:__G.player.onGround})`));

// ===== B. 蘑菇平台 =====
console.log('--- B 蘑菇平台 ---');
await ev('window.__PIN = true');
await ev(`(()=>{
  __G.clearObs(); __G.addMush(268 - 48);
  const p = __G.player;
  p.y = 300; p.vy = 0; p.onGround = false; p.jumps = 1;
  return 'ok';
})()`);
await sleep(100); await shot('m1_fall', CLOSE);
await sleep(450);
console.log('  落地:', await ev(`JSON.stringify({y:Math.round(__G.player.y), onGround:__G.player.onGround, state:__G.state, expect:__G.GROUND_Y-112})`));
await shot('m2_land', CLOSE);
await sleep(400);
console.log('  站稳:', await ev(`JSON.stringify({y:Math.round(__G.player.y), onGround:__G.player.onGround, state:__G.state})`));
await shot('m3_stand', CLOSE);

// 解除钉住 → 蘑菇滑走 → 应自然坠回地面，且全程不判死
await ev('window.__DEATHS = 0');
await ev('window.__PIN = false');
let diedDuringFall = 0;
for (let i = 0; i < 30; i++) {
  await sleep(40);
  const d = await ev('window.__DEATHS');
  if (d > 0) diedDuringFall = d;
}
console.log('  掉回:', await ev(`JSON.stringify({y:Math.round(__G.player.y), onGround:__G.player.onGround, state:__G.state, deaths:window.__DEATHS})`));
await shot('m4_fell', CLOSE);

// ===== B2. 站上蘑菇后跳下 / 跳回，都不能死 =====
console.log('--- B2 蘑菇上起跳 ---');
await ev('window.__DEATHS = 0');
await ev('window.__PIN = true');
await ev(`(()=>{
  __G.clearObs(); __G.addMush(268 - 48);
  const p = __G.player;
  p.y = 460; p.vy = 0; p.onGround = false; p.jumps = 1;
  return 'ok';
})()`);
await sleep(400);
console.log('  站上:', await ev(`JSON.stringify({y:Math.round(__G.player.y), onGround:__G.player.onGround, deaths:window.__DEATHS})`));
// 平台上起跳（应可用）
await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'})); window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'})); 'jump'`);
await sleep(200);
console.log('  起跳中:', await ev(`JSON.stringify({y:Math.round(__G.player.y), onGround:__G.player.onGround, deaths:window.__DEATHS})`));
await shot('b2_jump', CLOSE);
await sleep(1200);
console.log('  落回:', await ev(`JSON.stringify({y:Math.round(__G.player.y), onGround:__G.player.onGround, deaths:window.__DEATHS})`));
// 解除钉住让它滑走，落地不死
await ev('window.__PIN = false');
await sleep(1600);
console.log('  最终:', await ev(`JSON.stringify({y:Math.round(__G.player.y), onGround:__G.player.onGround, deaths:window.__DEATHS, state:__G.state})`));

// ===== B3. 正面撞蘑菇仍然会死（蘑菇侧面不是安全区）=====
console.log('--- B3 正面撞击 ---');
await ev('window.__DEATHS = 0');
await ev(`(()=>{
  __G.clearObs();
  const p = __G.player;
  p.y = __G.GROUND_Y; p.vy = 0; p.onGround = true;
  __G.addMush(268 + 140);      // 蘑菇从右侧滚过来
  return 'ok';
})()`);
for (let i=0;i<18;i++){
  await sleep(50);
  const d = await ev('window.__DEATHS');
  if (d > 0) break;
}
console.log('  撞上后:', await ev(`JSON.stringify({deaths:window.__DEATHS, y:Math.round(__G.player.y), cx:__G.obstacles[0]?Math.round(__G.obstacles[0].x+56):-1, ridden:__G.obstacles[0]?!!__G.obstacles[0].ridden:null})`));

// ===== B4. 蘑菇正对角色时必然判死（侧面不可穿过）=====
await ev('window.__DEATHS = 0');
await ev(`(()=>{
  __G.clearObs();
  const p = __G.player;
  p.y = __G.GROUND_Y; p.vy = 0; p.onGround = true; p.rideT = 0; p.noPlat = null;
  __G.addMush(268 - 56);
  return 'ok';
})()`);
await sleep(200);
console.log('  B4 正对:', await ev(`JSON.stringify({deaths:window.__DEATHS, y:Math.round(__G.player.y)})`));

console.log('--- C 蘑菇外观 ---');
await ev('window.__PIN = true');
await ev(`__G.clearObs(); __G.addMush(700); __G.player.y=__G.GROUND_Y; __G.player.onGround=true; 'ok'`);
await sleep(120);
await shot('c1_mush', { x: 620, y: 380, width: 260, height: 240, scale: 3 });

// 站到蘑菇上
await ev(`(()=>{
  const p = __G.player; __G.clearObs(); __G.addMush(268 - 48);
  p.y = 300; p.vy = 0; p.onGround = false; p.jumps = 1;
  return 'ok';
})()`);
await sleep(500);
await shot('c2_on', { x: 130, y: 380, width: 320, height: 300, scale: 3 });
await ev('window.__PIN = false');

// ===== D. 整屏 =====
await sleep(1500);
await shot('d1_full', { x: 0, y: 0, width: 1280, height: 720, scale: 1 });

ws.close(); proc.kill(); await sleep(150); process.exit(0);
