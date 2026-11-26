// 자동차 움직임(src/mayhem/carstep.js) 점검: node tools/test-carstep.mjs
// 순수 모듈만 불러 Node에서 그대로 돌린다. 가짜 지형·벽으로 하나하나 확인하고, 실제 캠퍼스 지형(heightfield.js)과
// 실제 건물 평면(campus-data.js)으로 정문 길을 올라가 본다. 하나라도 실패하면 종료 코드 1.
import assert from 'node:assert/strict';
import { stepCar, CAR } from '../src/mayhem/carstep.js';
import data from '../data/campus-data.js';
import { heightAt as campusHeight } from '../src/world/heightfield.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    const msg = String(e && e.message ? e.message : e);
    console.log(`실패: ${name}\n  ${msg.split('\n').join('\n  ')}`);
  }
}
process.on('exit', (code) => {
  console.log(failed ? `carstep: 실패 ${failed}건 · 통과 ${passed}건` : `carstep: 모두 통과 (${passed}건)`);
  if (failed && !code) process.exitCode = 1;
});
const near = (a, b, eps, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} ≈ ${b} (±${eps})`);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- 가짜 세계: 다각형 건물(벽 선분)·원 기둥·지형 함수·갈 수 있는 범위 ----------
function inPoly(x, z, p) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i];
    const b = p[j];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
const box = (x0, z0, x1, z1) => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
function makeEnv({ height = () => 0, polys = [], circles = [], bounds = null } = {}) {
  const solids = polys.map((poly) => {
    let a = Infinity;
    let b = Infinity;
    let c = -Infinity;
    let d = -Infinity;
    for (const q of poly) {
      a = Math.min(a, q[0]);
      b = Math.min(b, q[1]);
      c = Math.max(c, q[0]);
      d = Math.max(d, q[1]);
    }
    const segs = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      segs.push([p[0], p[1], q[0], q[1]]);
    }
    return { poly, bb: [a, b, c, d], segs };
  });
  const env = {
    calls: 0,
    heightAt: height,
    playable: (x, z) => !bounds || (x >= bounds[0] && x <= bounds[2] && z >= bounds[1] && z <= bounds[3]),
    solidAt(x, z) {
      for (const s of solids) if (x >= s.bb[0] && x <= s.bb[2] && z >= s.bb[1] && z <= s.bb[3] && inPoly(x, z, s.poly)) return s;
      return null;
    },
    // collision.js의 resolve와 같은 규칙(벽 선분에서 r만큼, 원은 반지름 합만큼 밀어낸다. 4번까지 되풀이)
    resolve(p, r) {
      env.calls++;
      let hit = false;
      for (let iter = 0; iter < 4; iter++) {
        let moved = false;
        for (const s of solids) {
          if (p.x < s.bb[0] - r || p.x > s.bb[2] + r || p.z < s.bb[1] - r || p.z > s.bb[3] + r) continue;
          for (const [ax, az, bx, bz] of s.segs) {
            const ex = bx - ax;
            const ez = bz - az;
            const l2 = ex * ex + ez * ez;
            let t = l2 ? ((p.x - ax) * ex + (p.z - az) * ez) / l2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = ax + t * ex;
            const qz = az + t * ez;
            const dx = p.x - qx;
            const dz = p.z - qz;
            const d2 = dx * dx + dz * dz;
            if (d2 < r * r) {
              const d = Math.sqrt(d2);
              if (d > 1e-5) {
                p.x = qx + (dx / d) * r;
                p.z = qz + (dz / d) * r;
              } else {
                const l = Math.sqrt(l2) || 1;
                p.x = qx + (ez / l) * r;
                p.z = qz - (ex / l) * r;
              }
              moved = hit = true;
            }
          }
        }
        for (const [cx, cz, cr] of circles) {
          const dx = p.x - cx;
          const dz = p.z - cz;
          const rr = r + cr;
          const d2 = dx * dx + dz * dz;
          if (d2 < rr * rr) {
            const d = Math.sqrt(d2) || 0.0001;
            p.x = cx + (dx / d) * rr;
            p.z = cz + (dz / d) * rr;
            moved = hit = true;
          }
        }
        if (!moved) break;
      }
      return hit;
    },
  };
  return env;
}
const FLAT = makeEnv();
const mkCar = (o = {}) => ({ x: 0, z: 0, y: 0, yaw: 0, speed: 0, vy: 0, air: false, hp: 100, steer: 0, ...o });
const ctl = (throttle = 0, steer = 0, brake = false) => ({ throttle, steer, brake });
/** sec초 동안 dt 간격으로 돌린다. each(car, res, t)를 걸음마다 부른다 */
function run(car, ctrl, sec, env = FLAT, dt = 1 / 60, each = null) {
  const n = Math.round(sec / dt);
  let res = null;
  for (let i = 0; i < n; i++) {
    res = stepCar(car, typeof ctrl === 'function' ? ctrl(car, i * dt) : ctrl, dt, env);
    if (each) each(car, res, (i + 1) * dt);
  }
  return res;
}
const finite = (car) => ['x', 'z', 'y', 'yaw', 'speed', 'vy', 'hp', 'steer'].every((k) => Number.isFinite(car[k]));
/** 차 가운데·두 원 중심 중 건물 안에 든 것이 있는가 */
function insideAny(env, car) {
  const s = Math.sin(car.yaw);
  const c = Math.cos(car.yaw);
  for (const k of [0, 1, -1]) if (env.solidAt(car.x + s * CAR.offset * k, car.z + c * CAR.offset * k)) return true;
  return false;
}

// ---------- 설계값 ----------
test('설계값: 가속 11 · 최고 23(후진 7) · 브레이크 22 · 원 2개(반지름 1, ±1.1) · 0.6m 걸음 · 옹벽 1.6 · 튕김 30%', () => {
  assert.equal(CAR.accel, 11);
  assert.equal(CAR.maxSpeed, 23);
  assert.equal(CAR.maxReverse, 7);
  assert.equal(CAR.brake, 22);
  assert.equal(CAR.radius, 1);
  assert.equal(CAR.offset, 1.1);
  assert.equal(CAR.sub, 0.6);
  assert.equal(CAR.wall, 1.6);
  assert.equal(CAR.bounce, 0.3);
  assert.ok(CAR.autoBrake > CAR.slopeG, '자동 제동이 어떤 비탈의 끌어내림보다 세야 한다');
  assert.ok(Object.isFrozen(CAR));
});

// ---------- 평지 ----------
test('평지 가속: 1초에 11m/s, 앞(yaw 0이면 +z)으로 간다', () => {
  const car = mkCar();
  run(car, ctl(1), 1);
  near(car.speed, 11, 1e-9, '속력');
  near(car.z, 5.5, 0.12, '간 거리');
  near(car.x, 0, 1e-9, '옆으로 새지 않는다');
  near(car.y, 0, 1e-12);
  // 다른 방향: yaw = π/2면 +x
  const b = mkCar({ yaw: Math.PI / 2 });
  run(b, ctl(1), 1);
  near(b.x, 5.5, 0.12);
  near(b.z, 0, 1e-6);
});

test('최고 속력 23, 후진 7을 넘지 않는다', () => {
  const car = mkCar();
  let peak = 0;
  run(car, ctl(1), 6, FLAT, 1 / 60, (c) => (peak = Math.max(peak, c.speed)));
  assert.equal(car.speed, 23);
  assert.equal(peak, 23);
  const r = mkCar();
  let low = 0;
  run(r, ctl(-1), 3, FLAT, 1 / 60, (c) => (low = Math.min(low, c.speed)));
  assert.equal(r.speed, -7);
  assert.equal(low, -7);
  assert.ok(r.z < -10, '뒤로 갔다');
  // 반쯤 밟으면 가속도 절반
  const h = mkCar();
  run(h, ctl(0.5), 1);
  near(h.speed, 5.5, 1e-9);
});

test('브레이크 22: 23m/s에서 약 1.05초·12m 만에 서고, 거꾸로 가지 않는다', () => {
  const car = mkCar({ speed: 23 });
  let stopT = -1;
  run(car, ctl(0, 0, true), 3, FLAT, 1 / 60, (c, r, t) => {
    if (stopT < 0 && c.speed === 0) stopT = t;
    assert.ok(c.speed >= 0, '브레이크로 후진하면 안 된다');
  });
  near(stopT, 23 / 22, 1 / 60 + 1e-9, '서는 데 걸린 시간');
  near(car.z, (23 * 23) / (2 * 22), 0.25, '제동 거리');
  assert.equal(car.speed, 0);
  // 가속을 밟은 채로 브레이크를 밟아도 브레이크가 이긴다
  const b = mkCar({ speed: 10 });
  run(b, ctl(1, 0, true), 1);
  assert.equal(b.speed, 0);
});

test('가속 입력이 없으면 자동 제동으로 선다(23m/s → 약 2.3초)', () => {
  const car = mkCar({ speed: 23 });
  let stopT = -1;
  run(car, ctl(0), 4, FLAT, 1 / 60, (c, r, t) => {
    if (stopT < 0 && c.speed === 0) stopT = t;
  });
  near(stopT, 23 / CAR.autoBrake, 1 / 60 + 1e-9);
  assert.equal(car.speed, 0);
  const z = car.z;
  run(car, ctl(0), 2);
  assert.equal(car.z, z, '선 뒤에는 움직이지 않는다');
  // 후진하던 차도 선다
  const r = mkCar({ speed: -7 });
  run(r, ctl(0), 1.5);
  assert.equal(r.speed, 0);
  // 아주 작은 입력(0.05 이하)은 입력이 없는 것으로 친다
  const d = mkCar({ speed: 5 });
  run(d, ctl(0.04), 1);
  assert.equal(d.speed, 0);
});

test('반대쪽 가속은 브레이크로 듣고, 선 다음에 후진한다', () => {
  const car = mkCar({ speed: 10 });
  stepCar(car, ctl(-1), 0.1, FLAT);
  near(car.speed, 10 - 2.2, 1e-9);
  run(car, ctl(-1), 2);
  assert.ok(car.speed < 0, '선 다음에는 뒤로 간다: ' + car.speed);
  const b = mkCar({ speed: -5 });
  stepCar(b, ctl(1), 0.1, FLAT);
  near(b.speed, -5 + 2.2, 1e-9);
});

// ---------- 비탈 ----------
const incline = (g, ax = 0, az = 1) => makeEnv({ height: (x, z) => g * (x * ax + z * az) });
test('비탈: 입력이 없으면 어느 방향을 보든 그 자리에 선다(경사 0.3·1.0·1.5·3.0)', () => {
  for (const g of [0.3, 1.0, 1.5, 3.0]) {
    const env = incline(g);
    for (const yaw of [0, Math.PI, Math.PI / 2, 0.7, -2.4]) {
      const car = mkCar({ yaw, y: 0 });
      run(car, ctl(0), 5, env);
      assert.equal(car.speed, 0, `경사 ${g} yaw ${yaw}`);
      assert.equal(car.x, 0);
      assert.equal(car.z, 0);
      assert.equal(car.air, false);
    }
    // 내리막으로 굴러가던 차도 선다(제동이 끌어내림보다 세다). 옹벽(1.6)보다 가파른 곳은 달려 내려가면 떨어지는 곳이라 따로 본다
    if (g > CAR.wall) continue;
    const down = mkCar({ yaw: Math.PI, speed: 8 });
    run(down, ctl(0), 6, env);
    assert.equal(down.speed, 0, `경사 ${g} 내리막에서 못 섰다`);
    const z = down.z;
    run(down, ctl(0), 2, env);
    assert.equal(down.z, z);
  }
  // 경사 3: 달려 내려가면 떴다 내려앉기를 되풀이하며 내려가고, 땅 밑으로 꺼지거나 NaN이 나지 않는다
  const steep = incline(3.0);
  const c = mkCar({ yaw: Math.PI, speed: 2 });
  let landed = 0;
  run(c, ctl(0), 2, steep, 1 / 60, (k, r) => {
    assert.ok(finite(k) && k.y >= steep.heightAt(k.x, k.z) - 1e-9);
    if (r.landed) landed++;
  });
  assert.ok(landed > 0);
});

test('비탈은 오르막에서 느리게, 내리막에서 빠르게 한다', () => {
  const env = incline(0.5);
  const up = mkCar({ yaw: 0 });
  run(up, ctl(1), 1, env);
  const a = 9.8 * (0.5 / Math.sqrt(1.25));
  near(up.speed, 11 - a, 0.05, '오르막 1초 뒤 속력');
  assert.ok(up.y > 1, '올라갔다');
  const down = mkCar({ yaw: Math.PI });
  run(down, ctl(1), 1, env);
  near(down.speed, Math.min(23, 11 + a), 0.05, '내리막 1초 뒤 속력');
  // 내리막에서도 23을 넘지 않는다
  run(down, ctl(1), 5, env);
  assert.equal(down.speed, 23);
});

// ---------- 조향 ----------
test('조향: +는 왼쪽, 오른쪽 키(steer -1)를 누르고 yaw 0에서 달리면 x가 줄어든다', () => {
  const r = mkCar();
  run(r, ctl(1, -1), 1.2);
  assert.ok(r.x < -0.5, '오른쪽으로 돌지 않았다: x=' + r.x);
  assert.ok(r.yaw < -0.2);
  const l = mkCar();
  run(l, ctl(1, 1), 1.2);
  assert.ok(l.x > 0.5 && l.yaw > 0.2);
  // 오른쪽은 (-cos yaw, sin yaw): yaw 0이면 -x
  // 서 있으면 돌지 않는다
  const s = mkCar();
  run(s, ctl(0, 1), 2);
  assert.equal(s.yaw, 0);
  // 후진할 때는 같은 쪽으로 꺾어도 반대로 돈다
  const b = mkCar();
  run(b, ctl(-1, 1), 1.5);
  assert.ok(b.yaw < -0.1, '후진 조향: yaw=' + b.yaw);
});

test('조향: 빠를수록 회전 반지름이 크고, 느릴 때 반지름은 4.5m 이상', () => {
  // 실제로 지나간 길이 ÷ 돈 각도. 속력을 유지하려고 매 걸음 되돌려 놓는다
  const radius = (v) => {
    const car = mkCar({ speed: v, steer: 1 });
    const keep = (c) => {
      c.speed = v;
      return ctl(0.06, 1);
    };
    run(car, keep, 0.5);
    const yaw0 = car.yaw;
    let len = 0;
    let px = car.x;
    let pz = car.z;
    run(car, keep, 0.5, FLAT, 1 / 60, (c) => {
      len += Math.hypot(c.x - px, c.z - pz);
      px = c.x;
      pz = c.z;
    });
    return len / (car.yaw - yaw0);
  };
  const r3 = radius(3);
  const r10 = radius(10);
  const r23 = radius(23);
  assert.ok(r3 >= 4.5 - 0.05, '느릴 때 반지름 ' + r3);
  assert.ok(r23 > r10 && r10 > r3, `반지름 ${r3.toFixed(1)} < ${r10.toFixed(1)} < ${r23.toFixed(1)}`);
  assert.ok(r23 < 40, '최고 속력에서도 돌 수는 있다: ' + r23);
});

// ---------- 벽 ----------
test('정면 충돌: 건물 안으로 들어가지 않고, 30% 거꾸로 튕기며, 내구도가 속력에 비례해 준다', () => {
  const env = makeEnv({ polys: [box(-20, 20, 20, 40)] });
  const car = mkCar();
  let impact = null;
  run(car, ctl(1), 6, env, 1 / 60, (c, r) => {
    assert.ok(!insideAny(env, c), '건물 안에 들어갔다');
    assert.ok(c.z + CAR.offset <= 20 - CAR.radius + 1e-6, '앞 원이 벽에 파고들었다: ' + (c.z + CAR.offset - 19));
    if (r.hit > 0 && !impact) impact = { hit: r.hit, speed: c.speed, hp: c.hp, hz: r.hz };
  });
  assert.ok(impact, '부딪힘이 보고되지 않았다');
  assert.ok(impact.speed < 0, '튕겨 나오지 않았다');
  near(impact.speed, -CAR.bounce * impact.hit, 0.05 * impact.hit, '튕긴 속력');
  near(impact.hp, 100 - (impact.hit - 4) * 1.6, 1e-6, '내구도');
  near(impact.hz, 20, 0.6, '부딪힌 범퍼 자리');
  // 세게 부딪힐수록 더 준다
  const hpAfter = (v) => {
    const c = mkCar({ z: 20 - 2.1 - 0.3, speed: v });
    stepCar(c, ctl(1), 1 / 30, env);
    return c.hp;
  };
  const h10 = hpAfter(10);
  const h20 = hpAfter(20);
  assert.ok(h20 < h10 && h10 < 100, `${h10} ${h20}`);
});

test('살짝 닿은 것(가속을 계속 밟고 벽에 붙어 있기)은 부딪힘·피해가 아니다', () => {
  const env = makeEnv({ polys: [box(-20, 20, 20, 40)] });
  const car = mkCar({ z: 20 - 2.1 - 0.01 });
  let hits = 0;
  run(car, ctl(1), 4, env, 1 / 60, (c, r) => {
    if (r.hit > 0) hits++;
    assert.ok(!insideAny(env, c));
  });
  assert.ok(hits <= 6, '부딪힘 ' + hits + '번');
  assert.ok(car.hp > 95, '내구도 ' + car.hp);
});

test('스침: 비스듬히 벽에 닿으면 벽을 따라 미끄러지고 속력을 대부분 지킨다', () => {
  // x = 6에 남북으로 긴 벽, 차는 북쪽(+z)을 향해 오른쪽… 아니 왼쪽(+x)으로 약간 기울어 달린다
  const env = makeEnv({ polys: [box(6, -50, 30, 400)] });
  const car = mkCar({ x: 3.8, yaw: 0.45, speed: 20 });
  let minHp = 100;
  run(car, ctl(1), 3, env, 1 / 60, (c) => {
    assert.ok(!insideAny(env, c), '벽 안으로 들어갔다');
    assert.ok(c.x <= 6 - 0.95, 'x ' + c.x);
    minHp = Math.min(minHp, c.hp);
  });
  assert.ok(car.z > 40, '벽을 따라 나아가지 못했다: z=' + car.z);
  assert.ok(car.speed > 15, '속력을 너무 잃었다: ' + car.speed);
  assert.ok(Math.abs(wrap(car.yaw)) < 0.2, '벽과 나란해지지 않았다: yaw=' + car.yaw);
  assert.ok(minHp > 60, '스침에 내구도가 너무 많이 줄었다: ' + minHp);
});

test('얇은 벽·기둥: dt 0.2에 최고 속력이어도 뚫지 않는다', () => {
  const thin = makeEnv({ polys: [box(-30, 30, 30, 30.3)] });
  for (const dt of [1 / 60, 0.05, 0.1, 0.2]) {
    const car = mkCar({ speed: 23 });
    run(car, ctl(1), 4, thin, dt, (c) => assert.ok(!insideAny(thin, c) && c.z < 30, `dt ${dt}: z ${c.z}`));
  }
  // 원 기둥(가로등·나무): 두 원 모두 기둥에서 반지름 합 이상 떨어져 있어야 한다
  const posts = makeEnv({ circles: [[0, 15, 0.3]] });
  for (const dt of [1 / 60, 0.2]) {
    const car = mkCar({ speed: 23 });
    run(car, ctl(1), 2, posts, dt, (c) => {
      const s = Math.sin(c.yaw);
      const k = Math.cos(c.yaw);
      for (const m of [1, -1]) assert.ok(Math.hypot(c.x + s * 1.1 * m, c.z + k * 1.1 * m - 15) >= CAR.radius + 0.3 - 1e-6, '기둥을 파고들었다');
    });
    assert.ok(car.z < 15, '기둥 뒤로 넘어갔다: ' + car.z);
  }
});

test('끼인 자리(차 폭보다 좁은 틈): 들어가지 못하고 튕겨 나온다', () => {
  const env = makeEnv({ polys: [box(-20, 10, -0.8, 30), box(0.8, 10, 20, 30)] });
  const car = mkCar();
  run(car, ctl(1), 3, env, 1 / 60, (c) => assert.ok(!insideAny(env, c)));
  assert.ok(car.z < 10, '틈으로 들어갔다: ' + car.z);
});

test('갈 수 있는 땅의 끝: 막히고 튕기지만 내구도는 그대로(보이지 않는 경계)', () => {
  const env = makeEnv({ bounds: [-50, -50, 50, 20] });
  const car = mkCar();
  let edge = false;
  run(car, ctl(1), 4, env, 1 / 60, (c, r) => {
    if (r.edge) edge = true;
    assert.ok(env.playable(c.x, c.z));
    assert.equal(r.hit, 0);
  });
  assert.ok(edge);
  assert.equal(car.hp, 100);
  assert.ok(car.z < 20);
});

// ---------- 옹벽·낙하 ----------
// z 10~10.5에서 3m 솟는 턱(경사 6)
const cliff = (x, z) => (z < 10 ? 0 : z > 10.5 ? 3 : (z - 10) * 6);
test('옹벽(경사 1.6 넘는 턱)은 못 오른다: 느리게 기어가도, 빠르게 달려도', () => {
  const env = makeEnv({ height: cliff });
  for (const v0 of [0, 23]) {
    const car = mkCar({ speed: v0 });
    let hit = 0;
    run(car, ctl(1), 5, env, 1 / 60, (c, r) => {
      hit = Math.max(hit, r.hit);
      assert.ok(c.y < 0.5, '턱 위로 올라갔다: y=' + c.y);
    });
    assert.ok(car.z < 10.2 - CAR.lead + 0.3, '범퍼가 턱을 넘었다: z=' + car.z);
    if (v0 > 0) assert.ok(hit > 10, '빠르게 들이받았는데 부딪힘이 작다: ' + hit);
  }
  // 경사 1.0 비탈은 오른다
  const ramp = makeEnv({ height: (x, z) => Math.max(0, Math.min(3, z - 10)) });
  const car = mkCar();
  run(car, ctl(1), 4, ramp);
  assert.ok(car.z > 20 && Math.abs(car.y - 3) < 1e-6, `경사 1 비탈을 못 올랐다: z ${car.z} y ${car.y}`);
});

test('턱에서 내려가면 공중에 떴다가 내려앉는다(NaN 없이)', () => {
  const env = makeEnv({ height: cliff });
  const car = mkCar({ z: 20, yaw: Math.PI, y: 3 });
  let air = false;
  let landed = 0;
  let impact = 0;
  run(car, ctl(1), 3, env, 1 / 60, (c, r) => {
    assert.ok(finite(c));
    if (c.air) {
      air = true;
      assert.ok(c.y >= env.heightAt(c.x, c.z) - 1e-9, '땅 밑으로 떨어졌다');
    }
    if (r.landed) {
      landed++;
      impact = Math.max(impact, r.impact);
    }
  });
  assert.ok(air, '공중에 뜨지 않았다');
  assert.ok(landed >= 1, '내려앉지 않았다');
  assert.ok(impact > 3, '떨어지는 속력 ' + impact);
  assert.equal(car.air, false);
  near(car.y, 0, 1e-9);
  assert.ok(car.z < 5);
  // 아주 높은 곳에서 떨어지면 내구도가 준다
  const deep = makeEnv({ height: (x, z) => (z < 10 ? 0 : 30) });
  const d = mkCar({ z: 13, yaw: Math.PI, y: 30, speed: 10 });
  run(d, ctl(1), 4, deep);
  assert.ok(d.hp < 100 && d.hp > 0, '30m 낙하 내구도 ' + d.hp);
  near(d.y, 0, 1e-9);
});

// ---------- 이상한 입력 ----------
test('NaN·무한대·빠진 값: 어떤 입력에도 NaN을 만들지 않는다', () => {
  const ctrls = [null, undefined, {}, { throttle: NaN, steer: Infinity, brake: 'x' }, { throttle: -Infinity, steer: NaN }, { throttle: '1', steer: '-1' }, { throttle: 1e9, steer: -1e9 }];
  const dts = [NaN, -1, 0, Infinity, -Infinity, 1e9, '0.016', null, undefined, 1 / 60, 0.2];
  for (const c of ctrls) {
    for (const dt of dts) {
      const car = mkCar({ speed: 7 });
      const r = stepCar(car, c, dt, FLAT);
      assert.ok(finite(car), `ctrl ${JSON.stringify(c)} dt ${dt}`);
      for (const k of ['hit', 'impact', 'hx', 'hz']) assert.ok(Number.isFinite(r[k]), k);
    }
  }
  // 차 값이 망가져 있어도
  const bad = mkCar({ speed: NaN, yaw: NaN, y: NaN, vy: Infinity, hp: NaN, steer: NaN, air: 'yes' });
  run(bad, ctl(1, 1), 1);
  assert.ok(finite(bad), JSON.stringify(bad));
  assert.equal(bad.hp, 100);
  // 위치를 모르면 움직이지 않는다
  const lost = mkCar({ x: NaN });
  const r = stepCar(lost, ctl(1), 0.1, FLAT);
  assert.ok(Number.isNaN(lost.x) && lost.speed === 0 && r.hit === 0);
  // 지면·밀어내기가 NaN을 돌려줘도
  const weird = {
    heightAt: (x, z) => (Math.floor(x + z) % 3 === 0 ? NaN : 0.1 * z),
    playable: () => true,
    solidAt: () => null,
    resolve(p) {
      p.x = NaN;
      return true;
    },
  };
  const w = mkCar();
  run(w, ctl(1, 0.5), 3, weird);
  assert.ok(finite(w), JSON.stringify(w));
  // heightAt만 있는 env, env 없음
  const bare = mkCar();
  run(bare, ctl(1), 1, { heightAt: () => 0 });
  near(bare.speed, 11, 1e-9);
  assert.equal(stepCar(mkCar(), ctl(1), 0.1, null).hit, 0);
  assert.equal(stepCar(null, ctl(1), 0.1, FLAT).hit, 0);
});

test('dt 0~0.2: 결과가 dt에 거의 무관하고, 0이면 아무것도 바뀌지 않으며, 0.2보다 크면 0.2로 친다', () => {
  const dists = [];
  for (const dt of [0.001, 1 / 120, 1 / 60, 1 / 30, 0.05, 0.1, 0.2]) {
    const car = mkCar();
    run(car, ctl(1), 2, FLAT, dt);
    dists.push(car.z);
    near(car.speed, 22, 1e-6, `dt ${dt} 속력`);
  }
  for (const d of dists) near(d, 22, 22 * 0.06, '2초 동안 간 거리');
  const car = mkCar({ speed: 5, z: 3 });
  const before = JSON.stringify(car);
  stepCar(car, ctl(1, 1), 0, FLAT);
  assert.equal(JSON.stringify(car), before);
  const a = mkCar();
  const b = mkCar();
  stepCar(a, ctl(1), 0.2, FLAT);
  stepCar(b, ctl(1), 5, FLAT);
  assert.deepEqual(b, a);
});

test('결과 객체는 하나를 고쳐 쓴다(out을 넘기면 거기에)', () => {
  const r1 = stepCar(mkCar(), ctl(1), 0.1, FLAT);
  const r2 = stepCar(mkCar(), ctl(1), 0.1, FLAT);
  assert.equal(r1, r2);
  const out = {};
  assert.equal(stepCar(mkCar(), ctl(1), 0.1, FLAT, out), out);
  assert.deepEqual(Object.keys(out).sort(), ['edge', 'hit', 'hx', 'hz', 'impact', 'landed']);
});

test('이미 겹친 채로 놓인 차(제자리로 돌아온 주차 차량 등)는 부딪힘 없이 빠져나온다', () => {
  const env = makeEnv({ circles: [[0.3, 1.1, 1.05]] });
  const car = mkCar();
  const r = stepCar(car, ctl(0), 1 / 60, env);
  assert.equal(r.hit, 0);
  assert.equal(car.hp, 100);
  const s = Math.sin(car.yaw);
  const c = Math.cos(car.yaw);
  for (const k of [1, -1]) assert.ok(Math.hypot(car.x + s * 1.1 * k - 0.3, car.z + c * 1.1 * k - 1.1) >= 2.05 - 1e-6);
});

// ---------- 실제 캠퍼스 지형 + 실제 건물 평면 ----------
const campusEnv = makeEnv({ height: campusHeight, polys: data.buildings.map((b) => b.poly) });
test('실제 지형: 가장 가파른 찻길(46.1, -20.8)에서도 입력이 없으면 5초 동안 꼼짝 않는다', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.6]) {
    const car = mkCar({ x: 46.1, z: -20.8, yaw, y: campusHeight(46.1, -20.8) });
    run(car, ctl(0), 5, campusEnv);
    assert.equal(car.speed, 0);
    near(car.x, 46.1, 1e-9);
    near(car.z, -20.8, 1e-9);
  }
});

test('실제 지형: 정문에서 찻길을 따라 언덕을 올라가는 동안 건물 안에 들어가지 않고 NaN이 없다', () => {
  // 정문 아래 찻길(campus-data의 교내 찻길 점들)
  const path = [
    [-6.2, 142.9],
    [-7.1, 136.6],
    [-19.6, 121.4],
    [-23.8, 110.7],
    [-26.8, 102.9],
    [-36.2, 72.1],
    [-42.5, 47.3],
    [-50.3, 35.1],
    [-55.4, 24.5],
    [-54.4, 15.3],
    [-52, 7],
    [-47.4, -0.8],
  ];
  const car = mkCar({ x: -9.6, z: 152.5, yaw: Math.atan2(-6.2 + 9.6, 142.9 - 152.5) });
  car.y = campusHeight(car.x, car.z);
  const y0 = car.y;
  let wp = 0;
  let stuck = 0;
  let back = 0;
  let maxHit = 0;
  const drive = (c) => {
    while (wp < path.length && Math.hypot(path[wp][0] - c.x, path[wp][1] - c.z) < 5) wp++;
    if (wp >= path.length) return ctl(0, 0, true);
    if (back > 0) {
      back--;
      return ctl(-1, 0);
    }
    const d = wrap(Math.atan2(path[wp][0] - c.x, path[wp][1] - c.z) - c.yaw);
    return ctl(Math.abs(d) > 0.8 ? 0.35 : 0.8, Math.max(-1, Math.min(1, d * 2.5)));
  };
  let lastZ = car.z;
  run(car, drive, 40, campusEnv, 1 / 60, (c, r, t) => {
    assert.ok(finite(c), JSON.stringify(c));
    assert.ok(!insideAny(campusEnv, c), `건물 안: ${c.x.toFixed(2)}, ${c.z.toFixed(2)} (${t.toFixed(2)}초)`);
    maxHit = Math.max(maxHit, r.hit);
    if (Math.abs(t * 60 - Math.round(t * 60)) < 1e-6 && Math.round(t * 60) % 120 === 0) {
      if (Math.abs(c.z - lastZ) < 0.5 && wp < path.length) {
        stuck++;
        back = 40;
      }
      lastZ = c.z;
    }
  });
  console.log(`  정문 길: 경유점 ${wp}/${path.length} · 높이 ${y0.toFixed(1)} → ${car.y.toFixed(1)}m · 내구도 ${car.hp.toFixed(0)} · 막힘 ${stuck}번 · 가장 센 충돌 ${maxHit.toFixed(1)}`);
  assert.ok(wp >= 8, '언덕길을 충분히 오르지 못했다: 경유점 ' + wp);
  assert.ok(car.y > y0 + 15, `높이가 충분히 오르지 않았다: ${y0} → ${car.y}`);
});

test('실제 건물: 건물을 향해 여러 방향에서 최고 속력으로 달려도 들어가지 않는다', () => {
  let tries = 0;
  for (const b of data.buildings.slice(0, 40)) {
    // 건물 가운데에서 바깥으로 25m 떨어진 곳에서 가운데를 보고 달린다
    let cx = 0;
    let cz = 0;
    for (const p of b.poly) {
      cx += p[0];
      cz += p[1];
    }
    cx /= b.poly.length;
    cz /= b.poly.length;
    for (const a of [0, 2.1, 4.2]) {
      const sx = cx + Math.sin(a) * 25;
      const sz = cz + Math.cos(a) * 25;
      const car = mkCar({ x: sx, z: sz, yaw: Math.atan2(cx - sx, cz - sz), speed: 23 });
      if (insideAny(campusEnv, car)) continue;
      tries++;
      run(car, ctl(1), 2.5, campusEnv, 1 / 30, (c) => assert.ok(!insideAny(campusEnv, c), `건물 안: ${c.x.toFixed(1)}, ${c.z.toFixed(1)}`));
    }
  }
  assert.ok(tries > 40, '시도 ' + tries);
});
