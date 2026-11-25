// 진입점: 불러오기 → 입장 폼 → 월드·통신·게임 시작.
import { createEngine } from './core/engine.js';
import { createInput } from './core/input.js';
import { createWorld } from './world/world.js';
import { createFollowCamera } from './player/camera.js';
import { createLocalPlayer } from './player/local.js';
import { createNet } from './net/net.js';
import { createRemotes } from './net/remotes.js';
import { createUI } from './ui/ui.js';
import { createMinimap } from './ui/minimap.js';
import { store } from './store.js';
import { CLUBS, VERSION } from './config.js';
import { createGame } from './game/game.js';
import { buildProps } from './world/props.js';
import { buildInterior } from './world/interior.js';
import { sfx } from './core/sfx.js';

const canvas = document.getElementById('view');
// 화면을 한 번 그릴 틈을 준다. 탭이 가려져 있으면 rAF가 안 돌 수 있어서 타이머로도 깨운다.
const nextFrame = () =>
  new Promise((r) => {
    let done = false;
    const f = () => {
      if (!done) {
        done = true;
        r();
      }
    };
    requestAnimationFrame(() => setTimeout(f, 0));
    setTimeout(f, 80);
  });
const ZONE_CODE = { campus: 'c', js4: 'j4', js5: 'j5' };

async function boot() {
  const input = createInput(canvas);
  const ui = createUI(input);
  store.data.muted = []; // 접속 ID는 매번 바뀌므로 숨김 목록은 접속할 때마다 비운다
  ui.loading('글꼴을 불러오는 중…', 0.08);
  // 간판·이름표를 캔버스에 그리므로 글꼴이 먼저 있어야 한다(늦으면 기본 글꼴로 진행)
  try {
    await Promise.race([document.fonts.load('bold 40px "Jua"', '대림캠퍼스'), new Promise((r) => setTimeout(r, 2500))]);
  } catch (e) {
    /* 무시 */
  }
  ui.loading('언덕을 쌓는 중…', 0.25);
  await nextFrame();
  const engine = createEngine(canvas);
  const world = createWorld(engine);
  ui.loading('나무를 심고 전산관을 꾸미는 중…', 0.6);
  await nextFrame();
  world.props = buildProps(engine, world);
  world.campus.group.add(world.props.group);
  buildInterior(engine, world);
  ui.loading('거의 다 됐어요…', 0.9);
  await nextFrame();
  const cam = createFollowCamera(engine, input);
  engine.setTime(store.data.time || 'day');
  Object.assign(window.__dl, { engine, world, cam, input, ui });

  // 입장 폼 뒤로 캠퍼스를 천천히 도는 화면
  let intro = true;
  const introPos = { x: 5, y: 40, z: -5 };
  const introZone = { interior: false, pitchMin: -1, pitchMax: 1.5, cameraBlocked: () => false };
  cam.yaw = 0.35;
  cam.pitch = 0.36;
  cam.dist = cam.cur = 215;
  engine.onUpdate((dt) => {
    if (!intro) return;
    cam.yaw += dt * 0.045;
    cam.update(dt, introPos, introZone);
    engine.follow(introPos.x, introPos.y, introPos.z);
  });
  engine.start();
  ui.loading('준비 끝!', 1);
  await nextFrame();
  ui.hideLoading();

  const profile = await ui.askProfile(store.data.profile);
  sfx.unlock();
  if (Object.keys(store.data.stamps || {}).length >= 15) profile.g = 1;
  store.set('profile', profile);
  intro = false;
  cam.yaw = 0;
  cam.pitch = 0.3;
  cam.dist = cam.cur = 9;

  const player = createLocalPlayer(engine, input, world, cam, profile);
  const net = createNet(profile);
  const remotes = createRemotes(engine, net, () => player.zone);
  const minimap = createMinimap(world, document.getElementById('minimap'));
  const game = createGame({ engine, world, player, cam, input, ui, net, remotes, store, minimap, profile });
  ui.showHud();

  const clubColor = (p) => (CLUBS.find((c) => c.id === p.c) || {}).color || '#cfe3ff';

  // ----- 채팅 -----
  ui.chat.onSend((text) => {
    if (!net.sendChat(text)) {
      ui.toast('조금 천천히 보내 주세요');
      return false;
    }
    ui.chat.add(profile.n, text, clubColor(profile), 'me');
    player.avatar.say(text);
    return true;
  });
  net.on('chat', (id, text, peer) => {
    if (store.data.muted.includes(id)) return;
    ui.chat.add(peer.profile.n, text, clubColor(peer.profile));
  });
  let quietUntil = performance.now() + 4000; // 접속 직후 몰려오는 입장 알림은 생략
  net.on('join', (id, peer) => {
    if (performance.now() > quietUntil) ui.chat.system(`${peer.profile.n} 님이 캠퍼스에 들어왔어요`);
  });
  net.on('leave', (id, peer) => {
    if (peer.profile) ui.chat.system(`${peer.profile.n} 님이 나갔어요`);
  });
  let wasUp = false;
  net.on('status', (st) => {
    if (st.up > 0 && !wasUp) {
      wasUp = true;
      quietUntil = performance.now() + 4000;
      ui.chat.system('서버에 연결됐어요. 같은 시간에 들어온 사람들이 보입니다.');
    } else if (st.up === 0 && wasUp && !st.trying) {
      wasUp = false;
      ui.chat.system('연결이 끊겼어요. 다시 연결하는 중…');
    }
  });

  // ----- 감정표현 -----
  input.on('emote', (n) => {
    if (ui.panel.isOpen()) return;
    player.avatar.playEmote(n);
  });

  // ----- 프레임 -----
  let netT = 0;
  let lastNetState = null;
  // 탭이 가려지면 화면 갱신(rAF)이 멈추므로, 그동안은 타이머로 생존 신호만 보낸다
  setInterval(() => {
    if (document.hidden && lastNetState) net.tick(1, lastNetState);
  }, 1000);
  engine.onUpdate((dt) => {
    input.poll();
    player.frozen = ui.panel.isOpen() || !!player.climbFrozen;
    player.update(dt);
    cam.update(dt, player.pos, world.active);
    engine.follow(player.pos.x, player.pos.y, player.pos.z);
    remotes.update(dt);
    game.update(dt);
    lastNetState = {
      x: player.pos.x,
      y: player.pos.y,
      z: player.pos.z,
      yaw: player.yaw,
      flags: (player.onGround ? 0 : 1) | (player.running ? 2 : 0),
      zone: ZONE_CODE[player.zone] || 'c',
      emote: player.avatar.emote,
    };
    net.tick(dt, lastNetState);
    netT += dt;
    if (netT > 0.5) {
      netT = 0;
      ui.setNet(net.status(), remotes.count() + 1);
    }
    ui.setStamina(player.stamina, player.tired, player.stamina < 0.995);
    input.endFrame();
  });

  net.start();
  ui.chat.system(`대림 캠퍼스 온라인 v${VERSION} — WASD로 걷고, Shift로 달리고, Enter로 채팅!`);
  game.start();

  // 디버그: 숨겨진 창에서는 WebGL 화면이 스크린샷에 안 잡혀서, 그린 직후의 캔버스를 <img>로 덮어 확인한다.
  window.__dl = Object.assign(window.__dl || {}, { engine, input, world, cam, player, net, remotes, game, ui, store });
}

window.__dl = {
  snap(dt = 1 / 60, n = 1) {
    const d = window.__dl;
    d.engine.hold = true;
    d.engine.tick(dt, n);
    let img = document.getElementById('__snap');
    if (!img) {
      img = document.createElement('img');
      img.id = '__snap';
      img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1';
      canvas.after(img);
    }
    img.src = canvas.toDataURL('image/jpeg', 0.9);
    const i = d.engine.renderer.info;
    return { calls: i.render.calls, tris: i.render.triangles, pos: d.player ? d.player.pos.toArray().map((v) => +v.toFixed(1)) : null };
  },
  unsnap() {
    const img = document.getElementById('__snap');
    if (img) img.remove();
    window.__dl.engine.hold = false;
  },
};

boot().catch((e) => {
  console.error(e);
  const m = document.getElementById('loadmsg');
  if (m) m.textContent = '불러오지 못했어요: ' + (e && e.message ? e.message : e);
});
