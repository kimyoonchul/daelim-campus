// 난투 규칙: 무기표와 피해 판정.
// 순수 모듈이다(three·DOM을 쓰지 않는다). Node에서 그대로 시험한다: node tools/test-mayhem.mjs
//
// 규칙 2 — 맞는 쪽이 판정한다. 통신으로 온 피해는 "주장"일 뿐이고, 받은 쪽이 validateHit()으로 걸러
// 통과한 만큼만 자기 체력에 반영한다. 공개 중계라 누구나 아무 메시지나 보낼 수 있다고 보고,
// 빈도는 보낸 사람이 아니라 "나에게 들어온 것 전체"를 기준으로 묶는다(보낸 사람 id는 얼마든지 새로 만들 수 있다).

// 무기 번호 = 배열 위치. 0은 평화(무기 없음).
//   range 사거리(m) · dmg 한 방 피해 · cd 다음 공격까지(초) · knock 최대 피해일 때 넉백 속도(m/s)
//   maxHit 받는 쪽이 한 번에 인정하는 피해 상한 · radius 폭발 반경(m) · bdmg 건물 피해 · speedMul 들고 있을 때 걷는 속도 배율
export const WEAPONS = [
  { id: 'peace', name: '평화', icon: '🤝' },
  { id: 'fist', name: '주먹', icon: '👊', kind: 'melee', range: 2.3, arc: 1.2, dmg: 14, cd: 0.38, knock: 5, maxHit: 16 },
  { id: 'squirt', name: '물총', icon: '💦', kind: 'bullet', range: 45, speed: 55, gravity: 4, dmg: 6, cd: 0.14, knock: 1.2, maxHit: 8 },
  { id: 'rocket', name: '폭죽 바주카', icon: '🎆', kind: 'rocket', range: 110, speed: 38, gravity: 0, dmg: 45, radius: 5, bdmg: 22, cd: 1.1, knock: 9, maxHit: 50 },
  { id: 'cannon', name: '대포', icon: '💣', kind: 'shell', range: 110, gravity: 14, dmg: 80, radius: 9, bdmg: 60, cd: 2.4, knock: 14, maxHit: 85, speedMul: 0.72 },
];
// 차로 들이받기(주장의 w가 'car')
export const CAR_HIT = { range: 6, maxHit: 60, knock: 12 };
export const MAX_HP = 100;
// staleMs: 공격자의 마지막 상태가 이보다 오래됐으면 주장을 받지 않는다 · lockSec: 전투 잠금(초) · maxKnock: 넉백 속도 상한(m/s)
// 공격자별 상한은 8이다(설계서 처음 값 6에서 올림). 주장은 0.4초 묶음으로 와서 1초 창에 묶음이 3개까지 들어가므로,
//   6이면 물총(cd 0.14) 한 사람의 연사 중 4분의 1이 피해 없이 버려진다. 8이면 60Hz에서 전부, 75~165Hz에서 9할 넘게 받아진다.
//   위조 대비의 본체는 보낸 사람과 상관없는 전체 상한(hitsPerSec·dmgPerSec)이다.
export const LIMITS = { hitsPerAttackerPerSec: 8, hitsPerSec: 10, dmgPerSec: 120, staleMs: 3500, lockSec: 6, maxKnock: 16 };

// 거리 판정의 여유: 사거리 + SLACK + 0.5초 동안 공격자가 움직일 수 있는 거리(걸어서 7.8m/s, 차로 23m/s)
const SLACK = 6;
const MOVE_FOOT = 7.8;
const MOVE_CAR = 23;
const BLAST_SLACK = 3; // 폭발 지점과 피해자 사이: 반경 + 이만큼까지
const WINDOW_MS = 1000; // 빈도·피해량을 세는 창
const SWAP_GRACE_MS = LIMITS.lockSec * 1000; // 무기를 바꾼 뒤에도 이 시간 동안은 직전 무기의 주장을 받아 준다(날아가던 탄)
// 대포알 비행시간: 수평거리 ÷ 26, 0.8~3.2초
const SHELL_PER_SEC = 26;
const SHELL_T_MIN = 0.8;
const SHELL_T_MAX = 3.2;

/** 주장의 w(정수 1~4 또는 'car')에 해당하는 판정표. 그 밖의 값이면 null */
export function hitSpec(w) {
  if (w === 'car') return CAR_HIT;
  if (Number.isInteger(w) && w >= 1 && w < WEAPONS.length) return WEAPONS[w];
  return null;
}

/** 공격자와 맞은 사람 사이에 인정하는 최대 거리(m). inCar는 공격자가 차에 타고 있는지 */
export function reach(w, inCar = false) {
  const s = hitSpec(w);
  return s ? s.range + SLACK + 0.5 * (inCar ? MOVE_CAR : MOVE_FOOT) : 0;
}

function refuse(out, reason) {
  out.reason = reason;
  return out;
}

/**
 * 맞았다는 주장 하나를 검사한다.
 *   victim   { armed, ko, invuln, hidden, zone, x, z } — 나(맞는 쪽)
 *   attacker { id, known, wpn, prevWpn, wpnChangedAt, zone, x, z, car, ko, stateAt } — 보간값이 아니라
 *            마지막으로 받은 원본 상태와 그것을 받은 시각(ms). zone은 내부 구역 id. 모르는 사람이면 null이거나 known이 false
 *   msg      { d, w, x, z } — w는 정수 1~4 또는 'car', (x, z)는 맞은 자리(폭발 무기는 터진 자리)
 *   recent   최근에 받아들인 주장들 [{ t, d, from }] (모든 공격자). 1초가 지난 것은 여기서 걸러 내므로 그대로 넘겨도 된다
 *   now      지금 시각(ms). stateAt·wpnChangedAt·recent[].t와 같은 시계여야 한다
 *   combatZones 무기를 들 수 있는 구역 id 목록(null이면 모든 구역)
 * 돌려주는 값 { ok, d, kx, kz, reason }: d는 받아들인 피해, (kx, kz)는 넉백 속도(m/s), reason은 거부한 까닭.
 * 받아들였으면 부르는 쪽이 recent에 { t: now, d, from: attacker.id }를 더해야 한다.
 * out을 넘기면 새 객체를 만들지 않고 거기에 적는다.
 */
export function validateHit({ victim, attacker, msg, recent, now, combatZones = null }, out = {}) {
  out.ok = false;
  out.d = 0;
  out.kx = 0;
  out.kz = 0;
  out.reason = '';
  if (!victim || !msg || !Number.isFinite(now)) return refuse(out, 'bad');
  // 규칙 1 — 무기를 안 들면 무적. 기절·깨어난 직후·가려진 탭도 맞지 않는다
  if (!victim.armed) return refuse(out, 'peace');
  if (victim.ko) return refuse(out, 'ko');
  if (victim.invuln) return refuse(out, 'invuln');
  if (victim.hidden) return refuse(out, 'hidden');
  if (!attacker || !attacker.known) return refuse(out, 'unknown');
  if (attacker.ko) return refuse(out, 'attacker-ko');
  if (!(now - attacker.stateAt <= LIMITS.staleMs)) return refuse(out, 'stale');
  if (attacker.zone !== victim.zone) return refuse(out, 'zone');
  if (combatZones && !combatZones.includes(victim.zone)) return refuse(out, 'zone');

  const w = msg.w;
  const spec = hitSpec(w);
  if (!spec) return refuse(out, 'weapon');
  if (w === 'car') {
    if (!(attacker.car >= 0)) return refuse(out, 'car');
  } else if (w !== attacker.wpn && !(w === attacker.prevWpn && now - attacker.wpnChangedAt <= SWAP_GRACE_MS)) {
    // 지금 든 무기도, 방금까지 들던 무기도 아니다
    return refuse(out, 'weapon');
  }
  if (!Number.isFinite(msg.d) || msg.d < 1) return refuse(out, 'amount');
  if (!Number.isFinite(msg.x) || !Number.isFinite(msg.z)) return refuse(out, 'pos');
  if (!Number.isFinite(victim.x) || !Number.isFinite(victim.z) || !Number.isFinite(attacker.x) || !Number.isFinite(attacker.z)) return refuse(out, 'pos');

  // 거리: 공격자가 그 무기로 닿을 수 있는 곳에 있어야 하고, 폭발 무기는 터진 자리가 내 곁이어야 한다
  const ax = victim.x - attacker.x;
  const az = victim.z - attacker.z;
  const lim = reach(w, attacker.car >= 0);
  if (ax * ax + az * az > lim * lim) return refuse(out, 'range');
  const blast = spec.radius > 0;
  const bx = victim.x - msg.x;
  const bz = victim.z - msg.z;
  if (blast) {
    const r = spec.radius + BLAST_SLACK;
    if (bx * bx + bz * bz > r * r) return refuse(out, 'blast');
  }

  // 양: 최근 1초에 받아들인 횟수(이 공격자·전체)와 피해 합
  let all = 0;
  let mine = 0;
  let sum = 0;
  if (recent) {
    for (let i = 0; i < recent.length; i++) {
      const e = recent[i];
      if (!e || !(now - e.t < WINDOW_MS)) continue;
      all++;
      sum += e.d;
      if (e.from === attacker.id) mine++;
    }
  }
  if (mine >= LIMITS.hitsPerAttackerPerSec) return refuse(out, 'flood-attacker');
  if (all >= LIMITS.hitsPerSec) return refuse(out, 'flood');
  let d = Math.min(msg.d, spec.maxHit);
  const left = LIMITS.dmgPerSec - sum;
  if (d > left) d = left; // 넘치면 남은 만큼만
  if (!(d >= 1)) return refuse(out, 'cap');

  // 넉백: 폭발은 터진 자리에서, 그 밖은 공격자가 있는 곳에서 밀려난다. 세기는 받아들인 피해에 비례
  const kx = blast ? bx : ax;
  const kz = blast ? bz : az;
  const len = Math.hypot(kx, kz);
  const k = Math.min(LIMITS.maxKnock, spec.knock * (d / spec.maxHit));
  out.ok = true;
  out.d = d;
  out.kx = len > 1e-6 ? (kx / len) * k : k; // 같은 자리면 +x 쪽으로
  out.kz = len > 1e-6 ? (kz / len) * k : 0;
  return out;
}

/**
 * 대포알의 처음 속도. 고정 속도가 아니라 비행시간으로 구한다:
 *   T = clamp(수평거리 ÷ 26, 0.8, 3.2) · 수평 속도 = 거리 ÷ T · vy = (높이차 + g·T²/2) ÷ T
 * (dx, dy, dz)는 포구에서 겨냥점까지의 차이. 수평거리는 사거리로 자른다(방향은 그대로).
 * 돌려주는 값 { vx, vy, vz, t, dist }: t는 비행시간(초), dist는 잘라 낸 수평거리. 숫자가 아닌 입력은 0으로 친다.
 */
export function shellLaunch(dx, dy, dz, spec = WEAPONS[4], out = {}) {
  if (!Number.isFinite(dx)) dx = 0;
  if (!Number.isFinite(dz)) dz = 0;
  if (!Number.isFinite(dy)) dy = 0;
  dy = Math.max(-300, Math.min(300, dy));
  let dist = Math.hypot(dx, dz);
  let ux = 0;
  let uz = 0;
  if (dist > 1e-6 && dist !== Infinity) {
    ux = dx / dist;
    uz = dz / dist;
  } else dist = 0;
  if (dist > spec.range) dist = spec.range;
  const t = Math.max(SHELL_T_MIN, Math.min(SHELL_T_MAX, dist / SHELL_PER_SEC));
  const vh = dist / t;
  out.vx = ux * vh;
  out.vy = (dy + 0.5 * spec.gravity * t * t) / t;
  out.vz = uz * vh;
  out.t = t;
  out.dist = dist;
  return out;
}
