// 자동차 타고 다니기(설계서 5.3): 주차된 차에 타서 몰고, 내리면 그 자리에 두었다가 30초 뒤(또는 60m 넘게 멀어지면) 제자리로 돌려보낸다.
// 움직임은 carstep.js(순수 함수)가 계산하고, 여기서는 입력·타고 내리기·차 메시·계기·남의 차·들이받기·카메라를 맡는다.
// 캠퍼스 전용 기능이라 늘 world.campus를 쓴다(내가 실내에 있어도 틀리지 않게). 차 메시는 캠퍼스 구역 그룹에 넣어 실내에서는 저절로 숨는다.
//
// 약속(앞 단계에서 넘어온 것)
// - 탈 때 bus 'mount' { i }, 내릴 때 bus 'unmount' { i } → mayhem.state.car(통신에 실리는 차량 번호)는 index.js가 맞춘다.
// - 탑승 중에는 player.mount = { x, y, z, yaw }를 매 프레임 갱신한다(mayhem.update가 player.update보다 먼저 돈다). 내릴 때 null.
// - 주차 인스턴스 숨김의 까닭: 내가 탄 차·버려 둔 차·터진 차는 'ride', 남이 탄 차는 'remote'(파괴 모듈은 'boom').
// - bus 'ko'는 내가 기절했을 때만 온다 — 바로 내린다.
// - 경적은 'fire' 이벤트만 쓴다(터치 공격 버튼은 input.fire와 'fire'를 둘 다 낸다).
// - 사람을 들이받으면 mayhem.claimHit(id, d, 'car', x, z)(대상별 1.2초 간격), 보스·과녁은 target.hurt(d, 'car', x, z).
//   들이받기는 무기 공격이 아니라서 bumpAtk를 부르지 않는다(남의 화면에서 무기를 쏜 것처럼 재현되지 않게). 전투 잠금만 mayhem.touchLock으로 건다.
// - 버려 둔 차는 충돌이 없다(걸어서 지나갈 수 있다). 제자리로 돌아가면 주차 충돌 원이 다시 켜진다.
// 남의 차: 원격 기록의 r.car(차량 번호)가 0 이상이고 캠퍼스에 있으면 그 사람 자리에 차를 그린다.
//   그린 사람에게는 r.carDrawnAt = engine.time을 적고, remotes.js는 이번 프레임에 차가 그려진 탑승자만 아바타를 숨긴다
//   (이 모듈이 꺼졌거나 그리지 못한 탑승자는 아바타라도 보인다 — 투명한 운전자가 생기지 않게).
//   그릴 칸은 접속자 수 상한(NET.maxPlayers)만큼 두어, 위조 탑승자가 칸을 다 차지해 진짜 운전자를 가리지 못한다.
//   주차된 그 차를 숨기는 것은 그 사람이 처음 탔다고 알린 자리가 그 차의 주차 자리 8m 안일 때만이고(위조로 남의 화면의 차를 지우지 못하게),
//   같은 번호를 여럿이 알리면 id가 사전순으로 가장 앞선 사람의 것만 친다. 숨김은 매 프레임 다시 계산한다(내리면 저절로 돌아온다).
import * as THREE from 'three';
import { Geo } from '../world/geom.js';
import { PLAYER, NET } from '../config.js';
import { stepCar, CAR } from './carstep.js';

const BOARD_R = 3.2; // 차 가운데에서 이만큼 안이면 탈 수 있다
const BOARD_DY = 2.5; // 높이 차가 이보다 크면(옹벽 위·아래) 타지 않는다
const EXIT_D = 2.6; // 내리는 자리: 차 가운데에서
const EXIT_DY = 1.5; // 내리는 자리의 땅이 차보다 이만큼 넘게 높거나 낮으면 거기로는 안 내린다
const EXIT_SPEED = 1.5; // 이보다 빠르면 먼저 브레이크를 밟아 세운 뒤에 내린다
const CAM_DIST = 12; // 운전할 때 카메라 거리
const FOLLOW_MIN = 2; // 이 속력 이상이고
const FOLLOW_IDLE = 1.2; // 이만큼 시점 조작이 없으면 카메라가 차 뒤로 돈다
const FOLLOW_RATE = 2.2;
const AB_MAX = 4; // 한꺼번에 버려 둘 수 있는 차
const ABANDON_SEC = 30; // 버려 둔 차가 제자리로 돌아가기까지
const ABANDON_FAR = 60; // 이보다 멀어지면 바로 돌아간다
const BOOM_SEC = 30; // 터진 내 차가 제자리에 다시 나타나기까지
const HOME_CLEAR = 3.4; // 제자리가 이만큼 비어야 돌아온다(내 위·내 차 위에 나타나지 않게)
const CLAIM_NEAR = 8; // 남이 처음 탔다고 알린 자리가 그 차의 주차 자리에서 이 안이어야 주차 차량을 숨긴다
// 그리는 남의 차 수: 접속자 수 상한만큼(모두 그릴 수 있게). 인스턴스 메시라 칸을 늘려도 그리기 호출은 그대로 2번이다
const REMOTE_MAX = Math.max(12, Number.isInteger(NET.maxPlayers) ? NET.maxPlayers : 60);
const RAM_SPEED = 5; // 이보다 빨라야 들이받은 것으로 친다(m/s)
const RAM_GAP = 1.2; // 같은 대상은 이 간격(초)으로만
const RAM_MUL = 2.6; // 피해 = 속력 × 2.6 (최대 60)
const RAM_MAX = 60;
const RAM_SEG = 1.25; // 차 몸통 = 중심선 ±1.25m 선분에서 반폭만큼(길이 4.3m)
const RIDER_R = 1.6; // 차에 탄 사람의 판정 반지름(무기 모듈과 같다)
const FOOT_R = 0.6; // 걷는 사람
const BOOM_DMG = 30; // 내 차가 터지면 무장한 운전자가 받는 피해
const BOOM_KNOCK = 9; // 그때 튕겨 나가는 속력(m/s)
const SMOKE_HP = 35; // 내구도가 이보다 낮으면 보닛에서 연기가 난다
const BODY_DEFAULT = 0x8d949c;
const CAB_COLOR = 0x1f2a36;
// 효과 인자(자주 부르는 것은 객체를 만들어 두고 고쳐 쓴다)
const FX_BOOM = { radius: 5, big: true };
const FX_BOOM_TEXT = { color: '#ff8a3d', size: 2.6, dur: 1.2 };
const FX_BANG = { color: '#ffd23f', size: 1.6, dur: 0.7 };
const FX_RAM = { color: '#ffd23f', size: 1.5, dur: 0.7 };
const FX_HONK = { color: '#ffffff', size: 1.1, dur: 0.6 };
const FX_DUST = { n: 4, size: 1.8, dur: 0.9, color: 0xcfc6b4 };
const FX_SMOKE = { n: 1, size: 1.2, dur: 1.3, color: 0x4a4a4a };

export function createVehicles(ctx) {
  const { engine, world, player, cam, input, ui, net, remotes, game, mayhem, bus, gfx, sfx, GAME } = ctx;
  const campus = world.campus;
  const CAMPUS = campus.id;
  const collider = campus.collider;
  const props = world.props || null;
  const cars = props && Array.isArray(props.cars) ? props.cars : [];
  const N = cars.length;
  const low = !!(engine.quality && engine.quality.low);
  const setCarVisible = (i, on, why) => {
    if (props && typeof props.setCarVisible === 'function') props.setCarVisible(i, on, why);
  };
  // carstep에 넘기는 캠퍼스 질의(collider의 메서드는 this가 필요해 한 번 감싸 둔다)
  const env = {
    heightAt: campus.heightAt,
    playable: campus.playable,
    solidAt: (x, z) => collider.solidAt(x, z),
    resolve: (p, r) => collider.resolve(p, r),
  };

  // ---------- 차 메시: 내 차 1 + 버려 둔 차 4 + 남의 차(접속자 수 상한만큼). 주차 차량과 같은 모양(props.js) ----------
  const SLOTS = 1 + AB_MAX + REMOTE_MAX;
  const bodyGeo = new Geo().box(0, 0.62, 0, 1.8, 0.62, 4.3).box(0, 0.25, 1.45, 1.85, 0.3, 0.5).box(0, 0.25, -1.45, 1.85, 0.3, 0.5).build();
  const cabGeo = new Geo().box(0, 1.2, -0.15, 1.6, 0.58, 2.3).build();
  const bodyMesh = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), SLOTS);
  const cabMesh = new THREE.InstancedMesh(cabGeo, new THREE.MeshLambertMaterial({ color: CAB_COLOR }), SLOTS);
  bodyMesh.name = 'vehicles-body';
  cabMesh.name = 'vehicles-cab';
  const _c = new THREE.Color();
  for (let k = 0; k < SLOTS; k++) bodyMesh.setColorAt(k, _c.setHex(0xffffff));
  for (const m of [bodyMesh, cabMesh]) {
    m.count = 0;
    m.visible = false;
    m.frustumCulled = false; // 움직이는 차라 경계 구를 매번 구하지 않고 늘 그린다(이번 프레임에 채운 칸만)
    m.castShadow = !low;
    m.receiveShadow = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    campus.group.add(m);
  }
  const slotColor = new Int32Array(SLOTS).fill(-1);
  let slot = 0; // 이번 프레임에 채운 칸 수
  let shown = 0; // 지난 프레임에 그린 수
  let colorDirty = false;
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _qy = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const ONE = new THREE.Vector3(1, 1, 1);
  const myNrm = new THREE.Vector3(0, 1, 0); // 내 차의 기울기(부드럽게 따라간다)

  /** 네 바퀴 자리의 지면 높이로 차의 기울기(nrm)를 구하고 평균 높이를 돌려준다(길가 주차 차량과 같은 방식) */
  function groundTilt(x, z, yaw, nrm) {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const lx = fz; // 차의 옆 방향(로컬 +x)
    const lz = -fx;
    const h = campus.heightAt;
    const h0 = h(x + fx * 1.5 + lx * 0.8, z + fz * 1.5 + lz * 0.8);
    const h1 = h(x + fx * 1.5 - lx * 0.8, z + fz * 1.5 - lz * 0.8);
    const h2 = h(x - fx * 1.5 + lx * 0.8, z - fz * 1.5 + lz * 0.8);
    const h3 = h(x - fx * 1.5 - lx * 0.8, z - fz * 1.5 - lz * 0.8);
    const ga = (h0 + h1 - h2 - h3) / 6; // 앞뒤 기울기
    const gl = (h0 + h2 - h1 - h3) / 3.2; // 좌우 기울기
    nrm.set(-(ga * fx + gl * lx), 1, -(ga * fz + gl * lz)).normalize();
    return (h0 + h1 + h2 + h3) / 4;
  }
  function compose(out, x, y, z, yaw, nrm) {
    _q.setFromUnitVectors(UP, nrm).multiply(_qy.setFromAxisAngle(UP, yaw));
    return out.compose(_p.set(x, y + 0.02, z), _q, ONE);
  }
  function put(m, color) {
    if (slot >= SLOTS) return;
    bodyMesh.setMatrixAt(slot, m);
    cabMesh.setMatrixAt(slot, m);
    if (slotColor[slot] !== color) {
      slotColor[slot] = color;
      bodyMesh.setColorAt(slot, _c.setHex(color));
      colorDirty = true;
    }
    slot++;
  }
  /** 이번 프레임에 채운 칸만 그린다. 그릴 차가 없으면 숨기고 올리지 않는다 */
  function flush() {
    if (slot !== shown) {
      shown = slot;
      bodyMesh.count = cabMesh.count = slot;
      bodyMesh.visible = cabMesh.visible = slot > 0;
    }
    if (slot > 0) {
      bodyMesh.instanceMatrix.needsUpdate = true;
      cabMesh.instanceMatrix.needsUpdate = true;
      if (colorDirty && bodyMesh.instanceColor) {
        bodyMesh.instanceColor.needsUpdate = true;
        colorDirty = false;
      }
    }
    slot = 0;
  }

  // ---------- 상태 ----------
  const car = { x: 0, z: 0, y: 0, yaw: 0, speed: 0, vy: 0, air: false, hp: CAR.hpMax, steer: 0 }; // 내가 모는 차(carstep이 고친다)
  const ctrl = { throttle: 0, steer: 0, brake: false };
  const res = { hit: 0, landed: false, impact: 0, edge: false, hx: 0, hz: 0 };
  const mount = { x: 0, y: 0, z: 0, yaw: 0 }; // player.mount로 넘기는 객체(하나를 고쳐 쓴다)
  const hud = { kmh: 0, hp01: 1 };
  let cur = -1; // 내가 탄 차 번호(-1이면 걷는 중)
  let curColor = BODY_DEFAULT;
  let savedDist = cam.dist;
  let exitReq = false; // 내리려고 브레이크를 밟는 중
  let lastLook = -Infinity; // 마지막으로 시점을 돌린 시각(engine.time)
  let smokeT = 0;
  let warned = false;
  let tipShown = false;
  let hornAt = -Infinity;
  // 버려 둔 차: 내린 자리에 메시로 남는다(행렬은 한 번만 만든다)
  const abs = [];
  for (let k = 0; k < AB_MAX; k++) abs.push({ i: -1, t: 0, x: 0, y: 0, z: 0, yaw: 0, hp: 0, color: 0, m: new THREE.Matrix4() });
  const abOf = (i) => {
    for (let k = 0; k < AB_MAX; k++) if (abs[k].i === i) return abs[k];
    return null;
  };
  const boomAt = new Float64Array(Math.max(1, N)); // 터진 내 차가 제자리에 돌아올 시각(0이면 없음)
  // 남이 타고 있어 숨긴 주차 차량: 이번 프레임(hide)과 계산용(hideNext)을 번갈아 쓴다
  let hide = new Uint8Array(Math.max(1, N));
  let hideNext = new Uint8Array(Math.max(1, N));
  const owner = new Array(N).fill(''); // 차 번호별로 그 차를 탔다고 알린 사람 중 id가 가장 앞선 사람(프레임마다 다시 채운다)
  const ownerOk = new Uint8Array(Math.max(1, N));
  const claims = new WeakMap(); // 원격 기록 → { car, ok }: 처음 탔다고 알렸을 때 주차 자리 8m 안이었는가
  const ramPeer = new Map(); // 사람 id → 마지막으로 들이받은 시각
  const ramTarget = new WeakMap(); // 과녁·보스 → 마지막으로 들이받은 시각
  let remotesDrawn = 0;
  const sparkOpt = { n: 8, color: 0xffd080, speed: 3, dur: 0.45 };
  const debrisOpt = { count: 28, colors: [BODY_DEFAULT, CAB_COLOR, 0x3a3a3a], power: 9, spread: 1.5, size: 0.55, ground: campus.heightAt };

  const climbing = () => !!(game && typeof game.climbActive === 'function' && game.climbActive());
  const hintAt = new Map();
  function hint(key, text, gapMs = 1500) {
    const now = performance.now();
    if (now - (hintAt.get(key) || -Infinity) < gapMs) return;
    hintAt.set(key, now);
    ui.toast(text);
  }
  function syncMount() {
    mount.x = car.x;
    mount.y = car.y;
    mount.z = car.z;
    mount.yaw = car.yaw;
  }

  // ---------- 타기 ----------
  function canBoardNow() {
    return cur < 0 && !player.mount && player.zone === CAMPUS && !climbing() && !mayhem.isFrozen() && !player.ko && !ui.panel.isOpen();
  }
  /** 그 차에 지금 탈 수 있는가: 보이는 주차 차량이나 내가 버려 둔 차이고, 3.2m 안이고, 남이 타고 있지 않다 */
  function boardable(i) {
    if (!canBoardNow() || !Number.isInteger(i) || i < 0 || i >= N) return false;
    const a = abOf(i);
    if (a ? hide[i] : !cars[i].visible) return false;
    const dx = (a ? a.x : cars[i].x) - player.pos.x;
    const dz = (a ? a.z : cars[i].z) - player.pos.z;
    return dx * dx + dz * dz <= BOARD_R * BOARD_R && Math.abs((a ? a.y : cars[i].y) - player.pos.y) < BOARD_DY;
  }
  /** 탈 수 있는 가장 가까운 차 번호(없으면 -1). 매 프레임 불리므로 가까운 차가 있을 때만 나머지 조건(패널 등)을 본다 */
  function nearestBoardable() {
    if (cur >= 0 || player.mount || player.zone !== CAMPUS) return -1;
    const px = player.pos.x;
    const pz = player.pos.z;
    const py = player.pos.y;
    let best = -1;
    let bd = BOARD_R * BOARD_R;
    for (let i = 0; i < N; i++) {
      const c = cars[i];
      if (!c.visible) continue;
      const dx = c.x - px;
      const dz = c.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bd && Math.abs(c.y - py) < BOARD_DY) {
        bd = d2;
        best = i;
      }
    }
    for (let k = 0; k < AB_MAX; k++) {
      const a = abs[k];
      if (a.i < 0 || hide[a.i]) continue;
      const dx = a.x - px;
      const dz = a.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bd && Math.abs(a.y - py) < BOARD_DY) {
        bd = d2;
        best = a.i;
      }
    }
    return best >= 0 && canBoardNow() ? best : -1;
  }
  function board(i) {
    if (!boardable(i)) return false;
    const a = abOf(i);
    if (a) {
      // 버려 둔 차에 다시 탄다: 그 자리·방향·내구도 그대로
      car.x = a.x;
      car.z = a.z;
      car.yaw = a.yaw;
      car.hp = a.hp;
      a.i = -1;
    } else {
      // 주차 인스턴스와 그 충돌 원을 먼저 끈다(안 그러면 첫 걸음에 제 원에 밀려 부딪힌 것이 된다)
      setCarVisible(i, false, 'ride');
      const c = cars[i];
      car.x = c.x;
      car.z = c.z;
      car.yaw = c.rot;
      car.hp = CAR.hpMax;
    }
    car.y = campus.heightAt(car.x, car.z);
    car.speed = car.vy = car.steer = 0;
    car.air = false;
    cur = i;
    curColor = Number.isFinite(cars[i].color) ? cars[i].color : BODY_DEFAULT;
    groundTilt(car.x, car.z, car.yaw, myNrm);
    exitReq = false;
    smokeT = 0;
    warned = car.hp < SMOKE_HP;
    syncMount();
    player.mount = mount;
    savedDist = cam.dist;
    cam.dist = CAM_DIST;
    boardIt.zone = null;
    exitIt.zone = CAMPUS;
    exitIt.x = car.x;
    exitIt.z = car.z;
    bus.emit('mount', { i });
    sfx.door();
    if (!tipShown) {
      tipShown = true;
      ui.toast(input.touch ? '🚗 스틱으로 운전 · 브레이크 버튼으로 멈추고 · 경적 버튼은 빵빵 · 노란 버튼으로 내려요' : '🚗 W/S 가속·후진 · A/D 방향 · Space 브레이크 · F 경적 · E 내리기', 5200);
    }
    return true;
  }

  // ---------- 내리기 ----------
  const probe = { x: 0, z: 0 };
  const spot = { x: 0, z: 0 };
  /**
   * 내릴 자리: 왼쪽 → 오른쪽 → 뒤 → 앞, 차 가운데에서 2.6m. 갈 수 있고 건물 밖이고 벽·소품에 걸리지 않는 땅이면 spot에 담고 true.
   * 먼저 차와 높이가 비슷한 자리(옹벽 위·아래가 아닌 곳)를 찾고, 없으면 높이는 따지지 않고 다시 찾는다(어디서든 내릴 수는 있게).
   */
  function findExit() {
    return exitPass(true) || exitPass(false);
  }
  function exitPass(level) {
    const s = Math.sin(car.yaw);
    const c = Math.cos(car.yaw);
    for (let k = 0; k < 4; k++) {
      // 왼쪽 (cos, -sin) · 오른쪽 (-cos, sin) · 뒤 (-sin, -cos) · 앞 (sin, cos)
      const dx = k === 0 ? c : k === 1 ? -c : k === 2 ? -s : s;
      const dz = k === 0 ? -s : k === 1 ? s : k === 2 ? -c : c;
      const x = car.x + dx * EXIT_D;
      const z = car.z + dz * EXIT_D;
      if (!campus.playable(x, z) || collider.solidAt(x, z)) continue;
      if (level && Math.abs(campus.heightAt(x, z) - car.y) > EXIT_DY) continue;
      probe.x = x;
      probe.z = z;
      if (collider.resolve(probe, PLAYER.radius)) continue;
      spot.x = x;
      spot.z = z;
      return true;
    }
    return false;
  }
  /**
   * 차에서 내린다. mode: 'user'(E) · 'ko'(기절) · 'boom'(내 차가 터짐) · 'zone'(다른 구역으로 옮겨졌다 — 사람은 이미 딴 곳에 있다).
   * 내릴 자리가 없으면 'user'는 그대로 타고 있고(안내), 나머지는 차 자리에 내린다. 내렸으면 true
   */
  function leave(mode) {
    if (cur < 0) return false;
    const found = mode !== 'zone' && !(mode === 'user' && car.air) && findExit();
    if (!found && mode === 'user') {
      hint('noexit', '여기서는 내릴 수 없어요');
      return false;
    }
    const i = cur;
    cur = -1;
    exitReq = false;
    player.mount = null;
    if (mode !== 'zone') player.place(CAMPUS, found ? spot.x : car.x, found ? spot.z : car.z, car.yaw);
    cam.dist = savedDist;
    ui.setCar(null);
    exitIt.zone = null;
    if (mode === 'boom') boomAt[i] = engine.time + BOOM_SEC;
    else abandon(i);
    bus.emit('unmount', { i });
    if (mode === 'user') sfx.door();
    return true;
  }
  /** E: 서 있으면 바로 내리고, 달리는 중이면 브레이크를 밟아 세운 뒤에 내린다 */
  function requestExit() {
    if (cur < 0) return false;
    if (Math.abs(car.speed) < EXIT_SPEED && !car.air) return leave('user');
    exitReq = true;
    return false;
  }
  /** 내린 자리에 차를 남긴다(충돌 없음). 자리가 다 찼으면 가장 오래 버려 둔 차부터 제자리로 */
  function abandon(i) {
    let a = null;
    for (let k = 0; k < AB_MAX && !a; k++) if (abs[k].i < 0) a = abs[k];
    if (!a) {
      a = abs[0];
      for (let k = 1; k < AB_MAX; k++) if (abs[k].t < a.t) a = abs[k];
      sendHome(a);
    }
    a.i = i;
    a.t = engine.time;
    a.x = car.x;
    a.z = car.z;
    a.yaw = car.yaw;
    a.hp = car.hp;
    a.color = curColor;
    a.y = groundTilt(a.x, a.z, a.yaw, _n); // 공중에서 내렸어도 땅에 놓는다
    compose(a.m, a.x, a.y, a.z, a.yaw, _n);
  }
  /** 버려 둔 차를 제자리로: 메시를 치우고 주차 인스턴스(와 충돌 원)를 되돌린다 */
  function sendHome(a) {
    const i = a.i;
    a.i = -1;
    if (i >= 0) setCarVisible(i, true, 'ride');
  }
  /** 제자리가 비었는가(내가 — 걷든 타든 — 그 위에 서 있지 않은가) */
  function homeClear(i) {
    if (player.zone !== CAMPUS) return true;
    const dx = player.pos.x - cars[i].x;
    const dz = player.pos.z - cars[i].z;
    return dx * dx + dz * dz >= HOME_CLEAR * HOME_CLEAR;
  }

  // ---------- 터짐 ----------
  function explode() {
    const x = car.x;
    const y = car.y;
    const z = car.z;
    gfx.explosion(x, y + 0.9, z, FX_BOOM);
    debrisOpt.colors[0] = curColor;
    gfx.debris(x, y + 1, z, debrisOpt);
    gfx.comic('콰광!', x, y + 3.4, z, FX_BOOM_TEXT);
    // 파괴 모듈이 듣는다: 주변 주차 차량만 터뜨린다(아직 타고 있는 상태라 이 차는 isCarBusy가 참이어서 건드리지 않는다).
    // 건물 피해(bdmg)는 0이다 — 건물은 폭죽·대포로만 무너진다(남의 화면도 그 무기를 든 사람의 bd만 받는다. 평화 상태로 차를 터뜨려
    // 내 화면에서만 건물이 무너지는 일이 없게)
    bus.emit('explosion', { zone: CAMPUS, x, y: y + 0.9, z, radius: 5, dmg: 0, bdmg: 0, by: 'me', w: 'car', tag: null });
    const armed = mayhem.state.wpn > 0;
    leave('boom');
    ui.toast('💥 차가 터졌어요! 30초 뒤에 제자리에 돌아와요');
    if (armed) {
      // 내린 뒤에 다친다(hurt가 기절시켜 'ko'가 와도 이미 내린 뒤다). 넉백은 잔해에서 바깥으로
      let kx = player.pos.x - x;
      let kz = player.pos.z - z;
      const l = Math.hypot(kx, kz);
      if (l > 0.01) {
        kx = (kx / l) * BOOM_KNOCK;
        kz = (kz / l) * BOOM_KNOCK;
      } else {
        kx = Math.cos(car.yaw) * BOOM_KNOCK;
        kz = -Math.sin(car.yaw) * BOOM_KNOCK;
      }
      mayhem.hurt(BOOM_DMG, { by: 'car', kx, kz });
    }
  }

  // ---------- 들이받기 ----------
  /** 점 (px, pz)와 차 몸통 중심선(가운데 ±1.25m) 사이 거리의 제곱 */
  function segD2(px, pz, fx, fz) {
    const dx = px - car.x;
    const dz = pz - car.z;
    let t = dx * fx + dz * fz;
    t = t < -RAM_SEG ? -RAM_SEG : t > RAM_SEG ? RAM_SEG : t;
    const qx = dx - fx * t;
    const qz = dz - fz * t;
    return qx * qx + qz * qz;
  }
  function rammed(x, y, z) {
    sfx.crash();
    gfx.comic('쿵!', x, y + 2.2, z, FX_RAM);
    gfx.shake(0.35);
    car.speed *= 0.8;
    // 들이받은 것도 싸움이다: 전투 잠금(곧바로 평화로 숨지 못하게)과 회복 대기만 갱신한다(공격 횟수는 늘리지 않는다)
    if (typeof mayhem.touchLock === 'function') mayhem.touchLock();
  }
  /** 무장한 채 5m/s 넘게 달리다 무장한 사람·보스·과녁에 닿으면 들이받는다 */
  function ram() {
    const sp = Math.abs(car.speed);
    if (sp <= RAM_SPEED || !(mayhem.state.wpn > 0)) return;
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    const d = Math.min(RAM_MAX, sp * RAM_MUL);
    const t = engine.time;
    if (GAME.pvp) {
      const peers = mayhem.armedPeers();
      for (let k = 0; k < peers.length; k++) {
        const r = peers[k];
        if (r.zone !== CAMPUS || !Number.isFinite(r.x) || !Number.isFinite(r.z) || Math.abs(r.y - car.y) > 2.5) continue;
        const rad = (r.car >= 0 ? RIDER_R : FOOT_R) + CAR.halfWidth;
        if (segD2(r.x, r.z, fx, fz) >= rad * rad) continue;
        const last = ramPeer.get(r.id);
        if (last !== undefined && t - last < RAM_GAP) continue;
        ramPeer.set(r.id, t);
        mayhem.claimHit(r.id, d, 'car', car.x, car.z);
        rammed(r.x, r.y, r.z);
      }
      if (ramPeer.size > 64) for (const [id, at] of ramPeer) if (t - at > 5) ramPeer.delete(id);
    }
    const ts = mayhem.targets;
    for (let k = 0; ts && k < ts.length; k++) {
      const tg = ts[k];
      if (!tg || tg.zone !== CAMPUS || tg.alive === false || typeof tg.hurt !== 'function' || !Number.isFinite(tg.x) || !Number.isFinite(tg.z)) continue;
      const ty = Number.isFinite(tg.y) ? tg.y : car.y;
      const th = tg.height > 0 ? tg.height : 2;
      if (car.y + 1.6 < ty || car.y > ty + th) continue;
      const rad = (tg.radius > 0 ? tg.radius : 1) + CAR.halfWidth;
      if (segD2(tg.x, tg.z, fx, fz) >= rad * rad) continue;
      const last = ramTarget.get(tg);
      if (last !== undefined && t - last < RAM_GAP) continue;
      ramTarget.set(tg, t);
      try {
        tg.hurt(d, 'car', car.x, car.z);
      } catch (e) {
        // 과녁 쪽 오류가 운전까지 멈추지 않게
        console.error('들이받은 과녁이 피해를 처리하다 오류가 났어요', e);
      }
      rammed(tg.x, ty, tg.z);
    }
  }

  // ---------- 운전 ----------
  function crashFx(r) {
    sfx.crash();
    sparkOpt.n = Math.min(24, 6 + Math.round(r.hit));
    sparkOpt.speed = 3 + r.hit * 0.2;
    gfx.sparks(r.hx, car.y + 0.7, r.hz, sparkOpt);
    if (r.hit > 9) gfx.comic('쾅!', r.hx, car.y + 2, r.hz, FX_BANG);
    gfx.shake(Math.min(0.7, r.hit / 35));
  }
  function follow(dt) {
    // 달리는 중이고 한동안 시점을 안 돌렸으면 카메라가 차 뒤로 따라 돈다(yaw 0이면 카메라가 +z 쪽에서 -z를 본다 → 차 뒤는 차 yaw + π)
    if (Math.abs(car.speed) < FOLLOW_MIN || engine.time - lastLook < FOLLOW_IDLE) return;
    let d = car.yaw + Math.PI - cam.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    cam.yaw += d * Math.min(1, dt * FOLLOW_RATE);
  }
  function damageSmoke(dt) {
    if (car.hp >= SMOKE_HP) return;
    if (!warned) {
      warned = true;
      ui.toast('🔥 차가 많이 망가졌어요! 더 부딪히면 터져요');
    }
    smokeT -= dt;
    if (smokeT > 0) return;
    smokeT = low ? 0.8 : 0.4;
    gfx.smoke(car.x + Math.sin(car.yaw) * 1.5, car.y + 1.1, car.z + Math.cos(car.yaw) * 1.5, FX_SMOKE);
  }
  function drive(dt) {
    // 패널이 떠 있거나 멈춰 있어야 할 때·내리려는 중에는 브레이크
    const hold = ui.panel.isOpen() || !!player.frozen;
    const stop = hold || exitReq;
    ctrl.throttle = stop ? 0 : input.moveY;
    ctrl.steer = hold ? 0 : -input.moveX; // 오른쪽 키(+) → 오른쪽으로 돈다(carstep은 +가 왼쪽)
    ctrl.brake = stop || !!input.brake;
    const r = stepCar(car, ctrl, dt, env, res);
    if (r.hit > 0) crashFx(r);
    if (r.landed && r.impact > 6) {
      sfx.crash();
      gfx.smoke(car.x, car.y + 0.2, car.z, FX_DUST);
      gfx.shake(Math.min(0.5, r.impact / 45));
    }
    if (car.hp <= 0) {
      explode();
      return;
    }
    syncMount();
    exitIt.x = car.x;
    exitIt.z = car.z;
    if (exitReq && Math.abs(car.speed) < EXIT_SPEED && !car.air) {
      exitReq = false;
      if (leave('user')) return;
    }
    follow(dt);
    hud.kmh = Math.abs(car.speed) * 3.6;
    hud.hp01 = car.hp / CAR.hpMax;
    ui.setCar(hud);
    ram();
    damageSmoke(dt);
  }
  function honk() {
    sfx.horn();
    if (engine.time - hornAt < 0.5) return;
    hornAt = engine.time;
    gfx.comic('빵빵!', car.x, car.y + 2.6, car.z, FX_HONK);
  }

  // ---------- 남의 차 ----------
  function visitRemote(r, id) {
    const ci = r.car;
    if (!(ci >= 0) || r.zone !== CAMPUS) {
      if (claims.has(r)) claims.delete(r);
      return;
    }
    let cl = claims.get(r);
    if (!cl || cl.car !== ci) {
      // 처음 탔다고 알린 상태의 원본 위치로 한 번만 판정한다(그 뒤 몰고 멀어져도 다시 보지 않는다)
      const home = ci < N ? cars[ci] : null;
      const ok = !!home && !!r.raw && Math.hypot(r.raw.x - home.x, r.raw.z - home.z) < CLAIM_NEAR;
      if (cl) {
        cl.car = ci;
        cl.ok = ok;
      } else claims.set(r, (cl = { car: ci, ok }));
    }
    if (ci < N && (owner[ci] === '' || id < owner[ci])) {
      owner[ci] = id;
      ownerOk[ci] = cl.ok ? 1 : 0;
    }
    if (remotesDrawn >= REMOTE_MAX || slot >= SLOTS || !Number.isFinite(r.x) || !Number.isFinite(r.z)) return;
    remotesDrawn++;
    r.carDrawnAt = engine.time; // 이번 프레임에 차를 그렸다 → remotes.js가 아바타를 숨긴다
    const yaw = Number.isFinite(r.yaw) ? r.yaw : 0;
    const gy = groundTilt(r.x, r.z, yaw, _n);
    let y = gy;
    if (Number.isFinite(r.y) && Math.abs(r.y - gy) > 0.6) {
      // 떠 있다(턱에서 떨어지는 중): 수평으로 그 높이에
      _n.copy(UP);
      y = r.y;
    }
    compose(_m, r.x, y, r.z, yaw, _n);
    put(_m, ci < N && Number.isFinite(cars[ci].color) ? cars[ci].color : BODY_DEFAULT);
  }
  function remoteCars() {
    remotesDrawn = 0;
    if (remotes && remotes.map) remotes.map.forEach(visitRemote);
    for (let i = 0; i < N; i++) {
      hideNext[i] = owner[i] !== '' && ownerOk[i] === 1 ? 1 : 0;
      owner[i] = '';
      if (hideNext[i] !== hide[i]) setCarVisible(i, !hideNext[i], 'remote');
    }
    const tmp = hide;
    hide = hideNext;
    hideNext = tmp;
    // 남이 제자리에서 몰고 간 차를 내가 버려 둔 자리에도 두면 같은 차가 둘이 된다 → 버려 둔 쪽을 치운다(남이 타고 있어 주차 자리에서도 숨는다)
    for (let k = 0; k < AB_MAX; k++) if (abs[k].i >= 0 && hide[abs[k].i]) sendHome(abs[k]);
  }

  // ---------- 상호작용 안내(game.update가 4프레임마다 가장 가까운 것을 고른다) ----------
  // 서로 다른 객체 두 개, 글자는 고정. 안 쓸 때는 zone을 null로 둔다. 내리기는 매 프레임 차 자리로 옮겨 탑승 중에는 늘 가장 가깝다.
  const boardIt = { zone: null, x: 0, z: 0, r: BOARD_R, label: '🚗 차 타기', use: () => board(nearestBoardable()) };
  const exitIt = { zone: null, x: 0, z: 0, r: 2.5, label: '🚗 차에서 내리기', use: () => requestExit() };
  if (game && Array.isArray(game.interactables)) game.interactables.push(boardIt, exitIt);
  function prompts() {
    if (cur >= 0) {
      boardIt.zone = null;
      exitIt.zone = CAMPUS;
      exitIt.x = car.x;
      exitIt.z = car.z;
      return;
    }
    exitIt.zone = null;
    const i = nearestBoardable();
    if (i < 0) {
      boardIt.zone = null;
      return;
    }
    const a = abOf(i);
    boardIt.zone = CAMPUS;
    boardIt.x = a ? a.x : cars[i].x;
    boardIt.z = a ? a.z : cars[i].z;
  }

  // ---------- 제자리로 돌려보내기 ----------
  function timers() {
    const t = engine.time;
    const inCampus = player.zone === CAMPUS;
    for (let k = 0; k < AB_MAX; k++) {
      const a = abs[k];
      if (a.i < 0) continue;
      const dx = player.pos.x - a.x;
      const dz = player.pos.z - a.z;
      const far = inCampus && dx * dx + dz * dz > ABANDON_FAR * ABANDON_FAR;
      if ((t - a.t >= ABANDON_SEC || far) && homeClear(a.i)) sendHome(a);
    }
    for (let i = 0; i < N; i++) {
      if (boomAt[i] > 0 && t >= boomAt[i] && homeClear(i)) {
        boomAt[i] = 0;
        setCarVisible(i, true, 'ride');
      }
    }
  }

  function update(dt) {
    if (!(dt > 0)) dt = 0;
    slot = 0;
    if (input.lookDX || input.lookDY) lastLook = engine.time;
    // 탄 채로 다른 구역에 옮겨졌으면(있어서는 안 되지만) 차는 그 자리에 두고 내린 것으로 한다
    if (cur >= 0 && player.zone !== CAMPUS) leave('zone');
    if (cur >= 0) drive(dt);
    timers();
    if (cur >= 0) {
      // 내 차: 땅에 붙어 있으면 네 바퀴 자리의 지면을 따라 기울인다(부드럽게)
      const gy = groundTilt(car.x, car.z, car.yaw, _n);
      let y = car.y;
      if (!car.air && Math.abs(gy - car.y) < 0.6) {
        myNrm.lerp(_n, Math.min(1, dt * 12)).normalize();
        y = gy;
      } else myNrm.lerp(UP, Math.min(1, dt * 3)).normalize();
      compose(_m, car.x, y, car.z, car.yaw, myNrm);
      put(_m, curColor);
    }
    for (let k = 0; k < AB_MAX; k++) if (abs[k].i >= 0) put(abs[k].m, abs[k].color);
    remoteCars();
    flush();
    prompts();
  }

  /** 누가 타고 있거나(나·남) 버려 두었거나 터져서 제자리에 없는 차인가(파괴 모듈이 묻는다) */
  function isCarBusy(i) {
    if (!Number.isInteger(i) || i < 0 || i >= N) return false;
    return i === cur || boomAt[i] > 0 || hide[i] === 1 || !!abOf(i);
  }

  // 경적: 'fire' 이벤트(키보드 F의 첫 눌림, 터치 공격 버튼)
  input.on('fire', () => {
    if (cur < 0 || ui.panel.isOpen()) return;
    honk();
  });
  // 내가 기절했다: 바로 내린다(깨어날 때 차로 되돌아가지 않게).
  // 차가 터지는 중(내구도 0 — 폭발 알림을 들은 쪽이 나를 쓰러뜨렸다)이면 그 차는 버려 두지 않고 터진 차로 처리한다
  bus.on('ko', (e) => {
    if (cur < 0) return;
    if (e && typeof e.id === 'string' && e.id && net && e.id !== net.id) return;
    leave(car.hp <= 0 ? 'boom' : 'ko');
  });

  return {
    update,
    isCarBusy,
    driving: () => cur >= 0,
    /** 시험용: 그 차에 탄다(타기 안내와 같은 조건) */
    board: (i) => board(i),
    /** 시험용: E와 같다(서 있으면 바로, 달리는 중이면 세운 뒤에 내린다) */
    exit: () => requestExit(),
    /** 점검용: 지금 탄 차 번호(-1이면 걷는 중)와 그 차의 상태(읽기만 할 것) */
    current: () => cur,
    car,
    stats: () => ({ drawn: shown, abandoned: abs.reduce((n, a) => n + (a.i >= 0 ? 1 : 0), 0), remoteHidden: hide.reduce((n, v) => n + v, 0) }),
  };
}
