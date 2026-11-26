// 난투 규칙과 발신 제한 점검: node tools/test-mayhem.mjs
// 순수 모듈(src/mayhem/rules.js, src/net/limiter.js)만 불러 Node에서 그대로 돌린다. 하나라도 실패하면 종료 코드 1.
// 검사를 덧붙일 때는 맨 아래처럼 test('이름', () => { assert… })를 더 쓰면 된다(요약은 끝날 때 자동으로 찍힌다).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WEAPONS, CAR_HIT, MAX_HP, LIMITS, validateHit, reach, hitSpec, shellLaunch } from '../src/mayhem/rules.js';
import { createLimiter } from '../src/net/limiter.js';
import { GAME, ZONES, PLAYER, NET } from '../src/config.js';

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
  console.log(failed ? `실패 ${failed}건 · 통과 ${passed}건` : `모두 통과 (${passed}건)`);
  if (failed && !code) process.exitCode = 1;
});

// ---------- rules.validateHit ----------
const NOW = 500000; // 시험용 "지금"(ms)
const mkVictim = (o) => ({ armed: true, ko: false, invuln: false, hidden: false, zone: 'campus', x: 0, z: 0, ...o });
const mkAttacker = (o) => ({ id: 'attacker1', known: true, wpn: 1, prevWpn: 0, wpnChangedAt: NOW - 60000, zone: 'campus', x: 1.5, z: 0, car: -1, ko: false, stateAt: NOW - 100, ...o });
/** 기본은 "1.5m 옆에서 주먹으로 14를 때렸다". 바꿀 것만 넘긴다 */
function hit(o = {}) {
  return validateHit({
    victim: mkVictim(o.victim),
    attacker: o.attacker === null ? null : mkAttacker(o.attacker),
    msg: { d: 14, w: 1, x: 0, z: 0, ...o.msg },
    recent: o.recent || [],
    now: NOW,
    combatZones: 'combatZones' in o ? o.combatZones : ['campus'],
  });
}
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('무기표가 설계서와 같다', () => {
  assert.deepEqual(
    WEAPONS.map((w) => w.id),
    ['peace', 'fist', 'squirt', 'rocket', 'cannon'],
  );
  assert.deepEqual([WEAPONS[1].range, WEAPONS[1].dmg, WEAPONS[1].cd, WEAPONS[1].knock, WEAPONS[1].maxHit], [2.3, 14, 0.38, 5, 16]);
  assert.deepEqual([WEAPONS[2].range, WEAPONS[2].speed, WEAPONS[2].gravity, WEAPONS[2].dmg, WEAPONS[2].cd, WEAPONS[2].maxHit], [45, 55, 4, 6, 0.14, 8]);
  assert.deepEqual([WEAPONS[3].range, WEAPONS[3].speed, WEAPONS[3].dmg, WEAPONS[3].radius, WEAPONS[3].bdmg, WEAPONS[3].maxHit], [110, 38, 45, 5, 22, 50]);
  assert.deepEqual([WEAPONS[4].range, WEAPONS[4].gravity, WEAPONS[4].dmg, WEAPONS[4].radius, WEAPONS[4].bdmg, WEAPONS[4].maxHit, WEAPONS[4].speedMul], [110, 14, 80, 9, 60, 85, 0.72]);
  assert.deepEqual(CAR_HIT, { range: 6, maxHit: 60, knock: 12 });
  assert.equal(MAX_HP, 100);
  assert.deepEqual(LIMITS, { hitsPerAttackerPerSec: 8, hitsPerSec: 10, dmgPerSec: 120, staleMs: 3500, lockSec: 6, maxKnock: 16 });
  assert.equal(hitSpec(1), WEAPONS[1]);
  assert.equal(hitSpec('car'), CAR_HIT);
  for (const w of [0, 5, -1, 2.5, '1', null, undefined, NaN, 'boss']) assert.equal(hitSpec(w), null);
});

test('정상: 주먹 한 방은 그대로 받고, 공격자 반대쪽으로 밀린다', () => {
  const r = hit();
  assert.equal(r.ok, true);
  assert.equal(r.d, 14);
  assert.equal(r.reason, '');
  // 공격자(1.5, 0) → 나(0, 0): -x 방향. 세기 = knock 5 × 14 ÷ 16
  near(r.kx, -5 * (14 / 16));
  near(r.kz, 0);
});

test('평화 상태인 피해자는 맞지 않는다(규칙 1)', () => {
  const r = hit({ victim: { armed: false } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'peace');
  assert.equal(r.d, 0);
  assert.equal(r.kx, 0);
  assert.equal(r.kz, 0);
  // 아무리 그럴듯한 주장이어도 마찬가지
  assert.equal(hit({ victim: { armed: false }, attacker: { wpn: 4 }, msg: { d: 80, w: 4 } }).ok, false);
});

test('기절·무적·가려진 탭인 피해자는 맞지 않는다', () => {
  assert.equal(hit({ victim: { ko: true } }).reason, 'ko');
  assert.equal(hit({ victim: { invuln: true } }).reason, 'invuln');
  assert.equal(hit({ victim: { hidden: true } }).reason, 'hidden');
});

test('모르는 공격자·기절한 공격자·오래된 상태는 거부', () => {
  assert.equal(hit({ attacker: null }).reason, 'unknown');
  assert.equal(hit({ attacker: { known: false } }).reason, 'unknown');
  assert.equal(hit({ attacker: { ko: true } }).reason, 'attacker-ko');
  assert.equal(hit({ attacker: { stateAt: NOW - LIMITS.staleMs - 1 } }).reason, 'stale');
  assert.equal(hit({ attacker: { stateAt: NOW - LIMITS.staleMs } }).ok, true);
  assert.equal(hit({ attacker: { stateAt: -1e9 } }).reason, 'stale'); // 상태를 받은 적이 없는 사람
  assert.equal(hit({ attacker: { stateAt: NaN } }).reason, 'stale');
});

test('다른 구역·무장할 수 없는 구역은 거부', () => {
  assert.equal(hit({ attacker: { zone: 'js4' } }).reason, 'zone');
  assert.equal(hit({ victim: { zone: 'js4' } }).reason, 'zone');
  // 둘 다 실내에 있어도 그곳이 전투 구역이 아니면 거부
  assert.equal(hit({ victim: { zone: 'js4' }, attacker: { zone: 'js4' } }).reason, 'zone');
  // combatZones가 null이면 어디서나
  assert.equal(hit({ victim: { zone: 'js4' }, attacker: { zone: 'js4' }, combatZones: null }).ok, true);
});

test('사거리 밖의 주장은 거부', () => {
  const lim = reach(1); // 2.3 + 6 + 0.5 × 7.8
  near(lim, 12.2, 1e-9);
  assert.equal(hit({ attacker: { x: lim - 0.01 } }).ok, true);
  assert.equal(hit({ attacker: { x: lim + 0.01 } }).reason, 'range');
  assert.equal(hit({ attacker: { x: 200, z: 150 } }).reason, 'range');
  // 물총 45m, 대포 110m
  assert.equal(hit({ attacker: { wpn: 2, x: 54 }, msg: { w: 2, d: 6 } }).ok, true);
  assert.equal(hit({ attacker: { wpn: 2, x: 56 }, msg: { w: 2, d: 6 } }).reason, 'range');
  assert.equal(hit({ attacker: { wpn: 4, x: 119 }, msg: { w: 4, d: 80 } }).ok, true);
  assert.equal(hit({ attacker: { wpn: 4, x: 121 }, msg: { w: 4, d: 80 } }).reason, 'range');
});

test('폭발 무기는 터진 자리가 내 곁이어야 한다', () => {
  // 폭죽: 반경 5 + 3
  assert.equal(hit({ attacker: { wpn: 3, x: 40 }, msg: { w: 3, d: 45, x: 7.9, z: 0 } }).ok, true);
  assert.equal(hit({ attacker: { wpn: 3, x: 40 }, msg: { w: 3, d: 45, x: 8.1, z: 0 } }).reason, 'blast');
  // 대포: 반경 9 + 3
  assert.equal(hit({ attacker: { wpn: 4, x: 40 }, msg: { w: 4, d: 80, x: 0, z: 11.9 } }).ok, true);
  assert.equal(hit({ attacker: { wpn: 4, x: 40 }, msg: { w: 4, d: 80, x: 0, z: 12.1 } }).reason, 'blast');
  // 주먹·물총은 맞은 자리를 따지지 않는다
  assert.equal(hit({ msg: { x: 90, z: 90 } }).ok, true);
});

test('폭발의 넉백은 터진 자리에서 바깥으로', () => {
  const r = hit({ attacker: { wpn: 4, x: 60, z: 0 }, msg: { w: 4, d: 85, x: 0, z: -4 } });
  assert.equal(r.ok, true);
  near(r.kx, 0);
  near(r.kz, 14); // 터진 자리 (0,-4) → 나 (0,0): +z, 최대 피해라 knock 14 그대로
  // 절반 피해면 넉백도 절반
  const h = hit({ attacker: { wpn: 4, x: 60, z: 0 }, msg: { w: 4, d: 42.5, x: 3, z: 0 } });
  near(h.kx, -7);
  near(h.kz, 0);
});

test('같은 자리에서 맞으면 +x로 밀린다(0으로 나누지 않는다)', () => {
  const r = hit({ attacker: { x: 0, z: 0 } });
  assert.equal(r.ok, true);
  near(r.kx, 5 * (14 / 16));
  assert.equal(r.kz, 0);
  const b = hit({ attacker: { wpn: 3, x: 30 }, msg: { w: 3, d: 50, x: 0, z: 0 } });
  near(b.kx, 9);
  assert.equal(b.kz, 0);
});

test('과대 피해는 무기별 상한으로 자른다', () => {
  assert.equal(hit({ msg: { d: 9999 } }).d, 16);
  assert.equal(hit({ attacker: { wpn: 2 }, msg: { w: 2, d: 9999 } }).d, 8);
  assert.equal(hit({ attacker: { wpn: 3 }, msg: { w: 3, d: 9999 } }).d, 50);
  const c = hit({ attacker: { wpn: 4 }, msg: { w: 4, d: 1e12 } });
  assert.equal(c.d, 85);
  assert.ok(Math.hypot(c.kx, c.kz) <= LIMITS.maxKnock + 1e-9);
  assert.ok(c.d < MAX_HP); // 어떤 한 방도 가득 찬 체력을 한 번에 비우지 못한다
});

test('피해량·좌표가 숫자가 아니거나 1 미만이면 거부', () => {
  for (const d of [NaN, Infinity, -Infinity, -5, 0, 0.99, '14', null, undefined]) assert.equal(hit({ msg: { d } }).reason, 'amount', String(d));
  assert.equal(hit({ msg: { d: 1 } }).ok, true);
  for (const v of [NaN, Infinity, '0', null, undefined]) {
    assert.equal(hit({ msg: { x: v } }).reason, 'pos');
    assert.equal(hit({ msg: { z: v } }).reason, 'pos');
  }
  assert.equal(hit({ attacker: { x: NaN } }).reason, 'pos');
  assert.equal(hit({ victim: { z: NaN } }).reason, 'pos');
});

test('무기 불일치: 지금 든 무기도 방금 들던 무기도 아니면 거부', () => {
  // 주먹을 든 사람이 대포로 맞혔다고 주장
  assert.equal(hit({ attacker: { wpn: 1, prevWpn: 2 }, msg: { w: 4, d: 80 } }).reason, 'weapon');
  // 방금(3초 전)까지 대포를 들고 있었다면 날아가던 포탄이다
  assert.equal(hit({ attacker: { wpn: 1, prevWpn: 4, wpnChangedAt: NOW - 3000 }, msg: { w: 4, d: 80 } }).ok, true);
  // 바꾼 지 6초가 넘었으면 거부
  assert.equal(hit({ attacker: { wpn: 1, prevWpn: 4, wpnChangedAt: NOW - 6001 }, msg: { w: 4, d: 80 } }).reason, 'weapon');
  // 평화 상태인 사람의 주장
  assert.equal(hit({ attacker: { wpn: 0, prevWpn: 0 } }).reason, 'weapon');
  // 없는 무기 번호
  for (const w of [0, 5, 1.5, -1, '1', null, undefined, 'fist']) assert.equal(hit({ msg: { w } }).reason, 'weapon', String(w));
});

test("차로 들이받기('car')는 공격자가 차에 타고 있을 때만", () => {
  assert.equal(hit({ attacker: { car: -1 }, msg: { w: 'car', d: 30 } }).reason, 'car');
  const r = hit({ attacker: { car: 3, x: 4 }, msg: { w: 'car', d: 999 } });
  assert.equal(r.ok, true);
  assert.equal(r.d, CAR_HIT.maxHit);
  near(r.kx, -CAR_HIT.knock);
  // 닿는 거리: 6 + 6 + 0.5 × 23 = 23.5
  near(reach('car', true), 23.5);
  assert.equal(hit({ attacker: { car: 3, x: 23.4 }, msg: { w: 'car', d: 30 } }).ok, true);
  assert.equal(hit({ attacker: { car: 3, x: 23.6 }, msg: { w: 'car', d: 30 } }).reason, 'range');
  // 차에 탄 공격자는 무기 사거리도 그만큼 더 봐준다
  near(reach(1, true) - reach(1, false), 0.5 * (23 - 7.8));
});

test('도배: 같은 공격자의 주장은 1초에 8번까지만', () => {
  const recent = [];
  let ok = 0;
  for (let i = 0; i < 40; i++) {
    const r = validateHit({ victim: mkVictim(), attacker: mkAttacker({ wpn: 2 }), msg: { d: 6, w: 2, x: 0, z: 0 }, recent, now: NOW + i * 10, combatZones: ['campus'] });
    if (r.ok) {
      ok++;
      recent.push({ t: NOW + i * 10, d: r.d, from: 'attacker1' });
    } else assert.equal(r.reason, 'flood-attacker');
  }
  assert.equal(ok, LIMITS.hitsPerAttackerPerSec);
  // 1초가 지나면 다시 받는다
  assert.equal(validateHit({ victim: mkVictim(), attacker: mkAttacker({ wpn: 2 }), msg: { d: 6, w: 2, x: 0, z: 0 }, recent, now: NOW + 1001, combatZones: null }).ok, true);
});

test('도배: 공격자 id를 바꿔 가며 보내도 전체 1초에 10번까지만', () => {
  const recent = [];
  let ok = 0;
  for (let i = 0; i < 60; i++) {
    const id = 'forged' + i; // 매번 새 사람인 척
    const r = validateHit({ victim: mkVictim(), attacker: mkAttacker({ id, wpn: 2 }), msg: { d: 6, w: 2, x: 0, z: 0 }, recent, now: NOW + i, combatZones: ['campus'] });
    if (r.ok) {
      ok++;
      recent.push({ t: NOW + i, d: r.d, from: id });
    } else assert.equal(r.reason, 'flood');
  }
  assert.equal(ok, LIMITS.hitsPerSec);
});

test('물총 연사(쿨다운 0.14초, 60fps)를 0.4초 묶음으로 받으면 거의 다 받고, 한 공격자에게서는 어느 1초에도 8건까지만 받는다', () => {
  const recent = [];
  const cd = WEAPONS[2].cd;
  const FPS = 60;
  let ready = 0;
  let lastFlush = -Infinity;
  let pending = 0;
  let shots = 0;
  const okAt = [];
  for (let f = 0; f <= FPS * 6; f++) {
    const t = f / FPS;
    // 쿨다운이 끝난 첫 프레임에 쏜다(무기 모듈과 같다)
    if (t >= ready - 1e-9) {
      ready = t + cd;
      shots++;
      pending++;
    }
    // 주장은 쌓인 것이 있을 때 0.4초에 한 묶음으로 간다(index.js의 flushFx와 같다 — 첫 주장은 바로)
    if (pending > 0 && t - lastFlush >= 0.4 - 1e-9) {
      lastFlush = t;
      const now = NOW + t * 1000;
      for (; pending > 0; pending--) {
        const r = validateHit({ victim: mkVictim(), attacker: mkAttacker({ wpn: 2, x: 20, stateAt: now }), msg: { d: 6, w: 2, x: 0, z: 0 }, recent, now, combatZones: ['campus'] });
        if (r.ok) {
          okAt.push(now);
          recent.push({ t: now, d: r.d, from: 'attacker1' });
        } else assert.equal(r.reason, 'flood-attacker');
      }
    }
  }
  assert.ok(shots > 6 * 6, '쏜 수 ' + shots);
  for (let i = 0; i < okAt.length; i++) {
    let n = 0;
    for (let j = i; j < okAt.length && okAt[j] - okAt[i] < 1000; j++) n++;
    assert.ok(n <= LIMITS.hitsPerAttackerPerSec, `1초에 ${n}건을 받았다`);
  }
  // 상한 8이면 60fps에서 묶음이 와도 9할 넘게 받는다(6이면 4분의 3쯤 — rules.js의 LIMITS 주석)
  assert.ok(okAt.length >= shots * 0.9, `쏜 ${shots}발 중 ${okAt.length}발만 받았다`);
});

test('도배: 받아들이는 피해는 1초에 120까지만(넘치면 남은 만큼만)', () => {
  const recent = [];
  const got = [];
  for (let i = 0; i < 8; i++) {
    const id = 'gunner' + i;
    const r = validateHit({ victim: mkVictim(), attacker: mkAttacker({ id, wpn: 4, x: 50 }), msg: { d: 9999, w: 4, x: 1, z: 1 }, recent, now: NOW + i, combatZones: ['campus'] });
    if (r.ok) {
      got.push(r.d);
      recent.push({ t: NOW + i, d: r.d, from: id });
    } else assert.equal(r.reason, 'cap');
  }
  assert.deepEqual(got, [85, 35]);
  // 남은 만큼만 받은 주장은 넉백도 그만큼 약하다
  const part = validateHit({ victim: mkVictim(), attacker: mkAttacker({ id: 'x', wpn: 4, x: 50 }), msg: { d: 85, w: 4, x: 3, z: 0 }, recent: [{ t: NOW, d: 100, from: 'y' }], now: NOW, combatZones: null });
  assert.equal(part.d, 20);
  near(Math.hypot(part.kx, part.kz), 14 * (20 / 85));
  // 남은 몫이 1 미만이면 거부
  assert.equal(validateHit({ victim: mkVictim(), attacker: mkAttacker(), msg: { d: 14, w: 1, x: 0, z: 0 }, recent: [{ t: NOW, d: 119.5, from: 'y' }], now: NOW, combatZones: null }).reason, 'cap');
});

test('recent의 오래된 기록은 세지 않고, out 객체를 넘기면 거기에 적는다', () => {
  const old = [];
  for (let i = 0; i < 30; i++) old.push({ t: NOW - 1000 - i, d: 85, from: 'attacker1' });
  assert.equal(hit({ recent: old }).ok, true);
  const out = { ok: true, d: 77, kx: 9, kz: 9, reason: 'x' };
  const r = validateHit({ victim: mkVictim({ armed: false }), attacker: mkAttacker(), msg: { d: 14, w: 1, x: 0, z: 0 }, recent: [], now: NOW }, out);
  assert.equal(r, out);
  assert.deepEqual(out, { ok: false, d: 0, kx: 0, kz: 0, reason: 'peace' });
  // 인자가 빠져도 예외 없이 거부한다
  assert.equal(validateHit({ victim: null, attacker: null, msg: null, recent: null, now: NOW }).ok, false);
  assert.equal(validateHit({ victim: mkVictim(), attacker: mkAttacker(), msg: { d: 14, w: 1, x: 0, z: 0 }, now: NaN }).ok, false);
  assert.equal(validateHit({ victim: mkVictim(), attacker: mkAttacker(), msg: { d: 14, w: 1, x: 0, z: 0 }, now: NOW }).ok, true);
});

// ---------- rules.shellLaunch (대포알의 처음 속도) ----------
test('대포알: 비행시간 방식으로 겨냥점에 떨어진다', () => {
  const g = WEAPONS[4].gravity;
  for (const [dx, dy, dz] of [
    [30, 0, 40],
    [5, 2, 0],
    [0, -12, 80],
    [-60, 25, -60],
    [100, 0, 0],
  ]) {
    const v = shellLaunch(dx, dy, dz);
    const dist = Math.hypot(dx, dz);
    near(v.t, Math.max(0.8, Math.min(3.2, dist / 26)));
    // t초 뒤의 위치 = 겨냥점
    near(v.vx * v.t, dx, 1e-9);
    near(v.vz * v.t, dz, 1e-9);
    near(v.vy * v.t - 0.5 * g * v.t * v.t, dy, 1e-9);
  }
});

test('대포알: 사거리로 자르고, 이상한 입력에도 NaN이 없다', () => {
  const far = shellLaunch(3000, 0, 4000);
  near(far.dist, WEAPONS[4].range);
  near(far.t, 3.2);
  near(Math.hypot(far.vx, far.vz) * far.t, WEAPONS[4].range, 1e-9);
  near(far.vx / far.vz, 3 / 4, 1e-9); // 방향은 그대로
  for (const a of [
    [0, 0, 0],
    [NaN, 0, 0],
    [0, NaN, 5],
    [Infinity, 0, 0],
    [1e308, 0, 1e308],
    [0, 1e9, 3],
    [undefined, undefined, undefined],
  ]) {
    const v = shellLaunch(a[0], a[1], a[2]);
    for (const k of ['vx', 'vy', 'vz', 't', 'dist']) assert.ok(Number.isFinite(v[k]), `${k} (${a.join(',')})`);
    assert.ok(v.t >= 0.8 && v.t <= 3.2);
  }
  const zero = shellLaunch(0, 0, 0);
  assert.equal(zero.vx, 0);
  assert.equal(zero.vz, 0);
  near(zero.vy, 0.5 * WEAPONS[4].gravity * 0.8); // 제자리에서 0.8초 떴다 떨어진다
  const out = {};
  assert.equal(shellLaunch(1, 2, 3, WEAPONS[4], out), out);
});

// ---------- net/limiter (발신 예산: 초당 8건 = 상태 5 + 이벤트류 3) ----------
test('limiter: 상태 5 + 이벤트 3 = 8을 넘지 않는다', () => {
  const lim = createLimiter();
  let s = 0;
  let e = 0;
  // 1초 동안: 상태는 0.2초마다, 이벤트는 0.1초마다 시도
  for (let t = 0; t < 1000; t += 50) {
    if (t % 200 === 0 && lim.take('s', t)) s++;
    if (t % 100 === 0 && lim.take('e', t)) e++;
    assert.ok(lim.count(t) <= 8);
  }
  assert.equal(s, 5);
  assert.equal(e, 3);
  assert.equal(lim.count(999), 8);
  // 꽉 찬 뒤에는 어느 쪽도 못 나간다
  assert.equal(lim.take('s', 999), false);
  assert.equal(lim.take('e', 999), false);
  assert.equal(lim.count(999), 8);
});

test('limiter: 이벤트만 몰려도 초당 3건', () => {
  const lim = createLimiter();
  let e = 0;
  for (let t = 0; t < 1000; t += 10) if (lim.take('e', t)) e++;
  assert.equal(e, 3);
  assert.equal(lim.count(999), 3);
  // 이벤트가 먼저 몰려와도 상태 5건은 그대로 나간다
  let s = 0;
  for (let t = 990; t < 1000; t++) if (lim.take('s', t)) s++;
  assert.equal(s, 5);
  assert.equal(lim.count(999), 8);
});

test('limiter: 상태만 몰리면 8건, 1초가 지나면 칸이 다시 빈다', () => {
  const lim = createLimiter();
  let s = 0;
  for (let i = 0; i < 20; i++) if (lim.take('s', i)) s++;
  assert.equal(s, 8);
  assert.equal(lim.take('s', 999), false);
  assert.equal(lim.take('s', 1000), true); // t=0에 쓴 칸이 딱 1초 뒤에 빈다
  assert.equal(lim.count(1000), 8);
  assert.equal(lim.count(5000), 0);
});

test('limiter: 어느 1초 구간을 잘라도 8건·이벤트 3건 이하(10초 난사)', () => {
  const lim = createLimiter();
  const sent = []; // [시각, 종류]
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let t = 0; t < 10000; t += 1 + Math.floor(rnd() * 12)) {
    const kind = rnd() < 0.5 ? 's' : 'e';
    if (lim.take(kind, t)) sent.push([t, kind]);
  }
  assert.ok(sent.length > 70);
  for (let i = 0; i < sent.length; i++) {
    let all = 0;
    let ev = 0;
    for (let j = i; j < sent.length && sent[j][0] - sent[i][0] < 1000; j++) {
      all++;
      if (sent[j][1] === 'e') ev++;
    }
    assert.ok(all <= 8, `1초에 ${all}건`);
    assert.ok(ev <= 3, `1초에 이벤트 ${ev}건`);
  }
});

// ---------- 여러 파일에 따로 적어 둔 값이 서로 맞는지 ----------
const readSrc = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
/** 소스에서 "const 이름 = 숫자"를 찾아 그 숫자를 돌려준다 */
function constIn(rel, name) {
  const m = new RegExp('const ' + name + ' = ([0-9.]+)').exec(readSrc(rel));
  assert.ok(m, `${rel}에서 ${name}을(를) 찾지 못했다`);
  return Number(m[1]);
}

test('설정: 전투 구역·깨어나는 구역이 ZONES에 있고, 발신 주기가 예산(상태 초당 5건)과 맞는다', () => {
  for (const z of GAME.combatZones || []) assert.ok(Object.hasOwn(ZONES, z), `combatZones의 ${z}`);
  assert.ok(Object.hasOwn(ZONES, GAME.respawn.zone));
  assert.ok(typeof GAME.respawn.sign === 'string' && GAME.respawn.out > 3.3, '깨어나는 자리는 스탬프 판정 상자(±2.3m) 밖이어야 한다');
  assert.ok(typeof GAME.storeKey === 'string' && GAME.storeKey);
  assert.ok(NET.sendHz <= 5);
  assert.equal(new Set(Object.values(ZONES)).size, Object.keys(ZONES).length, '구역 코드가 겹친다');
});

test('거리 여유에 쓰는 걷는 속도가 설정의 달리기 속도와 같다', () => {
  near(reach(1) - WEAPONS[1].range - 6, 0.5 * PLAYER.run, 1e-9);
});

test('다른 파일에 따로 적어 둔 상수가 rules.js와 같다', () => {
  assert.equal(constIn('src/player/local.js', 'MAX_KNOCK'), LIMITS.maxKnock);
  assert.equal(constIn('src/player/avatar.js', 'HP_FULL'), MAX_HP);
  assert.equal(constIn('src/ui/ui.js', 'HP_MAX'), MAX_HP);
});

test('index.html의 무기 막대가 무기표와 같다(번호·이름·아이콘)', () => {
  const html = readSrc('index.html');
  const found = [...html.matchAll(/<button[^>]*data-wpn="(\d+)"[^>]*data-name="([^"]*)"[^>]*><span>([^<]*)<\/span>/g)].map((m) => [Number(m[1]), m[2], m[3]]);
  assert.deepEqual(
    found,
    WEAPONS.map((w, i) => [i, w.name, w.icon]),
  );
});

// ---------- (차량 모듈이 carstep 검사를 여기 아래에 덧붙인다) ----------
// 자동차 움직임(carstep.js) 검사는 따로 node tools/test-carstep.mjs로도 돌릴 수 있다. 실패하면 이 실행의 종료 코드도 1이 된다.
await import('./test-carstep.mjs');
