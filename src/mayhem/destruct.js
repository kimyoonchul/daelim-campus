// 건물·주차 차량 파괴와 연습용 과녁(설계서 5.2).
// ctx = { engine, world, player, cam, input, ui, net, remotes, store, profile, game, mayhem, bus, gfx, rules, sfx, GAME }
//
// 건물 — 캠퍼스 건물마다 체력(면적에 비례해 120~420)이 있다. 내 폭발(bus 'explosion': by 'me', bdmg > 0, 캠퍼스)이
//   평면 안에서 터지거나 벽에서 반경 안이면 거리만큼 줄여 깎는다(맞을 때마다 잔해 조금 + 건물이 흔들림).
//   0이 되면 0.5초 흔들리며 주저앉고(pivot.scale.y 1 → 0.05) → 숨긴 자리에 잔해 더미 → 45초 뒤 3초 동안 다시 솟아오르고
//   → 그 뒤 30초는 다시 무너지지 않는다. 체력·타이머는 접속자마다 따로 돈다.
//   규칙 3(파괴는 연출): 이동 충돌·문·안내판·스탬프 원·실내는 그대로다. 무너진 동안 충돌체 top만 잔해 높이(low + 3)로 낮춰
//   카메라가 지나가게 하고, 다시 지을 때 원래 값으로 되돌린다.
//   내가 무너뜨린 것만 bd로 알리고, 그 건물이 무너져 있는 동안 12초마다 ws로 남은 시간을 알린다(늦게 온 사람용).
// 주차 차량 — 내 폭발 반경 안의 보이는 차를 터뜨리고(튀어 올라 뒤집힌다) mayhem.claimCar로 알린다. 40초 뒤 제자리에 돌아온다.
//   숨길 때는 setCarVisible(i, …, 'boom') — 차량 모듈의 'ride' 숨김과 서로 풀지 않는다.
// 연습용 과녁 — GAME.dummies의 앵커(운동장) 둘레, 보스 반대쪽에 허수아비를 세워 mayhem.addTarget으로 등록한다. 통신 없음.
//   보스 둥지와는 그 보스가 깨어나는 거리(wake) + 12m(과녁 앞에 서는 여유) 밖에 세운다 — 과녁 앞에서 무기를 들어도 보스가 깨지 않게.
//   앵커 둘레에 그만한 자리가 없으면 여유를 6m, 0m로 줄이고, 그래도 없으면 예전처럼 활동 반경 밖(못 하면 18m 밖)에 세운다.
//   맞으면 흔들리고, 피해가 쌓이면 넘어졌다가 3초 뒤 일어난다. 연속 명중 수를 머리 위 글자로 보여 준다(20 넘으면 '20+' — 글자 텍스처 가짓수를 묶는다).
// 받은 bd·ws·carClaim은 누구나 꾸며 보낼 수 있다: 형식·범위를 보고, 빈도는 보낸 사람별이 아니라 전체 기준으로 막는다
//   (제한 기록은 이 모듈이 갖고 누가 나가도 지우지 않는다). 남의 알림으로 바꾼 상태는 다시 알리지 않는다.
// 시간: 붕괴·재건·복구·과녁 타이머는 engine.time(초), 받은 것의 빈도 제한·ws 간격·ws 받는 창은 performance.now()(ms).
//
// 돌려주는 것: update(dt), isDown(key), 시험·점검용 collapse(key)·info(key)·isCarWrecked(i)·dummies·resetDummies()·dummyMargin().
// bus로 내는 것: 'buildingDown' { key, by }(by는 내가 무너뜨렸으면 'me', 남이면 그 사람 id), 'buildingUp' { key }.
import * as THREE from 'three';
import { Geo, inPoly, distPolyEdge, insetPoly, bboxOf } from '../world/geom.js';
import { makeRng } from '../core/rng.js';

const UP = 0;
const FALLING = 1;
const DOWN = 2;
const RISING = 3;
const PHASE_NAMES = ['up', 'falling', 'down', 'rising'];
const HP_LO = 120; // 가장 작은 건물의 체력
const HP_HI = 420; // 가장 큰 건물의 체력
const FALL_SEC = 0.5; // 흔들리며 주저앉는 시간
const DOWN_SEC = 45; // 무너지기 시작해서 다시 짓기 시작할 때까지
const RISE_SEC = 3; // 다시 솟아오르는 시간
const SAFE_SEC = 30; // 다시 지은 뒤 무너지지 않는 시간
const FLAT = 0.05; // 주저앉은 건물의 pivot.scale.y
const RUBBLE_UP = 3; // 무너진 동안 충돌체 top = low + 이만큼(잔해 높이)
const WOB_SEC = 0.45; // 맞았을 때 흔들리는 시간
const DOWN_CAP = 3; // 남의 알림(bd·ws)으로는 동시에 이만큼까지만 무너져 있게 한다
const BD_GAP_MS = 5000; // 남의 bd는 전체 5초에 1건
const WS_EVERY_MS = 12000; // 내가 무너뜨린 건물이 남아 있으면 이 간격으로 ws
const WS_OPEN_MS = 20000; // ws는 접속 뒤 이 시간 동안만 받는다
const WS_KEYS = 32; // ws 하나에서 살펴보는 키 수 상한
const CAR_BACK_SEC = 40; // 터진 차가 돌아오기까지
const CAR_CLAIM_GAP_MS = 2000; // 남의 차량 주장은 전체 2초에 1건
const CAR_BOOMS = 2; // 폭발 하나로 터진 차들 중 작은 폭발까지 그리는 수
const FX_DIST = 220; // 이보다 먼 차의 연출은 그리지 않는다(m)
const FLIP_G = 22; // 날아가는 차체의 중력
const FLIP_REST = 3.2; // 뒤집힌 차가 바닥에 있는 시간(마지막 0.4초에 줄어들며 사라진다)
const DUMMY_HP = 60; // 과녁이 넘어지기까지 받는 피해(대포 한 방이면 넘어진다)
const DUMMY_DOWN_SEC = 3; // 넘어져 있는 시간
const STREAK_GAP = 5; // 이만큼(초) 안 맞으면 연속 명중 수가 처음부터
const STREAK_MAX = 20; // 연속 명중 글자는 이 수까지만 숫자로 보이고 그 뒤는 '20+연속!'(수마다 새 글자 텍스처를 만들지 않게)
const STREAK_TEXT = ['명중!', '명중!']; // 연속 수 → 글자(미리 만들어 둔다)
for (let n = 2; n <= STREAK_MAX; n++) STREAK_TEXT.push(n + '연속!');
const STREAK_MORE = STREAK_MAX + '+연속!';
const DUMMY_GAP = 6.5; // 과녁끼리 띄우는 거리(m)
const BOSS_CLEAR = 18; // 보스(과녁 id 'boss:…')에서 이만큼 떨어뜨린다(m)
const BOSS_WAIT = 1; // 보스가 아직 등록되지 않았으면 첫 갱신 뒤 이만큼(초) 기다렸다가 세운다
// 보스 둥지와는 깨어나는 거리(wake) + 이만큼(과녁 앞에 사람이 서는 여유) 띄운다. 앞의 것부터 해 보고 안 되면 줄인다
const STAND_MARGINS = [12, 6, 0];
const CLEAR_ONLY = -1; // (마지막 수단) 깨어나는 거리는 보지 않고 활동 반경 + 1m만
const CLEAR_NEAR = -2; // (마지막 수단) 보스와 18m만
const DUMMY_FAR = 60; // 앵커에서 이 거리(m)까지 자리를 찾는다
const DUMMY_CLUSTER = 24; // 첫 과녁에서 이 거리(m) 안에 나머지를 모아 세운다
const TAU = Math.PI * 2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sq = (v) => v * v;
/** 평면 다각형까지의 수평 거리(안이면 0) */
const polyDist = (x, z, poly) => (inPoly(x, z, poly) ? 0 : distPolyEdge(x, z, poly));
/** 받침이 있으면 a, 없으면 b(을/를). 한글로 끝나지 않으면 b */
function josa(word, a, b) {
  const s = String(word);
  const c = s.codePointAt(s.length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? a : b;
  return b;
}

/** 색을 입힌 도형 여러 개를 지오메트리 하나로 합친다(정점 색) — 과녁 하나를 한 번에 그리려고 */
function fuse(parts) {
  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];
  const c = new THREE.Color();
  for (const [g, hex] of parts) {
    const base = pos.length / 3;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    c.set(hex);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

/** 연습용 과녁: 나무 받침·기둥 + 짚 몸통 + 밀짚모자 허수아비, 가슴과 등에 빨강·하양 과녁 판(앞이 +z). 발밑이 원점 */
function dummyGeometry(low) {
  const seg = low ? 8 : 12;
  const cyl = (rt, rb, h, x, y, z, rx = 0, rz = 0, n = seg) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, n);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    return g;
  };
  const ball = (r, x, y, z, n = seg) => {
    const g = new THREE.SphereGeometry(r, n, Math.max(5, n - 4));
    g.translate(x, y, z);
    return g;
  };
  const WOOD = 0x7a4e2d;
  const STRAW = 0xe3bf62;
  const ROPE = 0x8a6436;
  const HAT = 0xc99a3e;
  const RED = 0xe74c3c;
  const parts = [
    [cyl(0.34, 0.4, 0.12, 0, 0.06, 0), 0x5b3a22], // 받침
    [cyl(0.07, 0.09, 1.0, 0, 0.6, 0, 0, 0, 8), WOOD], // 기둥
    [cyl(0.3, 0.34, 0.95, 0, 1.42, 0), STRAW], // 짚 몸통
    [cyl(0.345, 0.35, 0.07, 0, 1.12, 0), ROPE], // 새끼줄 두 줄
    [cyl(0.315, 0.32, 0.07, 0, 1.74, 0), ROPE],
    [cyl(0.045, 0.045, 1.4, 0, 1.62, 0, 0, Math.PI / 2, 6), WOOD], // 팔 막대
    [ball(0.1, -0.72, 1.62, 0, 8), STRAW], // 팔 끝 짚 뭉치
    [ball(0.1, 0.72, 1.62, 0, 8), STRAW],
    [ball(0.25, 0, 2.13, 0), 0xf0d07a], // 머리
    [ball(0.035, -0.085, 2.17, 0.226, 6), 0x2b2420], // 단추 눈
    [ball(0.035, 0.085, 2.17, 0.226, 6), 0x2b2420],
    [cyl(0.38, 0.38, 0.03, 0, 2.3, 0), HAT], // 밀짚모자
    [cyl(0.06, 0.2, 0.2, 0, 2.41, 0), HAT],
  ];
  for (const s of [1, -1]) {
    // 과녁 판: 작은 판일수록 두꺼워서 큰 판 위로 고리처럼 튀어나와 보인다
    parts.push([cyl(0.27, 0.27, 0.05, 0, 1.42, 0.33 * s, Math.PI / 2), RED]);
    parts.push([cyl(0.19, 0.19, 0.07, 0, 1.42, 0.33 * s, Math.PI / 2), 0xfafafa]);
    parts.push([cyl(0.11, 0.11, 0.09, 0, 1.42, 0.33 * s, Math.PI / 2), RED]);
    parts.push([cyl(0.045, 0.045, 0.11, 0, 1.42, 0.33 * s, Math.PI / 2, 0, 8), 0xffd23f]);
  }
  return fuse(parts);
}

export function createDestruct(ctx) {
  const { engine, world, player, net, remotes, store, ui, bus, gfx, sfx, rules, mayhem, GAME } = ctx;
  const campus = world.campus;
  const CID = campus.id;
  const collider = campus.collider;
  const low = !!(engine.quality && engine.quality.low);
  const byKey = (world.buildings && world.buildings.byKey) || {};
  const props = world.props || null;
  const cars = props && Array.isArray(props.cars) ? props.cars : [];
  // 캠퍼스 전용 기능은 늘 캠퍼스 지면을 쓴다(내가 실내에 있어도 잔해가 캠퍼스 바닥에서 튀게)
  const ground = campus.heightAt;
  const here = () => player.zone === CID;
  const distXZ = (x, z) => Math.hypot(x - player.pos.x, z - player.pos.z);
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _s = new THREE.Vector3();
  const _c = new THREE.Color();
  const _axis = new THREE.Vector3();

  // ---------- 건물 기록 ----------
  const list = []; // 건물마다 상태(아래 s)
  const blds = new Map(); // key → s
  let aMin = Infinity;
  let aMax = -Infinity;
  for (const key of Object.keys(byKey)) {
    const a = byKey[key] && byKey[key].area;
    if (Number.isFinite(a) && a > 0) {
      aMin = Math.min(aMin, a);
      aMax = Math.max(aMax, a);
    }
  }
  const hpFor = (a) => (Number.isFinite(a) && aMax > aMin ? Math.round(HP_LO + ((HP_HI - HP_LO) * (clamp(a, aMin, aMax) - aMin)) / (aMax - aMin)) : Math.round((HP_LO + HP_HI) / 2));

  // 잔해 더미: 건물마다 낮은 상자 몇 개(건물 색). 자리는 처음에 정해 두고, 모든 건물의 상자를 인스턴스 메시 하나로 그린다.
  const rng = makeRng(5150);
  const pileColors = []; // [색, 밝기 배율, …]
  let pileTotal = 0;
  for (const key of Object.keys(byKey)) {
    const b = byKey[key];
    if (!b || !b.pivot || !Array.isArray(b.poly) || b.poly.length < 3 || !Array.isArray(b.c)) continue;
    const area = Number.isFinite(b.area) && b.area > 0 ? b.area : 400;
    const side = Math.sqrt(area);
    const lowY = Number.isFinite(b.low) ? b.low : ground(b.c[0], b.c[1]);
    const topY = Number.isFinite(b.top) ? b.top : lowY + 20;
    const baseY = Number.isFinite(b.base) ? b.base : lowY;
    let n = clamp(Math.round(area / 260), 3, 8);
    if (low) n = Math.ceil(n / 2);
    const pile = new Float32Array(n * 16);
    const inner = insetPoly(b.poly, Math.min(2.5, side * 0.12));
    const bb = bboxOf(b.poly);
    const colors = Array.isArray(b.colors) && b.colors.length ? b.colors : [0x9c968c];
    for (let k = 0; k < n; k++) {
      let x = b.c[0];
      let z = b.c[1];
      for (let tries = 0; tries < 80; tries++) {
        const tx = rng.range(bb[0], bb[2]);
        const tz = rng.range(bb[1], bb[3]);
        if (!inPoly(tx, tz, b.poly) || (tries < 60 && !inPoly(tx, tz, inner))) continue;
        x = tx;
        z = tz;
        break;
      }
      const room = distPolyEdge(x, z, b.poly) + 1.2; // 평면 밖으로 크게 넘치지 않게
      const w = Math.min(clamp(side * rng.range(0.2, 0.36), 1.2, 15), room * 2);
      const d = Math.min(clamp(side * rng.range(0.14, 0.28), 1.0, 11), room * 2);
      const h = Math.min(rng.range(0.9, 2.3), Math.max(0.6, side * 0.3));
      // 비탈에 선 건물(평면 안의 지면 높이가 제각각)도 있어서 상자마다 그 자리 지면에 얹는다
      _q.setFromEuler(_e.set(rng.range(-0.12, 0.12), rng() * Math.PI, rng.range(-0.12, 0.12)));
      _m.compose(_p.set(x, ground(x, z) + h * 0.3, z), _q, _s.set(w, h, d));
      _m.toArray(pile, k * 16);
      pileColors.push(k % 3 === 2 ? 0x9c968c : colors[k % colors.length], rng.range(0.68, 0.92));
    }
    const s = {
      key,
      b,
      solid: b.solid && typeof b.solid === 'object' ? b.solid : null,
      side,
      maxHp: hpFor(b.area),
      hp: 0,
      phase: UP,
      t0: 0,
      rebuildAt: 0,
      safeUntil: -Infinity, // 이 시각(engine.time)까지는 무너지지 않는다
      by: '', // 무너뜨린 사람: 'me' | 상대 id | ''
      wobT: 0,
      wobAmp: 0,
      sturdyAt: -Infinity,
      sfxN: 0,
      origTop: 0,
      downTop: lowY + RUBBLE_UP,
      yLo: lowY - 1, // 폭발이 건물에 닿는 높이 범위
      yHi: topY + 4.5,
      midY: baseY + Math.min((topY - lowY) * 0.55, 18),
      pile,
      pileStart: pileTotal,
      pileN: n,
      pileOn: false,
    };
    s.hp = s.maxHp;
    s.origTop = s.solid ? s.solid.top : 0;
    pileTotal += n;
    list.push(s);
    blds.set(key, s);
  }

  const rubbleN = Math.max(1, pileTotal);
  const rubble = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), rubbleN);
  rubble.name = 'rubble';
  const rubArr = rubble.instanceMatrix.array;
  rubArr.fill(0);
  for (let i = 0; i < rubbleN; i++) {
    rubArr[i * 16 + 15] = 1;
    const ci = i * 2;
    if (ci < pileColors.length) _c.setHex(pileColors[ci]).multiplyScalar(pileColors[ci + 1]);
    else _c.setHex(0x9c968c);
    rubble.setColorAt(i, _c);
  }
  rubble.instanceMatrix.needsUpdate = true;
  if (rubble.instanceColor) rubble.instanceColor.needsUpdate = true;
  rubble.frustumCulled = false;
  rubble.castShadow = !low;
  rubble.receiveShadow = true;
  rubble.visible = false;
  campus.group.add(rubble);
  let pilesShown = 0;

  function setPile(s, on) {
    if (s.pileOn === on) return;
    s.pileOn = on;
    const o = s.pileStart * 16;
    if (on) rubArr.set(s.pile, o);
    else {
      rubArr.fill(0, o, o + s.pileN * 16);
      for (let k = 0; k < s.pileN; k++) rubArr[o + k * 16 + 15] = 1;
    }
    rubble.instanceMatrix.needsUpdate = true;
    pilesShown += on ? 1 : -1;
    rubble.visible = pilesShown > 0;
  }

  // ---------- 건물: 흔들림·붕괴·재건 ----------
  let bldBusy = false; // 움직이는(흔들림·붕괴·무너져 있음·재건) 건물이 있다

  function wobble(s, amp) {
    s.wobAmp = Math.max(amp, s.wobT > 0 ? s.wobAmp : 0);
    s.wobT = WOB_SEC;
    bldBusy = true;
  }

  /** 무너지기 시작한다(내 것이면 bd·배너·기록). by는 'me' | 상대 id, name은 알림에 쓸 상대 이름 */
  function bringDown(s, by, name) {
    const t = engine.time;
    const b = s.b;
    s.phase = FALLING;
    s.t0 = t;
    s.rebuildAt = t + DOWN_SEC;
    s.by = by;
    s.hp = 0;
    s.wobT = 0;
    s.wobAmp = 0;
    if (s.solid) s.solid.top = s.downTop; // 카메라가 지나가게
    bldBusy = true;
    const mine = by === 'me';
    const what = b.name + josa(b.name, '을', '를');
    if (here()) {
      const dist = polyDist(player.pos.x, player.pos.z, b.poly);
      gfx.comic('와르르!', b.c[0], s.midY, b.c[1], { color: '#ffd23f', size: 3.2 + Math.min(dist, 100) * 0.03, dur: 1.6 });
      gfx.smoke(b.c[0], ground(b.c[0], b.c[1]) + 1, b.c[1], { n: 5, size: clamp(s.side * 0.22, 3, 9), dur: 2, color: 0xd8d0c2 });
      if (!mine) sfx.at('crash', dist, true);
    }
    if (mine) {
      sfx.crash(true);
      ui.banner('와르르!', `${what} 무너뜨렸어요`, false, 2600);
      ui.feed(`💥 ${what} 무너뜨렸어요! ${DOWN_SEC}초 뒤에 다시 지어져요`);
      store.set('mayhemDown', (Number.isFinite(store.data.mayhemDown) ? store.data.mayhemDown : 0) + 1);
      net.sendEvent('bd', { b: s.key });
      if (!(wsNextAt > 0)) wsNextAt = performance.now() + WS_EVERY_MS;
    } else if (name) ui.feed(`💥 ${name} 님이 ${what} 무너뜨렸어요!`, by);
    bus.emit('buildingDown', { key: s.key, by });
  }

  /** 주저앉기가 끝났다(또는 늦게 와서 바로 무너진 모습으로): 숨기고 잔해 더미. fx면 큰 잔해·먼지 */
  function enterDown(s, fx) {
    const b = s.b;
    const p = b.pivot;
    s.phase = DOWN;
    p.visible = false;
    p.scale.y = FLAT;
    p.rotation.x = 0;
    p.rotation.z = 0;
    setPile(s, true);
    if (s.solid) s.solid.top = s.downTop;
    bldBusy = true;
    if (!fx || !here()) return;
    const cx = b.c[0];
    const cz = b.c[1];
    const gy = ground(cx, cz);
    gfx.debris(cx, gy + 2, cz, { count: 90, colors: b.colors, power: 13, spread: clamp(s.side * 0.35, 3, 16), size: 1.1, ground });
    for (let k = 0; k < 2 && k < s.pileN; k++) {
      const o = k * 16;
      gfx.debris(s.pile[o + 12], s.pile[o + 13] + 1, s.pile[o + 14], { count: 28, colors: b.colors, power: 10, spread: 2.5, size: 0.8, ground });
    }
    gfx.smoke(cx, gy + 1, cz, { n: 10, size: clamp(s.side * 0.3, 4, 12), dur: 3.2, color: 0xcbc3b5 });
    gfx.shake(0.9 * Math.max(0, 1 - polyDist(player.pos.x, player.pos.z, b.poly) / 140));
  }

  /** 다시 짓기 시작: 납작한 건물을 보이고 잔해를 치운다(3초 동안 솟아오른다) */
  function enterRising(s) {
    const b = s.b;
    const p = b.pivot;
    s.phase = RISING;
    s.t0 = engine.time;
    s.sfxN = 0;
    p.visible = true;
    p.scale.y = FLAT;
    setPile(s, false);
    if (s.solid) s.solid.top = s.origTop;
    bldBusy = true;
    if (!here()) return;
    const gy = ground(b.c[0], b.c[1]);
    gfx.smoke(b.c[0], gy + 0.5, b.c[1], { n: 6, size: clamp(s.side * 0.25, 3, 9), dur: 1.8, color: 0xf4efe6 });
    gfx.comic('뚝딱뚝딱', b.c[0], gy + 5, b.c[1], { color: '#7fd6ff', size: 3, dur: 2.4 });
  }

  function enterUp(s) {
    const p = s.b.pivot;
    s.phase = UP;
    s.hp = s.maxHp;
    s.by = '';
    s.safeUntil = engine.time + SAFE_SEC;
    s.wobT = 0;
    s.wobAmp = 0;
    p.visible = true;
    p.scale.y = 1;
    p.rotation.x = 0;
    p.rotation.z = 0;
    bus.emit('buildingUp', { key: s.key });
  }

  function stepBuildings(t, dt) {
    let busy = false;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const p = s.b.pivot;
      if (s.phase === UP) {
        if (s.wobT <= 0) continue;
        s.wobT -= dt;
        if (s.wobT <= 0) {
          s.wobT = 0;
          s.wobAmp = 0;
          p.rotation.x = 0;
          p.rotation.z = 0;
          continue;
        }
        const a = s.wobAmp * (s.wobT / WOB_SEC);
        p.rotation.x = Math.sin(t * 47) * a;
        p.rotation.z = Math.cos(t * 41) * a;
        busy = true;
      } else if (s.phase === FALLING) {
        const k = (t - s.t0) / FALL_SEC;
        if (k >= 1) enterDown(s, true);
        else {
          // 갈수록 빨리 주저앉으며 흔들린다
          p.scale.y = 1 - (1 - FLAT) * k * k;
          const a = 0.028 * (1 - 0.5 * k);
          p.rotation.x = Math.sin(t * 43) * a;
          p.rotation.z = Math.cos(t * 37) * a;
        }
        busy = true;
      } else if (s.phase === DOWN) {
        if (t >= s.rebuildAt) enterRising(s);
        busy = true;
      } else {
        const k = (t - s.t0) / RISE_SEC;
        if (k >= 1) {
          enterUp(s);
          continue;
        }
        // 살짝 넘쳤다가 제 키로(만화풍)
        const u = k - 1;
        p.scale.y = Math.min(1.04, FLAT + (1 - FLAT) * (1 + 2.2 * u * u * u + 1.2 * u * u));
        const a = 0.006 * (1 - k);
        p.rotation.x = Math.sin(t * 29) * a;
        p.rotation.z = Math.cos(t * 23) * a;
        // 뚝딱 소리 세 번
        if (s.sfxN < 3 && k >= s.sfxN / 3) {
          s.sfxN++;
          if (here()) {
            const dd = polyDist(player.pos.x, player.pos.z, s.b.poly);
            if (dd < 60) sfx.at('build', dd);
          }
        }
        busy = true;
      }
    }
    bldBusy = busy;
  }

  /** 내 폭발이 건물에 준 피해 d(거리 감쇠를 이미 적용한 값). (x, y, z)는 맞은 자리 */
  function hitBuilding(s, d, x, y, z) {
    if (s.phase !== UP || !(d >= 1)) return;
    const t = engine.time;
    if (t < s.safeUntil) {
      // 다시 지은 지 얼마 안 됐다: 흔들리기만 한다
      wobble(s, 0.004);
      if (t - s.sturdyAt >= 2 && here()) {
        s.sturdyAt = t;
        gfx.comic('튼튼!', x, y + 1.5, z, { color: '#9fe3ff', size: 1.6, dur: 0.9 });
      }
      return;
    }
    s.hp -= d;
    if (s.hp <= 0) {
      bringDown(s, 'me', '');
      return;
    }
    const k = 1 - s.hp / s.maxHp; // 많이 부서졌을수록 크게 흔들리고 연기가 난다
    wobble(s, 0.004 + 0.012 * k);
    if (!here()) return;
    gfx.debris(x, y, z, { count: 6 + Math.min(14, Math.round(d / 5)), colors: s.b.colors, power: 7, spread: 1.2, size: 0.45, ground });
    if (k > 0.6) gfx.smoke(x, y, z, { n: 2, size: 2.4, dur: 1.4, color: 0x8d8780 });
  }

  // ---------- 주차 차량 ----------
  const carBackAt = new Float64Array(cars.length); // 터진 차가 돌아올 시각(engine.time). 0이면 멀쩡하다
  let carsDown = 0;
  let lastCarClaimAt = -Infinity;
  const setCar = (i, on) => {
    if (props && typeof props.setCarVisible === 'function') props.setCarVisible(i, on, 'boom');
  };
  // 누가 타고 있는 차인지는 쓸 때마다 묻는다(차량 모듈이 이 모듈보다 나중에 만들어진다)
  const carBusy = (i) => {
    const v = mayhem.vehicles;
    return !!(v && typeof v.isCarBusy === 'function' && v.isCarBusy(i));
  };

  // 튀어 올라 뒤집히는 차체(재사용 풀). 원점이 차체 한가운데라 그 자리에서 돈다
  const FLIP_N = low ? 2 : 4;
  const flipBodyGeo = new Geo().box(0, -0.08, 0, 1.8, 0.62, 4.3).box(0, -0.45, 1.45, 1.85, 0.3, 0.5).box(0, -0.45, -1.45, 1.85, 0.3, 0.5).build();
  const flipCabGeo = new Geo().box(0, 0.5, -0.15, 1.6, 0.58, 2.3).build();
  const flipCabMat = new THREE.MeshLambertMaterial({ color: 0x1f2a36 });
  const flips = [];
  for (let i = 0; i < FLIP_N; i++) {
    const g = new THREE.Group();
    g.name = 'car-flip';
    g.rotation.order = 'YXZ'; // 방향(yaw) → 앞뒤 끄덕임 → 긴 축으로 구르기
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const body = new THREE.Mesh(flipBodyGeo, mat);
    const cab = new THREE.Mesh(flipCabGeo, flipCabMat);
    body.castShadow = cab.castShadow = !low;
    g.add(body, cab);
    g.visible = false;
    campus.group.add(g);
    flips.push({ g, mat, phase: 0, t: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, yawV: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0 });
  }
  let flipsAlive = 0;

  /** 차 c가 (bx, bz)에서 난 폭발에 튀어 오른다 */
  function launchFlip(c, bx, bz) {
    let f = null;
    for (let i = 0; i < flips.length; i++) {
      const o = flips[i];
      if (!o.phase) {
        f = o;
        break;
      }
      // 다 쓰는 중이면 가장 오래 누워 있던 것을 다시 쓴다
      if (o.phase === 2 && (!f || o.t > f.t)) f = o;
    }
    if (!f) return;
    if (!f.phase) flipsAlive++;
    let dx = c.x - bx;
    let dz = c.z - bz;
    const l = Math.hypot(dx, dz);
    if (l > 0.3) {
      dx /= l;
      dz /= l;
    } else {
      const a = Math.random() * TAU;
      dx = Math.cos(a);
      dz = Math.sin(a);
    }
    const sp = 2.5 + Math.random() * 2;
    f.phase = 1;
    f.t = 0;
    f.x = c.x;
    f.y = c.y + 0.72;
    f.z = c.z;
    f.vx = dx * sp;
    f.vz = dz * sp;
    f.vy = 8.5 + Math.random() * 2;
    // 떨어질 때쯤 반 바퀴(가끔 한 바퀴 반) 굴러 뒤집혀 있게
    const air = (2 * f.vy) / FLIP_G;
    f.roll = 0;
    f.rollV = (Math.random() < 0.5 ? -1 : 1) * (Math.PI / air) * (Math.random() < 0.3 ? 3 : 1);
    f.pitch = 0;
    f.pitchV = (Math.random() - 0.5) * 1.6;
    f.yaw = Number.isFinite(c.rot) ? c.rot : 0;
    f.yawV = (Math.random() - 0.5) * 2;
    f.mat.color.setHex(c.color).multiplyScalar(0.6); // 그을린 색
    f.g.scale.set(1, 1, 1);
    f.g.visible = true;
  }

  function stepFlips(dt) {
    let alive = 0;
    for (let i = 0; i < flips.length; i++) {
      const f = flips[i];
      if (!f.phase) continue;
      f.t += dt;
      if (f.phase === 1) {
        f.vy -= FLIP_G * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.z += f.vz * dt;
        f.roll += f.rollV * dt;
        f.pitch += f.pitchV * dt;
        f.yaw += f.yawV * dt;
        const gy = ground(f.x, f.z) + 0.8; // 뒤집혔을 때 지붕이 땅에 닿는 높이
        if (f.vy < 0 && f.y <= gy) {
          f.phase = 2;
          f.t = 0;
          f.y = gy;
          f.pitch = 0;
          f.roll = Math.PI * (2 * Math.round((f.roll / Math.PI - 1) / 2) + 1); // 가장 가까운 "뒤집힌" 각도
          if (here()) {
            gfx.smoke(f.x, gy - 0.6, f.z, { n: 3, size: 2.4, dur: 1.4, color: 0x8f8a84 });
            sfx.at('crash', distXZ(f.x, f.z));
          }
        }
      } else if (f.t >= FLIP_REST) {
        f.phase = 0;
        f.g.visible = false;
        if (here()) gfx.smoke(f.x, f.y - 0.4, f.z, { n: 3, size: 2, dur: 0.9, color: 0xf2f2f2 });
        continue;
      } else if (f.t > FLIP_REST - 0.4) f.g.scale.setScalar(Math.max(0.01, (FLIP_REST - f.t) / 0.4));
      alive++;
      f.g.position.set(f.x, f.y, f.z);
      f.g.rotation.set(f.pitch, f.yaw, f.roll);
    }
    flipsAlive = alive;
  }

  /** 차 i를 터뜨린다. (bx, bz)는 폭발 자리, boom이면 작은 폭발도 그린다 */
  function wreckCar(i, bx, bz, boom) {
    const c = cars[i];
    setCar(i, false);
    carBackAt[i] = engine.time + CAR_BACK_SEC;
    carsDown++;
    if (!here() || distXZ(c.x, c.z) > FX_DIST) return;
    if (boom) gfx.explosion(c.x, c.y + 0.8, c.z, { radius: 2.6 });
    gfx.debris(c.x, c.y + 0.9, c.z, { count: 12, colors: [c.color, 0x1f2a36, 0x3a3a3a], power: 9, spread: 1.4, size: 0.42, ground });
    gfx.smoke(c.x, c.y + 0.6, c.z, { n: 3, size: 2.4, dur: 1.8, color: 0x57524d });
    launchFlip(c, bx, bz);
  }

  /** 내 폭발 반경 안의 보이는(아무도 안 탄) 차를 터뜨리고 알린다 */
  function blastCars(x, y, z, radius) {
    let n = 0;
    const rr = radius + 1.2; // 차체 길이의 절반쯤 넉넉히
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c.visible || carBackAt[i] > 0) continue;
      const dx = c.x - x;
      const dz = c.z - z;
      if (dx * dx + dz * dz > rr * rr || Math.abs(c.y + 0.7 - y) > radius + 2) continue;
      if (mayhem.state.car === i || carBusy(i)) continue;
      wreckCar(i, x, z, n < CAR_BOOMS);
      n++;
      mayhem.claimCar(i);
    }
    if (n) store.set('mayhemCars', (Number.isFinite(store.data.mayhemCars) ? store.data.mayhemCars : 0) + n);
  }

  function stepCars(t) {
    for (let i = 0; i < cars.length; i++) {
      const at = carBackAt[i];
      if (!(at > 0) || t < at) continue;
      carBackAt[i] = 0;
      carsDown--;
      setCar(i, true);
      const c = cars[i];
      if (c.visible && here() && distXZ(c.x, c.z) < 120) gfx.smoke(c.x, c.y + 0.4, c.z, { n: 3, size: 1.8, dur: 0.9, color: 0xffffff });
    }
    if (carsDown < 0) carsDown = 0;
  }

  // 남이 터뜨렸다는 주장(index.js가 형식만 걸러 넘긴다): 정수·범위, 돌아오기 전에는 다시 받지 않음, 탄 차 제외, 전체 2초에 1건
  bus.on('carClaim', (e) => {
    const i = e ? e.i : undefined;
    if (!Number.isInteger(i) || i < 0 || i >= cars.length || carBackAt[i] > 0) return;
    if (!cars[i].visible || mayhem.state.car === i || carBusy(i)) return;
    const now = performance.now();
    if (now - lastCarClaimAt < CAR_CLAIM_GAP_MS) return;
    lastCarClaimAt = now;
    // 폭발 자리는 모르므로 아무 쪽으로나 튄다(폭발 자체는 무기 모듈이 남의 발사를 재현하며 그린다)
    const a = Math.random() * TAU;
    wreckCar(i, cars[i].x - Math.cos(a), cars[i].z - Math.sin(a), false);
  });

  // ---------- 내 폭발 ----------
  bus.on('explosion', (e) => {
    if (!e || e.by !== 'me') return; // 남의 폭발은 연출 전용
    const zid = typeof e.zone === 'string' ? e.zone : e.zone && typeof e.zone.id === 'string' ? e.zone.id : player.zone;
    if (zid !== CID) return;
    const x = e.x;
    const y = e.y;
    const z = e.z;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const radius = Number.isFinite(e.radius) ? clamp(e.radius, 0, 30) : 0;
    if (Number.isFinite(e.bdmg) && e.bdmg > 0) {
      const bdmg = Math.min(e.bdmg, 1000);
      const tag = typeof e.tag === 'string' ? e.tag : '';
      // 건물마다 한 번씩: 직접 맞은 건물(tag)은 그대로, 나머지는 평면 경계(높이 포함)에서 반경 안이면 거리만큼 줄여서
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        let f = 0;
        if (tag && tag === s.key) f = 1;
        else if (radius > 0) {
          const b = s.b;
          const br = Number.isFinite(b.radius) ? b.radius + radius : Infinity;
          if (sq(x - b.c[0]) + sq(z - b.c[1]) > br * br) continue;
          const dh = polyDist(x, z, b.poly);
          if (dh >= radius) continue;
          const dy = y < s.yLo ? s.yLo - y : y > s.yHi ? y - s.yHi : 0;
          const dd = Math.hypot(dh, dy);
          if (dd >= radius) continue;
          f = 1 - dd / radius;
        }
        if (f > 0) hitBuilding(s, bdmg * f, x, y, z);
      }
    }
    if (radius > 0) blastCars(x, y, z, radius);
  });

  // ---------- 알림 주고받기(bd·ws) ----------
  let wsNextAt = 0; // 다음 ws를 보낼 시각(ms). 0이면 보낼 것이 없다
  const wsD = {};
  const wsMsg = { d: wsD };
  /** 내가 무너뜨려 아직 무너져 있는 건물들의 남은 초를 알린다. 없으면 멈춘다 */
  function sendWs(now) {
    for (const k of Object.keys(wsD)) delete wsD[k];
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.by !== 'me' || (s.phase !== FALLING && s.phase !== DOWN)) continue;
      wsD[s.key] = Math.max(1, Math.round(s.rebuildAt - engine.time));
      n++;
    }
    if (!n) {
      wsNextAt = 0;
      return;
    }
    net.sendEvent('ws', wsMsg);
    wsNextAt = now + WS_EVERY_MS;
  }

  const downCount = () => {
    let n = 0;
    for (let i = 0; i < list.length; i++) if (list[i].phase === FALLING || list[i].phase === DOWN) n++;
    return n;
  };

  // 남이 무너뜨렸다는 알림. 보낸 사람의 마지막 상태가 캠퍼스에서 건물을 부술 수 있는 무기(폭죽·대포 — 방금 바꿨으면 직전 무기)를 들고 그 사거리 안이어야 하고,
  // 건물은 서 있고 다시 지은 지 30초가 지났어야 한다. 받아들이는 것은 전체 5초에 1건, 동시에 무너져 있는 건물 3동까지.
  // 검사를 모두 통과한 것만 5초 몫을 쓴다(엉터리 알림이 진짜 알림의 자리를 빼앗지 못하게).
  let lastBdAt = -Infinity;
  function onBd(id, msg, peer) {
    const key = msg.b;
    if (typeof key !== 'string' || !Object.hasOwn(byKey, key)) return;
    const s = blds.get(key);
    if (!s || s.phase !== UP || engine.time < s.safeUntil) return;
    if (downCount() >= DOWN_CAP) return;
    const r = remotes.get(id);
    if (!r || r.fresh || r.zone !== CID) return;
    const now = performance.now();
    // 지금 든 무기, 또는 방금(전투 잠금 시간 안)까지 들던 무기가 건물을 부술 수 있어야 한다
    // (포탄이 날아가는 동안 무기를 바꾼 사람 — validateHit의 직전 무기 유예와 같다)
    let w = r.wpn;
    let spec = rules.hitSpec(w);
    if (!(spec && spec.bdmg > 0) && now - r.wpnChangedAt <= rules.LIMITS.lockSec * 1000) {
      w = r.prevWpn;
      spec = rules.hitSpec(w);
    }
    if (!spec || !(spec.bdmg > 0)) return;
    if (!(polyDist(r.raw.x, r.raw.z, s.b.poly) <= rules.reach(w, r.car >= 0))) return;
    if (now - lastBdAt < BD_GAP_MS) return;
    lastBdAt = now;
    bringDown(s, id, peer && peer.profile ? peer.profile.n : '누군가');
  }

  // 늦게 온 사람용 알림 { d: { 건물 키: 남은 초 } }: 내 접속 뒤 20초 동안만, 건물마다 한 번, 0~45초로 잘라서, 연출 없이 무너진 모습으로.
  // 진행 중인 타이머(무너짐·재건·보호)는 늘리지도 다시 걸지도 않고, 동시에 3동까지만.
  let wsOpenUntil = performance.now() + WS_OPEN_MS;
  let netWasUp = false;
  const wsSeen = new Set();
  function onWs(id, msg) {
    if (performance.now() > wsOpenUntil) return;
    const d = msg.d;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    const keys = Object.keys(d);
    const n = Math.min(keys.length, WS_KEYS);
    for (let i = 0; i < n; i++) {
      const key = keys[i];
      if (!Object.hasOwn(byKey, key) || wsSeen.has(key)) continue;
      const s = blds.get(key);
      const v = d[key];
      if (!s || !Number.isFinite(v)) continue;
      const left = Math.min(DOWN_SEC, v);
      if (!(left >= 1)) continue;
      if (s.phase !== UP || engine.time < s.safeUntil) continue;
      if (downCount() >= DOWN_CAP) return;
      wsSeen.add(key);
      const t = engine.time;
      s.t0 = t;
      s.rebuildAt = t + left;
      s.by = id;
      s.hp = 0;
      s.wobT = 0;
      s.wobAmp = 0;
      enterDown(s, false);
      bus.emit('buildingDown', { key: s.key, by: id });
    }
  }

  net.on('event', (id, msg, peer) => {
    if (!msg) return;
    if (msg.k === 'bd') onBd(id, msg, peer);
    else if (msg.k === 'ws') onWs(id, msg);
  });
  // 브로커에 처음 붙은 때부터도 20초는 받는다(접속이 늦게 붙어도 ws를 한 번은 들을 수 있게)
  net.on('status', (st) => {
    if (netWasUp || !st || !(st.up > 0)) return;
    netWasUp = true;
    wsOpenUntil = Math.max(wsOpenUntil, performance.now() + WS_OPEN_MS);
  });

  // ---------- 연습용 과녁 ----------
  const dummies = []; // 내부 기록
  const dummyTargets = []; // mayhem.targets에 넣은 과녁 객체(밖에서 보는 용)
  const oStreak = { color: '#ffffff', size: 0.78, dur: 0.8 }; // 연속 명중 글자(gfx는 부르는 동안만 읽는다 — 고쳐 쓴다)
  const oThud = { color: '#ff6b6b', size: 1.3, dur: 0.9 };
  let dummiesPlaced = false;
  let dummyFirstAt = -1;
  let dummyBusy = false;
  let dummyGeo = null;
  let dummyMat = null;
  const avoid = []; // 피할 곳 [x, z, 깨어나는 거리(모르면 0), 활동 반경 + 1(최소 18), …]: 보스 둥지·보스 과녁
  const probe = { x: 0, z: 0 };

  /** avoid의 i번째 곳에서 띄울 거리. margin ≥ 0이면 깨어나는 거리 + margin(활동 반경 + 1보다는 크게), CLEAR_ONLY·CLEAR_NEAR는 마지막 수단 */
  function avoidR(i, margin) {
    const wakeR = avoid[i + 2];
    const clearR = avoid[i + 3];
    if (margin === CLEAR_NEAR) return Math.min(clearR, BOSS_CLEAR);
    if (margin === CLEAR_ONLY) return clearR;
    return wakeR > 0 ? Math.max(clearR, wakeR + margin) : clearR;
  }

  /** 과녁을 세워도 되는 자리인가: 갈 수 있는 평지, 건물·기둥·나무·차·문·안내판·보스·다른 과녁과 떨어진 곳(보스와 띄우는 거리는 margin — avoidR) */
  function spotOk(x, z, a, picked, margin) {
    if (sq(x - a.x) + sq(z - a.z) < 25) return false; // 앵커 바로 옆(불꽃 발사대 등)은 비운다
    for (let i = 0; i < avoid.length; i += 4) {
      const r = avoidR(i, margin);
      if (sq(x - avoid[i]) + sq(z - avoid[i + 1]) < r * r) return false;
    }
    for (let i = 0; i < picked.length; i++) if (sq(x - picked[i].x) + sq(z - picked[i].z) < DUMMY_GAP * DUMMY_GAP) return false;
    if (!campus.playable(x, z) || collider.solidAt(x, z)) return false;
    for (const d of world.doors || []) if (sq(x - d.x) + sq(z - d.z) < 36) return false;
    for (const s of (props && props.signs) || []) if (sq(x - s.x) + sq(z - s.z) < 36) return false;
    if (!(campus.slopeAt(x, z).mag <= 0.2)) return false;
    probe.x = x;
    probe.z = z;
    return !collider.resolve(probe, 1.1);
  }

  function tryPlaceDummies(t) {
    const cfg = GAME.dummies;
    const anchors = props && props.anchors;
    const a = cfg && anchors && typeof cfg.anchor === 'string' && Object.hasOwn(anchors, cfg.anchor) ? anchors[cfg.anchor] : null;
    const count = cfg && Number.isFinite(cfg.count) ? clamp(Math.floor(cfg.count), 0, 8) : 0;
    if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.z) || !count) {
      dummiesPlaced = true;
      return;
    }
    avoid.length = 0;
    // 보스 둥지: 보스 모듈이 기록을 내놓으면 그것(둥지·깨어나는 거리·활동 반경), 그리고 지금 올라와 있는 보스 과녁
    const bm = mayhem.boss;
    let recs = null;
    try {
      recs = bm && typeof bm.bosses === 'function' ? bm.bosses() : null;
    } catch (e) {
      recs = null;
    }
    if (Array.isArray(recs)) {
      for (const b of recs) {
        const h = b && b.home;
        if (!h || b.zid !== CID || !Number.isFinite(h.x) || !Number.isFinite(h.z)) continue;
        const wakeR = Number.isFinite(b.wake) && b.wake > 0 ? Math.min(b.wake, 200) : 0;
        avoid.push(h.x, h.z, wakeR, Math.max(BOSS_CLEAR, Number.isFinite(b.arena) ? Math.min(b.arena + 1, 60) : 0));
      }
    }
    const tg = mayhem.targets;
    for (let i = 0; i < tg.length; i++) {
      const o = tg[i];
      if (o && typeof o.id === 'string' && o.id.startsWith('boss:') && o.zone === CID && Number.isFinite(o.x) && Number.isFinite(o.z)) avoid.push(o.x, o.z, 0, BOSS_CLEAR);
    }
    if (dummyFirstAt < 0) dummyFirstAt = t;
    if (!avoid.length && t - dummyFirstAt < BOSS_WAIT) return; // 보스 모듈이 조금 늦게 알려 줄 수도 있다
    dummiesPlaced = true;
    placeDummies(a, count);
  }

  function placeDummies(a, count) {
    // 보스들을 등지는 방향(가까운 보스일수록 크게 친다). 보스를 모르면 서쪽(-x)
    let ux = 0;
    let uz = 0;
    for (let i = 0; i < avoid.length; i += 4) {
      const dx = a.x - avoid[i];
      const dz = a.z - avoid[i + 1];
      const l2 = dx * dx + dz * dz;
      if (l2 < 1e-6 || l2 > 120 * 120) continue;
      ux += dx / l2;
      uz += dz / l2;
    }
    const ul = Math.hypot(ux, uz);
    if (ul < 1e-12) {
      ux = -1;
      uz = 0;
    } else {
      ux /= ul;
      uz /= ul;
    }
    const base = Math.atan2(uz, ux);
    // 보스가 깨어나는 거리 + 여유 밖을 먼저 찾고, 못 하면 여유를 줄인다. 그래도 안 되면(마지막 수단) 활동 반경 밖, 끝으로 18m 밖
    let picked = [];
    for (let k = 0; k < STAND_MARGINS.length && picked.length < count; k++) picked = arrange(a, count, base, STAND_MARGINS[k]);
    if (picked.length < count) {
      console.warn('연습 과녁을 보스가 깨어나는 거리 밖에 다 세우지 못해 보스 가까이에 세웁니다(GAME.dummies.anchor나 보스 둥지 자료를 바꿔 주세요)');
      picked = arrange(a, count, base, CLEAR_ONLY);
      if (picked.length < count) picked = arrange(a, count, base, CLEAR_NEAR);
    }
    dummyMargin = picked.length >= count ? lastMargin : CLEAR_NEAR;
    for (let k = 0; k < picked.length; k++) makeDummy(k, picked[k].x, picked[k].z, a);
  }

  let lastMargin = 0;
  let dummyMargin = 0; // 시험·점검용: 과녁을 세울 때 쓴 보스와의 여유(STAND_MARGINS의 값 또는 CLEAR_ONLY·CLEAR_NEAR)
  const NO_PICKS = [];
  const d2 = (p, q) => sq(p.x - q.x) + sq(p.z - q.z);

  /** 과녁 자리 count개를 고른다(margin은 avoidR 참고). 다 못 고르면 고른 만큼만 돌려준다 */
  function arrange(a, count, base, margin) {
    lastMargin = margin;
    const picked = [];
    // 1) 그 방향에 앵커를 둘러싼 활 모양으로 나란히(모두 앵커 쪽을 본다)
    for (const r of [11, 13, 9, 15, 17, 19]) {
      const step = 2 * Math.asin(Math.min(1, (DUMMY_GAP + 1) / 2 / r));
      picked.length = 0;
      for (let k = 0; k < count; k++) {
        const ang = base + (k - (count - 1) / 2) * step;
        const x = a.x + Math.cos(ang) * r;
        const z = a.z + Math.sin(ang) * r;
        if (!spotOk(x, z, a, picked, margin)) break;
        picked.push({ x, z });
      }
      if (picked.length === count) return picked;
    }
    // 2) 활이 들어갈 자리가 없으면(보스가 가깝거나 땅이 좁다) 앵커에서 60m 안을 훑는다:
    //    앵커에 가깝고 보스를 등지는 쪽일수록 좋은 자리로 쳐서, 좋은 빈자리부터 차례로 첫 과녁으로 삼아 보고
    //    그 둘레 24m 안에 나머지를 모을 수 있는 첫 무리를 고른다(한 번만 하는 일이라 배열을 만들어 쓴다)
    const valid = [];
    for (let r = 7; r <= DUMMY_FAR; r += 2) {
      const step = Math.max(0.05, 2.5 / r);
      const n = Math.floor(Math.PI / step);
      for (let j = -n; j <= n; j++) {
        const ang = base + j * step;
        const x = a.x + Math.cos(ang) * r;
        const z = a.z + Math.sin(ang) * r;
        if (spotOk(x, z, a, NO_PICKS, margin)) valid.push({ x, z, w: r + 6 * Math.abs(j * step) });
      }
    }
    valid.sort((p, q) => p.w - q.w);
    const far2 = (c) => {
      for (let i = 0; i < picked.length; i++) if (d2(c, picked[i]) < DUMMY_GAP * DUMMY_GAP) return false;
      return true;
    };
    let most = []; // 다 못 모았을 때 돌려줄, 가장 많이 모은 무리
    for (let s = 0; s < valid.length && s < 80; s++) {
      const seed = valid[s];
      picked.length = 0;
      picked.push({ x: seed.x, z: seed.z });
      while (picked.length < count) {
        let best = null;
        let bd = DUMMY_CLUSTER * DUMMY_CLUSTER;
        for (const c of valid) {
          const dd = d2(c, seed);
          if (dd > bd || !far2(c)) continue;
          best = c;
          bd = dd;
        }
        if (!best) break;
        picked.push({ x: best.x, z: best.z });
      }
      if (picked.length >= count) return picked;
      if (picked.length > most.length) most = picked.slice();
    }
    return most;
  }

  function makeDummy(k, x, z, a) {
    if (!dummyGeo) {
      dummyGeo = dummyGeometry(low);
      dummyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    }
    const y = ground(x, z);
    const root = new THREE.Group(); // 발밑을 축으로 기운다(월드 축 기준)
    root.name = 'dummy';
    root.position.set(x, y, z);
    const mesh = new THREE.Mesh(dummyGeo, dummyMat);
    const yaw = Math.atan2(a.x - x, a.z - z); // 과녁 판이 앵커(운동장 가운데)를 본다
    mesh.rotation.y = yaw;
    mesh.castShadow = !low;
    mesh.receiveShadow = true;
    root.add(mesh);
    campus.group.add(root);
    const dm = {
      root,
      x,
      y,
      z,
      yaw,
      hp: DUMMY_HP,
      phase: 0, // 0 서 있음 · 1 넘어짐 · 2 일어나는 중
      lx: 0, // 기운 각도(그 방향으로 기운 크기, rad)
      lz: 0,
      vx: 0,
      vz: 0,
      fx: 0, // 넘어진 방향
      fz: 0,
      until: 0,
      streak: 0,
      lastHit: -Infinity,
      comicAt: -Infinity,
      active: false,
      ci: collider.addCircle(x, z, 0.4), // 기둥(넘어져 있는 동안은 끈다)
      target: null,
    };
    dm.target = {
      id: 'dummy:' + k,
      name: '연습 과녁',
      zone: CID,
      x,
      y,
      z,
      radius: 0.8,
      height: 2,
      alive: true,
      hurt: (d, w, hx, hz) => hurtDummy(dm, d, hx, hz),
    };
    dummies.push(dm);
    dummyTargets.push(dm.target);
    mayhem.addTarget(dm.target);
  }

  /** 과녁이 맞았다(무기 모듈·차량 모듈이 부른다). (hx, hz)는 맞은 자리. 받은 피해를 돌려준다 */
  function hurtDummy(dm, d, hx, hz) {
    if (!(d > 0) || dm.phase !== 0 || !dm.target.alive) return 0;
    const t = engine.time;
    dm.streak = t - dm.lastHit <= STREAK_GAP ? dm.streak + 1 : 1;
    dm.lastHit = t;
    const took = Math.min(d, dm.hp);
    dm.hp -= took;
    // 맞은 자리의 반대쪽으로 기운다(바로 위거나 자리를 모르면 과녁 판이 보는 쪽의 반대로)
    let dx = dm.x - hx;
    let dz = dm.z - hz;
    let l = Math.hypot(dx, dz);
    if (!(l > 0.05)) {
      dx = -Math.sin(dm.yaw);
      dz = -Math.cos(dm.yaw);
      l = 1;
    }
    dx /= l;
    dz /= l;
    const kick = Math.min(3.2, 1.1 + d / 25);
    dm.vx += dx * kick;
    dm.vz += dz * kick;
    dm.active = true;
    dummyBusy = true;
    const fell = dm.hp <= 0;
    if (fell) {
      dm.phase = 1;
      dm.target.alive = false;
      dm.until = t + DUMMY_DOWN_SEC;
      dm.fx = dx;
      dm.fz = dz;
      collider.setCircleEnabled(dm.ci, false);
    }
    // 연속 명중 수(물총 연사에 글자가 쌓이지 않게 0.2초에 한 번). 글자는 STREAK_TEXT에서 고르고(20 넘으면 '20+연속!'),
    // 색은 수의 구간마다 하나라 글자 텍스처는 많아야 21가지다(gfx가 색|글자로 기억해 두고 다시 쓴다). 옵션 객체도 고쳐 쓴다
    if (here() && (fell || t - dm.comicAt >= 0.2)) {
      dm.comicAt = t;
      const n = dm.streak;
      oStreak.color = n >= 10 ? '#ffd23f' : n >= 5 ? '#ff9f43' : '#ffffff';
      oStreak.size = 0.75 + Math.min(n, STREAK_MAX) * 0.03;
      gfx.comic(n > STREAK_MAX ? STREAK_MORE : STREAK_TEXT[n], dm.x, dm.y + 2.9, dm.z, oStreak);
      if (fell) gfx.comic('쿵!', dm.x + dx * 1.2, dm.y + 1, dm.z + dz * 1.2, oThud);
    }
    return took;
  }

  function stepDummies(t, dt) {
    let busy = false;
    for (let i = 0; i < dummies.length; i++) {
      const dm = dummies[i];
      if (!dm.active) continue;
      if (dm.phase === 0) {
        // 용수철: 기울었다가 몇 번 흔들리며 선다
        dm.vx += (-70 * dm.lx - 6 * dm.vx) * dt;
        dm.vz += (-70 * dm.lz - 6 * dm.vz) * dt;
        dm.lx += dm.vx * dt;
        dm.lz += dm.vz * dt;
        const l = Math.hypot(dm.lx, dm.lz);
        if (l > 0.7) {
          dm.lx *= 0.7 / l;
          dm.lz *= 0.7 / l;
        }
        if (l < 0.002 && Math.abs(dm.vx) + Math.abs(dm.vz) < 0.01) {
          dm.lx = dm.lz = dm.vx = dm.vz = 0;
          dm.active = false;
        }
      } else if (dm.phase === 1) {
        const k = Math.min(1, dt * 9);
        dm.lx += (dm.fx * 1.45 - dm.lx) * k;
        dm.lz += (dm.fz * 1.45 - dm.lz) * k;
        if (t >= dm.until) dm.phase = 2;
      } else {
        const k = Math.min(1, dt * 5);
        dm.lx -= dm.lx * k;
        dm.lz -= dm.lz * k;
        if (Math.hypot(dm.lx, dm.lz) < 0.08) {
          dm.phase = 0;
          dm.hp = DUMMY_HP;
          dm.target.alive = true;
          dm.vx = -dm.fx * 1.6; // 벌떡 일어나며 반대로 한 번 흔들린다
          dm.vz = -dm.fz * 1.6;
          collider.setCircleEnabled(dm.ci, true);
        }
      }
      const a = Math.hypot(dm.lx, dm.lz);
      if (a < 1e-5) dm.root.quaternion.identity();
      else dm.root.quaternion.setFromAxisAngle(_axis.set(dm.lz / a, 0, -dm.lx / a), a); // (lx, lz) 쪽으로 a만큼 기운다
      if (dm.active) busy = true;
    }
    dummyBusy = busy;
  }

  /** 시험용: 세운 과녁을 모두 치우고 다음 갱신에서 다시 세운다(그때의 보스 위치를 보고) */
  function resetDummies() {
    for (const dm of dummies) {
      mayhem.removeTarget(dm.target);
      campus.group.remove(dm.root);
      collider.setCircleEnabled(dm.ci, false);
    }
    dummies.length = 0;
    dummyTargets.length = 0;
    dummiesPlaced = false;
    dummyFirstAt = -1;
    dummyBusy = false;
  }

  // ---------- 매 프레임 ----------
  function update(dt) {
    const t = engine.time;
    const h = dt > 0 ? Math.min(dt, 0.1) : 0;
    if (!dummiesPlaced) tryPlaceDummies(t);
    if (bldBusy) stepBuildings(t, h);
    if (carsDown > 0) stepCars(t);
    if (flipsAlive > 0) stepFlips(h);
    if (dummyBusy) stepDummies(t, Math.min(h, 0.05));
    if (wsNextAt > 0) {
      const now = performance.now();
      if (now >= wsNextAt) sendWs(now);
    }
  }

  return {
    update,
    /** 그 건물이 지금 무너져 있는가(주저앉는 중 포함). 탄은 이런 건물을 통과한다 */
    isDown(key) {
      const s = typeof key === 'string' ? blds.get(key) : undefined;
      return !!s && (s.phase === FALLING || s.phase === DOWN);
    },
    /** 시험·점검용: 서 있는 건물을 내가 무너뜨린 것처럼 바로 무너뜨린다(보호 시간은 보지 않는다) */
    collapse(key) {
      const s = typeof key === 'string' ? blds.get(key) : undefined;
      if (!s || s.phase !== UP) return false;
      bringDown(s, 'me', '');
      return true;
    },
    /** 시험·점검용: 건물 상태 { state, hp, maxHp, rebuildIn, safeIn, by } (모르는 키면 null) */
    info(key) {
      const s = typeof key === 'string' ? blds.get(key) : undefined;
      if (!s) return null;
      const t = engine.time;
      return {
        state: PHASE_NAMES[s.phase],
        hp: s.hp,
        maxHp: s.maxHp,
        rebuildIn: s.phase === FALLING || s.phase === DOWN ? s.rebuildAt - t : 0,
        safeIn: Math.max(0, s.safeUntil - t),
        by: s.by,
      };
    },
    /** 시험·점검용: 차 i가 터져서 돌아오기를 기다리는 중인가 */
    isCarWrecked: (i) => Number.isInteger(i) && i >= 0 && i < cars.length && carBackAt[i] > 0,
    dummies: dummyTargets,
    resetDummies,
    /** 시험·점검용: 과녁을 세울 때 보스 둥지와 띄운 여유(m, 깨어나는 거리 위로). 음수면 깨어나는 거리 밖에 다 못 세웠다 */
    dummyMargin: () => dummyMargin,
  };
}
