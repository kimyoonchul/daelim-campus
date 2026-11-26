// 자동차 한 대의 움직임(설계서 5.3). 순수 모듈이다 — three·DOM을 쓰지 않는다. 시험: node tools/test-carstep.mjs
//
// 방향: 차의 앞은 (sin yaw, cos yaw)로 주차 차량(props.js)·아바타와 같다. 오른쪽은 (-cos yaw, sin yaw).
//   ctrl.steer가 +면 왼쪽으로 돈다(yaw가 커진다). 오른쪽 키(input.moveX = +1)는 steer = -1로 넘긴다.
//   후진할 때는 실제 차처럼 같은 쪽으로 꺾어도 반대로 돈다.
//
// stepCar(car, ctrl, dt, env, out?) — car를 제자리에서 고치고 결과 객체를 돌려준다.
//   car  { x, z, y, yaw, speed, vy, air, hp, steer }
//        y는 바퀴 밑 높이(땅에 있으면 차 가운데의 지면 높이), speed는 앞 방향 속력(m/s, 후진은 음수),
//        vy는 위아래 속력, air는 공중에 떠 있는지, hp는 내구도(0~100), steer는 이 함수가 쓰는 부드러운 조향값.
//   ctrl { throttle: -1~1(앞 +), steer: -1~1(왼쪽 +), brake: true면 브레이크 }
//   env  { heightAt(x, z), playable(x, z), solidAt(x, z), resolve(p, r) }
//        지면 높이 · 갈 수 있는 땅인지 · 건물 안인지(건물 기록 또는 null) · 원(p = {x, z}, 반지름 r)을 벽·소품 밖으로
//        밀어내기(p를 고치고 밀렸으면 true). heightAt만 꼭 있어야 하고 나머지는 없으면 막힌 곳이 없는 것으로 친다.
//   돌려주는 값 { hit, landed, impact, edge, hx, hz }
//        hit    이번에 부딪힌 세기(벽 쪽으로 향하던 속력 m/s). 살짝 닿은 것(1.5 미만)은 0
//        landed 이번에 땅에 내려앉았는지 · impact 그때 아래로 떨어지던 속력(m/s)
//        edge   갈 수 있는 땅의 끝에 막혔는지(보이지 않는 경계라 피해·hit 없음)
//        hx, hz 부딪힌 쪽 범퍼 자리(효과용)
//        out을 생략하면 이 모듈이 가진 객체 하나를 고쳐 돌려준다(매 프레임 새로 만들지 않는다 — 다음 호출 전에 읽을 것).
//
// 지키는 것
//   - 건물 안(solidAt)·갈 수 없는 땅으로는 절대 들어가지 않는다: 한 번에 0.6m 이하로 나눠 움직이며(원 반지름보다 작게),
//     밀어낸 뒤의 자세를 매번 검사해 하나라도 걸리면 그 걸음을 버리고 튕긴다.
//   - 가속 입력이 없으면 저절로 선다: 자동 제동(10)이 어떤 비탈의 끌어내림(중력 9.8 미만)보다 세서 비탈에서도 굴러가지 않는다.
//   - 옹벽(경사 1.6을 넘는 턱)은 못 오르고, 그런 턱에서 내려가면 공중에 떴다가 내려앉는다.
//   - 이상한 입력(NaN·무한대·음수 dt·빠진 값)에도 NaN을 만들지 않는다. dt는 0.2초까지만 쓴다.

export const CAR = Object.freeze({
  accel: 11, // 가속(m/s²)
  maxSpeed: 23, // 최고 속력(m/s)
  maxReverse: 7, // 후진 최고 속력
  brake: 22, // 브레이크(반대쪽 가속 입력도 브레이크)
  autoBrake: 10, // 가속 입력이 없을 때의 제동 — 비탈의 끌어내림(최대 9.8)보다 세다
  slopeG: 9.8, // 비탈이 차를 끌어내리는 가속의 상한(중력)
  gravity: 20, // 공중에서 떨어지는 가속(사람과 같다)
  radius: 1.0, // 충돌 원 반지름
  offset: 1.1, // 충돌 원 두 개의 중심: 차 가운데에서 앞뒤로
  lead: 2.0, // 옹벽 판정에 쓰는 앞뒤 범퍼 자리
  halfWidth: 0.9, // 차 폭의 절반
  sub: 0.6, // 한 걸음에 움직이는 최대 거리
  wall: 1.6, // 이보다 가파르면(높이 차 ÷ 수평 거리) 못 오르고, 내려갈 때는 떨어진다
  bounce: 0.3, // 정면으로 부딪히면 속력의 30%로 거꾸로 튕긴다
  hpMax: 100,
});

const TAU = Math.PI * 2;
const MAX_DT = 0.2;
const DEAD = 0.05; // 이보다 작은 가속 입력은 없는 것으로 본다
const REV_EPS = 0.5; // 이보다 빠르게 반대로 가고 있으면 반대쪽 입력은 브레이크다
const SLOPE_E = 1.5; // 비탈을 잴 때 앞뒤 바퀴 자리
const MIN_TURN_R = 4.5; // 느릴 때 가장 작은 회전 반지름(m)
const TURN = 1.5; // 빠를 때의 회전 속도 상한(rad/s)…
const TURN_FALL = 0.03; // …은 속력이 오를수록 이만큼씩 줄어든다
const STEER_IN = 4.5; // 조향값이 입력을 따라가는 빠르기(1/초)
const STEER_OUT = 8; // 손을 떼거나 반대로 꺾을 때
const HEADON = 0.6; // 벽과 만난 각의 cos이 이보다 크면 정면 충돌(튕김), 작으면 스침(벽을 따라 미끄러짐)
const DEFLECT = 0.6; // 스치면 머리를 벽을 따라 이만큼 돌린다
const HIT_MIN = 1.5; // 이보다 약하게 닿은 것은 부딪힘으로 치지 않는다(소리·피해 없음)
const DMG_FREE = 4; // 이 세기까지는 내구도가 줄지 않는다
const DMG_PER = 1.6; // 그 위로 1m/s마다 내구도 감소
const LAND_FREE = 12; // 이보다 빨리 떨어져 내려앉으면 내구도가 준다
const LAND_PER = 1.5;
const AIR_WALL = 0.6; // 공중에서 앞길의 땅이 차보다 이만큼 높으면 옆면에 부딪힌 것이다
const VY_MAX = 60;

const RESULT = { hit: 0, landed: false, impact: 0, edge: false, hx: 0, hz: 0 };
const P = { x: 0, z: 0 }; // resolve에 넘기는 점(고쳐 쓴다)
const S = { x: 0, z: 0, ok: false }; // settle 결과

const fin = (v, d) => (Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function ground(env, x, z, def) {
  const h = env.heightAt(x, z);
  return Number.isFinite(h) ? h : def;
}

/** 원 하나(중심 x, z)를 벽·소품 밖으로 밀어낸다. 결과는 P */
function pushOut(env, x, z) {
  P.x = x;
  P.z = z;
  if (env.resolve) env.resolve(P, CAR.radius);
  if (!Number.isFinite(P.x) || !Number.isFinite(P.z)) {
    P.x = x;
    P.z = z;
  }
}

/**
 * 차 가운데 (x, z), 앞 방향 (s, c)인 자세에서 앞뒤 원을 차례로 밀어내며 차 전체를 옮긴다.
 * 결과는 S: 옮긴 가운데와, 더 밀 것이 없어졌는지(ok — 네 번 밀어도 남아 있으면 끼인 것이다).
 */
function settle(env, x, z, s, c) {
  const o = CAR.offset;
  for (let it = 0; it < 4; it++) {
    let moved = false;
    for (let k = -1; k <= 1; k += 2) {
      const cx = x + s * o * k;
      const cz = z + c * o * k;
      pushOut(env, cx, cz);
      const dx = P.x - cx;
      const dz = P.z - cz;
      // 아주 작은 밀림도 반영은 하되(쌓여서 파고들지 않게), 되풀이할지는 눈에 띄게 밀렸을 때만 정한다
      x += dx;
      z += dz;
      if (dx * dx + dz * dz > 1e-8) moved = true;
    }
    if (!moved) {
      S.x = x;
      S.z = z;
      S.ok = true;
      return S;
    }
  }
  S.x = x;
  S.z = z;
  S.ok = false;
  return S;
}

/** 0: 괜찮다 · 1: 건물 안 · 2: 갈 수 있는 땅 밖 */
function badPoint(env, x, z) {
  if (env.playable && !env.playable(x, z)) return 2;
  if (env.solidAt && env.solidAt(x, z)) return 1;
  return 0;
}
/** 차 가운데와 두 원의 중심을 모두 본다 */
function badPose(env, x, z, s, c) {
  const o = CAR.offset;
  return badPoint(env, x, z) || badPoint(env, x + s * o, z + c * o) || badPoint(env, x - s * o, z - c * o);
}

/**
 * 땅 위에서 옹벽을 오르려 하는가: 앞 범퍼·가운데·뒤 범퍼 각각, 옛 자리 → 새 자리의 오르막이 수평 이동 × 1.6을 넘으면 그렇다.
 * 아주 천천히 기어올라도 기울기로 보므로 같은 판정이 나온다.
 */
function climbBad(env, ox, oz, os, oc, nx, nz, ns, nc) {
  const L = CAR.lead;
  for (let k = -1; k <= 1; k++) {
    const ax = ox + os * L * k;
    const az = oz + oc * L * k;
    const bx = nx + ns * L * k;
    const bz = nz + nc * L * k;
    const ha = ground(env, ax, az, 0);
    const hb = ground(env, bx, bz, ha);
    if (hb - ha > Math.hypot(bx - ax, bz - az) * CAR.wall + 1e-3) return true;
  }
  return false;
}

/**
 * 공중에서 앞길의 땅이 차보다 한참 높은가(옹벽 옆면에 날아가 부딪힘). 가운데와 나아가는 쪽 범퍼만 본다
 * (막 떠난 턱 위에 걸쳐 있는 뒤쪽 범퍼는 보지 않는다). dir은 진행 방향(앞 1, 후진 -1)
 */
function airWallBad(env, y, nx, nz, ns, nc, dir) {
  const L = CAR.lead * dir;
  return ground(env, nx, nz, y) > y + AIR_WALL || ground(env, nx + ns * L, nz + nc * L, y) > y + AIR_WALL;
}

/**
 * 벽을 스쳤을 때 머리를 벽을 따라 돌린다(계속 긁지 않게). (wx, wz)는 벽에서 밖으로 향하는 단위 벡터,
 * dir은 진행 방향(앞 1, 후진 -1). 돌린 자세가 깨끗할 때만 돌린다.
 */
function deflect(env, car, wx, wz, dir) {
  const s = Math.sin(car.yaw);
  const c = Math.cos(car.yaw);
  // 벽의 접선 중 지금 가던 쪽
  let tx = wz;
  let tz = -wx;
  if ((tx * s + tz * c) * dir < 0) {
    tx = -tx;
    tz = -tz;
  }
  let d = Math.atan2(tx * dir, tz * dir) - car.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const yaw = car.yaw + d * DEFLECT;
  const ys = Math.sin(yaw);
  const yc = Math.cos(yaw);
  settle(env, car.x, car.z, ys, yc);
  const mx = S.x - car.x;
  const mz = S.z - car.z;
  if (!S.ok || mx * mx + mz * mz > 0.04 || badPose(env, S.x, S.z, ys, yc)) return;
  if (!car.air && climbBad(env, car.x, car.z, s, c, S.x, S.z, ys, yc)) return;
  car.x = S.x;
  car.z = S.z;
  car.yaw = yaw;
}

export function stepCar(car, ctrl, dt, env, out = RESULT) {
  out.hit = 0;
  out.landed = false;
  out.impact = 0;
  out.edge = false;
  out.hx = car && Number.isFinite(car.x) ? car.x : 0;
  out.hz = car && Number.isFinite(car.z) ? car.z : 0;
  if (!car || !env || typeof env.heightAt !== 'function') return out;
  if (!Number.isFinite(car.x) || !Number.isFinite(car.z)) return out; // 어디 있는지 모르면 움직이지 않는다
  if (typeof dt !== 'number' || !(dt > 0)) return out; // 숫자가 아니거나 NaN·0·음수
  if (dt > MAX_DT) dt = MAX_DT;

  // ----- 상태 정리(밖에서 이상한 값이 들어와도 NaN이 퍼지지 않게) -----
  car.yaw = fin(car.yaw, 0);
  if (Math.abs(car.yaw) > 1e6) car.yaw %= TAU;
  car.speed = clamp(fin(car.speed, 0), -CAR.maxReverse, CAR.maxSpeed);
  car.vy = clamp(fin(car.vy, 0), -VY_MAX, VY_MAX);
  car.hp = clamp(fin(car.hp, CAR.hpMax), 0, CAR.hpMax);
  car.steer = clamp(fin(car.steer, 0), -1, 1);
  car.air = !!car.air;
  const g0 = ground(env, car.x, car.z, Number.isFinite(car.y) ? car.y : 0);
  if (!Number.isFinite(car.y) || !car.air) car.y = g0;
  if (car.air && car.y < g0) car.y = g0;

  const thr = clamp(fin(ctrl && ctrl.throttle, 0), -1, 1);
  const st = clamp(fin(ctrl && ctrl.steer, 0), -1, 1);
  const brk = !!(ctrl && ctrl.brake);

  // 조향값은 입력을 부드럽게 따라간다(키보드는 0 아니면 ±1이라 바로 꺾으면 휙 돈다)
  const sr = (st === 0 || st * car.steer < 0 ? STEER_OUT : STEER_IN) * dt;
  car.steer += clamp(st - car.steer, -sr, sr);

  // ----- 앞뒤 속력: 엔진·비탈·브레이크 (공중에서는 그대로) -----
  const v0 = car.speed;
  let v = v0;
  let yawRate = 0;
  if (!car.air) {
    const s = Math.sin(car.yaw);
    const c = Math.cos(car.yaw);
    const hf = ground(env, car.x + s * SLOPE_E, car.z + c * SLOPE_E, g0);
    const hb = ground(env, car.x - s * SLOPE_E, car.z - c * SLOPE_E, g0);
    const grad = (hf - hb) / (2 * SLOPE_E); // 앞이 높으면 +
    const aSlope = (-CAR.slopeG * grad) / Math.sqrt(1 + grad * grad); // 크기는 늘 9.8 미만
    let aEng = 0;
    let decel = 0;
    if (brk) decel = CAR.brake;
    else if (thr > DEAD) {
      if (v < -REV_EPS) decel = CAR.brake * thr;
      else aEng = CAR.accel * thr;
    } else if (thr < -DEAD) {
      if (v > REV_EPS) decel = -CAR.brake * thr;
      else aEng = CAR.accel * thr;
    } else decel = CAR.autoBrake;
    v += (aEng + aSlope) * dt;
    if (decel > 0) {
      // 0을 넘어 거꾸로 가지는 않는다. 서 있으면 정확히 0으로 둔다
      const dv = decel * dt;
      v = v > dv ? v - dv : v < -dv ? v + dv : 0;
    }
    v = clamp(v, -CAR.maxReverse, CAR.maxSpeed);
  }
  // 이번에 움직이는 속력은 처음과 끝의 평균이다(가속이 일정하면 dt와 상관없이 정확한 거리가 나온다)
  let vm = (v0 + v) / 2;
  if (!car.air) {
    // 서 있으면 돌지 않고, 느릴 때는 회전 반지름 4.5m까지, 빠를수록 덜 꺾인다
    const av = Math.abs(vm);
    const wMax = Math.min(av / MIN_TURN_R, TURN / (1 + av * TURN_FALL));
    yawRate = car.steer * wMax * (vm < 0 ? -1 : 1);
  }

  // ----- 이미 무언가와 겹쳐 있으면(막 놓였거나 주차 차량이 제자리로 돌아왔다) 먼저 빠져나온다. 부딪힌 것으로 치지 않는다 -----
  {
    const s = Math.sin(car.yaw);
    const c = Math.cos(car.yaw);
    settle(env, car.x, car.z, s, c);
    const mx = S.x - car.x;
    const mz = S.z - car.z;
    if (mx * mx + mz * mz > 1e-8 && S.ok && !badPose(env, S.x, S.z, s, c)) {
      car.x = S.x;
      car.z = S.z;
      if (!car.air) car.y = ground(env, car.x, car.z, car.y);
    }
  }

  // ----- 나눠 걷기: 한 걸음 0.6m 이하(회전으로 범퍼가 쓸고 가는 거리도 포함) -----
  const dist = Math.abs(vm) * dt;
  const arc = Math.abs(yawRate * dt) * CAR.lead;
  const n = Math.max(1, Math.ceil(Math.max(dist, arc) / CAR.sub));
  const h = dt / n;
  let maxHit = 0;
  let hitDir = vm < 0 ? -1 : 1;
  let stopped = false;
  for (let i = 0; i < n; i++) {
    if (!stopped) {
      const ox = car.x;
      const oz = car.z;
      const os = Math.sin(car.yaw);
      const oc = Math.cos(car.yaw);
      const nyaw = car.yaw + yawRate * h;
      const ns = Math.sin(nyaw);
      const nc = Math.cos(nyaw);
      const tx = ox + ns * vm * h;
      const tz = oz + nc * vm * h;
      settle(env, tx, tz, ns, nc);
      const settled = S.ok;
      const nx = S.x;
      const nz = S.z;
      const px = nx - tx;
      const pz = nz - tz;
      const pl = Math.hypot(px, pz);
      const dir = vm < 0 || (vm === 0 && v < 0) ? -1 : 1;
      // 밀려난 방향과 진행 방향으로 만난 각을 잰다: 1이면 정면, 0이면 나란히 스침
      let cos = 0;
      if (pl > 1e-4 && vm !== 0) cos = (-(ns * px + nc * pz) / pl) * dir;
      let block = 0; // 0 없음 · 1 벽(건물·소품·옹벽) · 2 땅 끝
      if (!settled || cos > HEADON) block = 1;
      else {
        const b = badPose(env, nx, nz, ns, nc);
        if (b) block = b;
        else if (!car.air ? climbBad(env, ox, oz, os, oc, nx, nz, ns, nc) : airWallBad(env, car.y, nx, nz, ns, nc, dir)) block = 1;
      }
      if (block) {
        // 이 걸음은 버린다(자리·방향 그대로) — 거꾸로 튕기고 이번 프레임은 더 나아가지 않는다
        if (block === 1) {
          const hs = Math.abs(v) * (cos > HEADON ? cos : 1);
          if (hs > maxHit) {
            maxHit = hs;
            hitDir = dir;
          }
        } else out.edge = true;
        v = -CAR.bounce * v;
        stopped = true;
      } else {
        car.x = nx;
        car.z = nz;
        car.yaw = nyaw;
        if (cos > 0) {
          // 스쳤다: 벽 쪽으로 가던 만큼 잃고 벽을 따라 미끄러진다
          const hs = Math.abs(v) * cos;
          if (hs > maxHit) {
            maxHit = hs;
            hitDir = dir;
          }
          const keep = Math.sqrt(Math.max(0, 1 - cos * cos));
          v *= keep;
          vm *= keep;
          deflect(env, car, px / pl, pz / pl, dir);
        }
        // 땅 위: 지면을 따라간다. 옹벽보다 가파르게 떨어지는 곳이면 공중으로
        if (!car.air) {
          const gN = ground(env, car.x, car.z, car.y);
          const d = Math.hypot(car.x - ox, car.z - oz);
          if (car.y - gN > d * CAR.wall + 0.02) car.air = true; // vy는 직전까지 땅을 따라 내려가던 속력 그대로
          else {
            car.vy = clamp((gN - car.y) / h, -VY_MAX, VY_MAX);
            car.y = gN;
          }
        }
      }
    }
    // 공중: 떨어지다가 땅에 닿으면 내려앉는다
    if (car.air) {
      car.vy = Math.max(-VY_MAX, car.vy - CAR.gravity * h);
      car.y += car.vy * h;
      const gN = ground(env, car.x, car.z, car.y);
      if (car.y <= gN) {
        out.landed = true;
        out.impact = Math.max(out.impact, -car.vy);
        car.y = gN;
        car.vy = 0;
        car.air = false;
      }
    } else if (stopped) car.vy = 0;
  }
  car.speed = clamp(v, -CAR.maxReverse, CAR.maxSpeed);

  // ----- 부딪힌 세기·내구도(한 번 부를 때 가장 센 것 하나만) -----
  if (maxHit >= HIT_MIN) {
    out.hit = maxHit;
    const lead = CAR.lead + 0.15;
    out.hx = car.x + Math.sin(car.yaw) * lead * hitDir;
    out.hz = car.z + Math.cos(car.yaw) * lead * hitDir;
    if (maxHit > DMG_FREE) car.hp = Math.max(0, car.hp - (maxHit - DMG_FREE) * DMG_PER);
  }
  if (out.landed && out.impact > LAND_FREE) car.hp = Math.max(0, car.hp - (out.impact - LAND_FREE) * LAND_PER);
  return out;
}
