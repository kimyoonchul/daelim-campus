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
import { CLUBS, VERSION, ZONES } from './config.js';
import { createGame } from './game/game.js';
import { createMayhem } from './mayhem/index.js';
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
  // 난투(무기·파괴·차량·보스). 무기 바꾸기 입력(Q·무기 막대)은 이 모듈이 직접 받는다.
  const mayhem = createMayhem({ engine, world, player, cam, input, ui, net, remotes, store, profile, game });
  game.mayhem = mayhem;
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
    if (ui.panel.isOpen() || mayhem.isFrozen()) return;
    player.avatar.playEmote(n);
  });

  // ----- 통신에 실을 내 상태 -----
  // 보낼 때마다 지금 값으로 만든다(같은 객체를 고쳐 쓴다 — net이 값을 베껴 간다).
  // flags 비트: 1 공중, 2 달리기, 4 기절. zone은 통신 코드(모르는 구역이면 내부 id 그대로 — net이 기본 구역으로 바꿔 보낸다).
  const netState = { x: 0, y: 0, z: 0, yaw: 0, flags: 0, zone: '', emote: 0, hp: 100, wpn: 0, atk: 0, car: -1, ax: 0, az: 0 };
  function buildNetState() {
    const m = mayhem.netState();
    netState.x = player.pos.x;
    netState.y = player.pos.y;
    netState.z = player.pos.z;
    netState.yaw = player.yaw;
    netState.flags = (player.onGround ? 0 : 1) | (player.running ? 2 : 0) | (m.ko ? 4 : 0);
    netState.zone = Object.hasOwn(ZONES, player.zone) ? ZONES[player.zone] : player.zone;
    netState.emote = player.avatar.emote;
    netState.hp = m.hp;
    netState.wpn = m.wpn;
    netState.atk = m.atk;
    netState.car = m.car;
    netState.ax = m.ax;
    netState.az = m.az;
    return netState;
  }

  // ----- 프레임 -----
  let netT = 0;
  let running = false; // 첫 프레임이 돈 뒤부터 true
  // 탭이 가려지면 화면 갱신(rAF)이 멈추므로, 그동안은 타이머로 생존 신호만 보낸다.
  // 숨기 직전 값을 기억해 두지 않고 그때그때 새로 만든다(가려질 때 무기를 넣은 것이 그대로 나가게).
  setInterval(() => {
    if (document.hidden && running) net.tick(1, buildNetState());
  }, 1000);
  // 탭이 가려지는 순간 난투 모듈이 무기를 넣는다(이보다 먼저 등록된 리스너). 바뀐 상태를 바로 한 번 알린다.
  // 발신 제한에 걸려 못 나가도 위의 타이머가 1초 안에 다시 보낸다.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) net.sendState(buildNetState());
  });
  engine.onUpdate((dt) => {
    running = true;
    input.poll();
    player.frozen = ui.panel.isOpen() || !!player.climbFrozen || mayhem.isFrozen();
    mayhem.update(dt);
    player.update(dt);
    cam.update(dt, player.pos, world.active);
    engine.follow(player.pos.x, player.pos.y, player.pos.z);
    remotes.update(dt);
    game.update(dt);
    net.tick(dt, buildNetState());
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
  window.__dl = Object.assign(window.__dl || {}, { engine, input, world, cam, player, net, remotes, game, mayhem, ui, store });
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
