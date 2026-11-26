// 난투(mayhem) 본체: 무기 선택·체력·기절·전투 잠금을 맡고, 피해 주장을 주고받으며, 하위 모듈(무기·파괴·차량·보스)을 묶는다.
//   규칙 1 — 무기를 안 들면(평화) 무적이다. 피해·넉백·감속 어느 것도 받지 않는다.
//   규칙 2 — 맞는 쪽이 판정한다. 통신으로 온 피해는 주장일 뿐이고 rules.validateHit을 통과한 만큼만 내 체력에 반영한다.
// 시간 기준: 잠금·기절·회복 같은 게임 타이머는 engine.time(초), 통신으로 받은 것의 빈도 제한과 묶음 전송 간격은 performance.now()(ms).
// 발사 자체(탄·조준)는 weapons.js 몫이다. 여기서는 공격 횟수 기록(bumpAtk)과 맞혔다는 주장의 전송·수신만 한다.
import * as rules from './rules.js';
import { createGfx } from './gfx.js';
import { createWeapons } from './weapons.js';
import { createDestruct } from './destruct.js';
import { createVehicles } from './vehicles.js';
import { createBoss } from './boss.js';
import { GAME, PLAYER, SPAWN } from '../config.js';
import { sfx } from '../core/sfx.js';

const { WEAPONS, MAX_HP, LIMITS } = rules;
const KO_SEC = 3.5; // 기절해 있는 시간
const INVULN_SEC = 4; // 깨어난 뒤 무적 시간
const REGEN_WAIT = 8; // 마지막 전투(때림·맞음) 뒤 이만큼 지나야 체력이 차기 시작한다
const REGEN_PER_SEC = 6;
const POP_MIN = 7; // 넉백이 이보다 세면 살짝 떠오른다(폭발·차)
const FX_GAP_MS = 400; // 전투 묶음(fx)은 0.4초에 1건
const FX_HITS = 12; // 묶음 하나에 싣는 주장 수
const FX_CARS = 6;
const CAR_MAX = 399; // 통신에 싣는 차량 번호의 상한
const KO_GAP_MS = 7000; // 같은 사람의 기절 알림은 7초에 한 번만 받는다
const KO_ALL_MS = 10000; // 기절 알림 전체: 10초에 8번까지
const KO_ALL_MAX = 8;
const GOLDEN = 2.399963229728653; // 황금각(rad): 주변을 고르게 훑는 나선에 쓴다
const r1 = (v) => Math.round(v * 10) / 10;

/** 모듈 사이의 알림판. 듣는 쪽 하나가 오류를 내도 나머지는 그대로 듣는다 */
function createBus() {
  const map = new Map();
  return {
    on(name, fn) {
      if (typeof fn !== 'function') return;
      let a = map.get(name);
      if (!a) map.set(name, (a = []));
      a.push(fn);
    },
    off(name, fn) {
      const a = map.get(name);
      const i = a ? a.indexOf(fn) : -1;
      if (i >= 0) a.splice(i, 1);
    },
    emit(name, payload) {
      const a = map.get(name);
      if (!a) return;
      for (let i = 0; i < a.length; i++) {
        try {
          a[i](payload);
        } catch (e) {
          console.error(`난투 알림 '${name}'을(를) 처리하다 오류가 났어요`, e);
        }
      }
    },
  };
}

// 효과를 만들지 못했을 때 대신 쓰는 빈 효과(다른 모듈이 그대로 불러도 되게)
const nullGfx = () => ({ explosion: () => false, debris() {}, comic() {}, sparks() {}, splash() {}, smoke() {}, ring() {}, shake() {}, stats: () => ({}), update() {} });

// 하위 모듈이 아직 갖추지 못한 함수의 기본값(껍데기이거나 만들다 실패했을 때)
const MODULE_DEFAULTS = {
  weapons: {},
  destruct: { isDown: () => false },
  vehicles: { isCarBusy: () => false, driving: () => false },
  boss: {},
};

export function createMayhem({ engine, world, player, cam, input, ui, net, remotes, store, profile, game }) {
  const bus = createBus();
  let gfx;
  try {
    // 잔해가 튈 바닥의 기본값: 효과가 생기는 순간 내가 있는 구역의 지면
    gfx = createGfx(engine, cam, { currentGround: () => world.active.heightAt });
  } catch (e) {
    console.error('난투 효과를 만들지 못했어요', e);
    gfx = nullGfx();
  }

  // 통신에 실리는 내 상태. lockUntil·invulnUntil은 engine.time 기준 시각(초)
  const state = { wpn: 0, hp: MAX_HP, atk: 0, ko: false, invulnUntil: 0, lockUntil: 0, car: -1, ax: 0, az: 0 };
  const targets = []; // 보스·과녁: { id, zone, x, y, z, radius, height, alive, hurt(d, w, x, z) }
  const scores = new Map(); // id → { ko: 기절시킨 횟수, down: 기절한 횟수 } (이번 접속 동안 본 것)
  let frame = 0;
  let prevWpn = 0; // 직전에 들던 무기
  let wakeAt = 0; // 깨어날 시각(engine.time)
  let lastCombat = -Infinity; // 마지막으로 때리거나 맞은 시각(engine.time)
  let slowUntil = 0;
  let slowFactor = 1;
  let jamUntil = 0;
  let tipShown = false;
  let hpShown = -1; // 내 아바타 체력 막대에 보인 값(-1은 숨김)

  const zoneOk = (zid) => !GAME.combatZones || GAME.combatZones.includes(zid);
  const climbing = () => !!(game && typeof game.climbActive === 'function' && game.climbActive());
  const riding = () => !!player.mount || state.car >= 0;
  const hidden = () => typeof document !== 'undefined' && !!document.hidden;
  const locked = () => engine.time < state.lockUntil;
  const lockLeft = () => (locked() ? Math.max(1, Math.ceil(state.lockUntil - engine.time)) : 0);

  // 같은 안내가 연달아 뜨지 않게 종류별로 간격을 둔다
  const hintAt = new Map();
  function hint(key, text, gapMs = 1500) {
    const now = performance.now();
    if (now - (hintAt.get(key) || -Infinity) < gapMs) return;
    hintAt.set(key, now);
    ui.toast(text);
  }

  // ---------- 무기 고르기 ----------
  /** 지금 무기를 꺼낼 수 있는가: 전투 구역이고, 기절·탑승·타임어택 중이 아닐 때 */
  function canArm() {
    return zoneOk(player.zone) && !state.ko && !riding() && !climbing();
  }

  function applyWeapon(i) {
    const was = state.wpn;
    if (i === was) return;
    prevWpn = was;
    state.wpn = i;
    ui.setWeapon(i); // 쿨다운 막은 무기 모듈이 그린다
    player.avatar.setWeapon(i);
    const armed = i > 0;
    if (armed !== was > 0) bus.emit('armed', { on: armed });
  }

  /** 무기를 바꾼다(0 = 평화). 바꿨거나 이미 그 무기면 true */
  function setWeapon(i) {
    if (!Number.isInteger(i) || i < 0 || i >= WEAPONS.length) return false;
    if (i === state.wpn) return true;
    if (state.ko) return false;
    if (i === 0) {
      if (locked()) {
        hint('lock', `⚔️ 전투 중! ${lockLeft()}초 뒤에 무기를 넣을 수 있어요`);
        return false;
      }
      applyWeapon(0);
      return true;
    }
    if (!canArm()) {
      if (!zoneOk(player.zone)) hint('arm', '🤝 여기는 안전 구역이라 무기를 꺼낼 수 없어요');
      else if (climbing()) hint('arm', '🏃 타임어택 중에는 무기를 꺼낼 수 없어요');
      else hint('arm', '🚗 차에서 내려야 무기를 바꿀 수 있어요');
      return false;
    }
    const first = state.wpn === 0;
    applyWeapon(i);
    if (first && !tipShown) {
      tipShown = true;
      ui.toast('⚔️ 난투 모드! 무기를 든 사람끼리만 맞아요', 5200);
      ui.toast('🤝 평화(무기 넣기)일 때는 무적이에요', 5200);
    }
    return true;
  }

  /** 다음 무기로(0→1→2→3→4→0). 전투 잠금 중에는 평화를 건너뛴다 */
  function cycleWeapon() {
    let next = (state.wpn + 1) % WEAPONS.length;
    if (next === 0 && locked()) next = 1;
    return setWeapon(next);
  }

  /** 잠금과 상관없이 무기를 넣는다(안전 구역에 들어감·타임어택 시작·탭이 가려짐·깨어남) */
  function forcePeace() {
    state.lockUntil = 0;
    applyWeapon(0);
  }

  // ---------- 공격 기록·피해 ----------
  /** 공격 1회 기록: 공격 횟수 +1, 겨냥점, 전투 잠금 갱신, 내 아바타 공격 동작. 평화·기절이면 false */
  function bumpAtk(ax, az) {
    if (state.wpn === 0 || state.ko) return false;
    state.atk = (state.atk + 1) & 65535;
    if (Number.isFinite(ax) && Number.isFinite(az)) {
      state.ax = ax;
      state.az = az;
    }
    state.lockUntil = engine.time + LIMITS.lockSec;
    lastCombat = engine.time;
    player.avatar.attack(state.wpn);
    return true;
  }

  /** 들이받기처럼 무기 공격이 아닌 전투: 공격 횟수·겨냥점·동작은 그대로 두고 전투 잠금과 회복 대기만 갱신한다 */
  function touchLock() {
    if (state.wpn === 0 || state.ko) return false;
    state.lockUntil = engine.time + LIMITS.lockSec;
    lastCombat = engine.time;
    return true;
  }

  const bossName = (by) => {
    for (let i = 0; i < targets.length; i++) if (targets[i].id === by) return targets[i].name || '보스';
    // 보스는 가까이 있을 때만 과녁 목록에 오른다: 멀리 있는 보스 이름은 보스 모듈에 묻는다
    try {
      const bm = mayhem.boss;
      return bm && typeof bm.nameOf === 'function' ? String(bm.nameOf(by) || '') : '';
    } catch (e) {
      return '';
    }
  };
  // 기절한 까닭을 한 구절로: "…님의 대포에 맞고", "…님의 차에 받혀". 알 수 없으면 빈 문자열
  function koReason(by, w, killerName) {
    if (killerName) {
      if (w === 'car') return `${killerName} 님의 차에 받혀`;
      const spec = rules.hitSpec(w);
      return spec ? `${killerName} 님의 ${spec.name}에 맞고` : `${killerName} 님에게 당해`;
    }
    if (by === 'self') return '자기 폭발에 휘말려';
    if (by === 'car') return '타고 있던 차가 터져';
    const boss = typeof by === 'string' && by.startsWith('boss:') ? bossName(by) : '';
    return boss ? `${boss}에게 당해` : '';
  }
  function scoreOf(id) {
    let s = scores.get(id);
    if (!s) {
      // 나간 사람의 기록은 표가 커졌을 때 한꺼번에 지운다
      if (scores.size >= 300) for (const k of scores.keys()) if (k !== net.id && !remotes.get(k)) scores.delete(k);
      scores.set(id, (s = { ko: 0, down: 0 }));
    }
    return s;
  }

  /**
   * 피해를 받는다: hurt(d, { by, w, kx, kz }). 평화·기절·무적이면 무시한다. 실제로 받은 피해를 돌려준다.
   * by는 때린 쪽(상대 id | '' | 'self' | 'car' | 'boss:키'), w는 무기(1~4 또는 'car'), (kx, kz)는 넉백 속도(m/s).
   * 통신으로 온 주장은 여기로 바로 넘기지 않는다 — 아래 takeClaim이 검사한 뒤에 부른다.
   */
  function hurt(d, info) {
    if (!(d > 0) || state.wpn === 0 || state.ko || engine.time < state.invulnUntil) return 0;
    const took = Math.min(d, state.hp);
    state.hp -= took;
    lastCombat = engine.time;
    // 맞기만 하는 사람은 6초 뒤 무기를 넣고 빠져나갈 수 있어야 한다: 잠금이 없을 때만 새로 건다
    if (!locked()) state.lockUntil = engine.time + LIMITS.lockSec;
    player.avatar.flash();
    sfx.hurt();
    if (took >= 10) gfx.shake(Math.min(0.7, 0.15 + took / 90)); // 센 한 방은 화면도 흔들린다(물총 연사에는 흔들지 않는다)
    const kx = info && Number.isFinite(info.kx) ? info.kx : 0;
    const kz = info && Number.isFinite(info.kz) ? info.kz : 0;
    const km = Math.hypot(kx, kz);
    if (km > 0.01) player.impulse(kx, km >= POP_MIN ? Math.min(7.5, km * 0.5) : 0, kz);
    if (state.hp <= 0) knockOut(info && typeof info.by === 'string' ? info.by.slice(0, 24) : '', info ? info.w : 0);
    return took;
  }

  function knockOut(by, w) {
    state.hp = 0;
    state.ko = true;
    player.ko = true; // local.js가 입력을 막고 아바타를 눕힌다
    wakeAt = engine.time + KO_SEC;
    if (climbing()) game.cancelClimb('타임어택이 취소됐어요');
    const wv = w === 'car' || (Number.isInteger(w) && w >= 1 && w < WEAPONS.length) ? w : 0;
    net.sendEvent('ko', { by, w: wv });
    scoreOf(net.id).down++;
    const killer = by ? remotes.get(by) : null;
    if (killer) scoreOf(by).ko++;
    sfx.ko();
    gfx.comic('기절!', player.pos.x, player.pos.y + 2.7, player.pos.z, { color: '#ffffff', size: 1.5, dur: 1.5 });
    ui.banner('기절!', `곧 ${GAME.respawnName} 앞에서 깨어나요`, false, 3000);
    const why = koReason(by, wv, killer ? killer.avatar.profile.n : '');
    ui.chat.system(`💫 ${why ? why + ' ' : ''}기절했어요. 곧 ${GAME.respawnName} 앞에서 깨어나요`);
    bus.emit('ko', { id: net.id, by }); // 차량 모듈이 듣고 내린다
  }

  // ---------- 깨어나는 곳 ----------
  const probe = { x: 0, z: 0 };
  const spot = { zone: '', x: 0, z: 0, yaw: 0 };
  /** 서 있을 수 있는 자리인가: 갈 수 있는 땅이고, 건물 안이 아니고, 벽·기둥에 걸리지 않는다 */
  function standable(zone, x, z) {
    if (!zone.playable(x, z) || zone.collider.solidAt(x, z)) return false;
    probe.x = x;
    probe.z = z;
    return !zone.collider.resolve(probe, PLAYER.radius);
  }
  /**
   * 깨어나는 자리 { zone, x, z, yaw }: GAME.respawn의 안내판 원에서 문 바깥 방향으로 out 미터.
   * 그 자리에 설 수 없으면(차가 서 있다든지) 주변을 나선으로 훑어 가장 가까운 빈자리를 찾는다. 스탬프 판정 상자 안은 피한다.
   */
  function respawnPoint() {
    const rs = GAME.respawn || {};
    const zid = Object.hasOwn(world.zones, rs.zone) ? rs.zone : world.campus.id;
    const zone = world.zones[zid];
    const signs = world.props && world.props.signs ? world.props.signs : [];
    const sign = zone === world.campus ? signs.find((s) => s.key === rs.sign) : null;
    let bx = SPAWN.x;
    let bz = SPAWN.z;
    spot.zone = zid;
    spot.yaw = Math.PI;
    if (sign) {
      // 문 바깥 방향(자료의 법선은 소수 둘째 자리까지라 길이가 꼭 1은 아니다)
      const nl = Math.hypot(sign.door.nx, sign.door.nz) || 1;
      const out = (Number.isFinite(rs.out) ? rs.out : 4.5) / nl;
      bx = sign.x + sign.door.nx * out;
      bz = sign.z + sign.door.nz * out;
      spot.yaw = Math.atan2(sign.door.nx, sign.door.nz); // 건물을 등지고 선다
    } else if (zone !== world.campus && zone.spawn) {
      bx = zone.spawn.x;
      bz = zone.spawn.z;
    }
    spot.x = bx;
    spot.z = bz;
    if (standable(zone, bx, bz)) return spot;
    for (let k = 1; k <= 240; k++) {
      const r = 0.7 * Math.sqrt(k);
      const x = bx + Math.cos(k * GOLDEN) * r;
      const z = bz + Math.sin(k * GOLDEN) * r;
      if (sign && Math.abs(x - sign.x) < 2.6 && Math.abs(z - sign.z) < 2.6) continue;
      if (standable(zone, x, z)) {
        spot.x = x;
        spot.z = z;
        return spot;
      }
    }
    // 끝내 못 찾았으면 처음 들어온 자리
    spot.zone = world.campus.id;
    spot.x = SPAWN.x;
    spot.z = SPAWN.z;
    spot.yaw = Math.PI;
    return spot;
  }

  function wake() {
    const p = respawnPoint();
    state.ko = false;
    player.ko = false;
    state.hp = MAX_HP;
    forcePeace();
    state.invulnUntil = engine.time + INVULN_SEC;
    slowUntil = jamUntil = 0;
    player.place(p.zone, p.x, p.z, p.yaw);
    cam.yaw = p.yaw + Math.PI; // 카메라는 등 뒤에서
    ui.toast(`🏥 ${GAME.respawnName} 앞에서 깨어났어요`);
  }

  // ---------- 맞혔다는 주장 보내기(0.4초에 묶음 1건) ----------
  const hitQ = []; // [대상 id, 피해, 무기, x, z]
  const carQ = [];
  const bossQ = new Map(); // 보스 키 → 쌓인 피해
  const fxMsg = {};
  let lastFxAt = -Infinity;

  /** 대상(접속자 id)을 맞혔다고 주장한다. 판정은 맞은 쪽이 한다. GAME.pvp가 false면 아무것도 하지 않는다 */
  function claimHit(targetId, d, w, x, z) {
    if (!GAME.pvp) return false;
    if (typeof targetId !== 'string' || !targetId || !Number.isFinite(d) || d < 1 || !rules.hitSpec(w) || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (hitQ.length >= FX_HITS * 3) hitQ.shift(); // 너무 밀렸으면 가장 오래된 주장부터 버린다
    hitQ.push([targetId, r1(d), w, r1(x), r1(z)]);
    return true;
  }
  /** 보스에게 준 피해를 알린다(다음 묶음에 합쳐서 나간다) */
  function claimBoss(key, d) {
    if (typeof key !== 'string' || !key || key.length > 16 || !Number.isFinite(d) || !(d > 0)) return false;
    if (!bossQ.has(key) && bossQ.size >= 4) return false;
    bossQ.set(key, (bossQ.get(key) || 0) + d);
    return true;
  }
  /** 주차 차량을 터뜨렸다고 알린다 */
  function claimCar(i) {
    if (!Number.isInteger(i) || i < 0 || i > CAR_MAX) return false;
    if (!carQ.includes(i) && carQ.length < FX_CARS * 3) carQ.push(i);
    return true;
  }
  function flushFx(now, force) {
    if (!hitQ.length && !carQ.length && !bossQ.size) return;
    if (!force && now - lastFxAt < FX_GAP_MS) return;
    fxMsg.h = fxMsg.b = fxMsg.c = undefined; // undefined인 칸은 메시지에 실리지 않는다
    let any = false;
    if (hitQ.length) {
      fxMsg.h = hitQ.splice(0, FX_HITS);
      any = true;
    }
    for (const [key, d] of bossQ) {
      // 묶음 하나에 보스 하나. 1 미만은 더 쌓일 때까지 둔다
      if (d < 1) continue;
      bossQ.delete(key);
      fxMsg.b = [key, r1(d)];
      any = true;
      break;
    }
    if (carQ.length) {
      fxMsg.c = carQ.splice(0, FX_CARS);
      any = true;
    }
    if (!any) return;
    lastFxAt = now;
    // 돌려주는 값은 'sent' | 'queued' | 'dropped' — 발신 제한에 걸리면 net이 알아서 기다렸다 보내거나 버린다
    net.sendEvent('fx', fxMsg);
  }

  // ---------- 받은 주장 처리 ----------
  // validateHit에 넘길 것들. 매번 새로 만들지 않고 고쳐 쓴다.
  const recent = []; // 최근에 받아들인 주장(1초 창). 1초에 10건까지만 받아들이므로 16칸이면 살아 있는 기록을 덮어쓰지 않는다
  for (let i = 0; i < 16; i++) recent.push({ t: -Infinity, d: 0, from: '' });
  let recentI = 0;
  const victim = { armed: false, ko: false, invuln: false, hidden: false, zone: '', x: 0, z: 0 };
  const attacker = { id: '', known: false, wpn: 0, prevWpn: 0, wpnChangedAt: 0, zone: '', x: 0, z: 0, car: -1, ko: false, stateAt: 0 };
  const claim = { d: 0, w: 0, x: 0, z: 0 };
  const verdict = { ok: false, d: 0, kx: 0, kz: 0, reason: '' };
  const hitArgs = { victim, attacker, msg: claim, recent, now: 0, combatZones: null };

  // "나를 맞혔다"는 주장 하나. 공격자는 보간값이 아니라 마지막으로 받은 원본 상태로 본다
  function takeClaim(id, d, w, x, z) {
    const r = remotes.get(id);
    const now = performance.now();
    victim.armed = state.wpn > 0;
    victim.ko = state.ko;
    victim.invuln = engine.time < state.invulnUntil;
    victim.hidden = hidden();
    victim.zone = player.zone;
    victim.x = player.pos.x;
    victim.z = player.pos.z;
    attacker.id = id;
    attacker.known = !!r && !r.fresh;
    if (r) {
      attacker.wpn = r.wpn;
      attacker.prevWpn = r.prevWpn;
      attacker.wpnChangedAt = r.wpnChangedAt;
      attacker.zone = r.zone;
      attacker.x = r.raw.x;
      attacker.z = r.raw.z;
      attacker.car = r.car;
      attacker.ko = r.ko;
      attacker.stateAt = r.stateAt;
    }
    claim.d = d;
    claim.w = w;
    claim.x = x;
    claim.z = z;
    hitArgs.now = now;
    hitArgs.combatZones = GAME.combatZones || null;
    if (!rules.validateHit(hitArgs, verdict).ok) return;
    const slot = recent[recentI];
    recentI = (recentI + 1) % recent.length;
    slot.t = now;
    slot.d = verdict.d;
    slot.from = id;
    hurt(verdict.d, { by: id, w, kx: verdict.kx, kz: verdict.kz });
  }

  function onFx(id, msg) {
    const h = msg.h;
    if (GAME.pvp && Array.isArray(h)) {
      const n = Math.min(h.length, FX_HITS);
      for (let i = 0; i < n; i++) {
        const e = h[i];
        if (Array.isArray(e) && e[0] === net.id) takeClaim(id, e[1], e[2], e[3], e[4]);
      }
    }
    // 보스 피해·차량 폭파 주장은 형식만 걸러서 넘긴다(검증은 각 모듈이 한다)
    const b = msg.b;
    if (Array.isArray(b) && typeof b[0] === 'string' && b[0] && b[0].length <= 16 && Number.isFinite(b[1]) && b[1] > 0) bus.emit('bossClaim', { id, key: b[0], d: Math.min(b[1], 10000) });
    const c = msg.c;
    if (Array.isArray(c)) {
      const n = Math.min(c.length, FX_CARS);
      for (let i = 0; i < n; i++) if (Number.isInteger(c[i]) && c[i] >= 0 && c[i] <= CAR_MAX) bus.emit('carClaim', { id, i: c[i] });
    }
  }

  // 남의 기절 알림. 누구나 꾸며 보낼 수 있으므로: 보낸 사람의 마지막 상태가 "전투 구역에서 무기를 든 채"일 때만,
  // 한 사람당 7초에 한 번·전체 10초에 8번까지만 받고, 기절시킨 사람(by)은 무기를 들고 닿을 거리에 있을 때만 점수로 친다.
  const koSeen = new Map(); // 보낸 사람 id → 마지막으로 받아들인 시각(ms)
  const koAll = new Array(KO_ALL_MAX).fill(-Infinity);
  let koAllI = 0;
  function claimReach(w, wpn, prev, inCar) {
    if (w === 'car') return inCar ? rules.reach('car', true) : 0;
    return rules.reach(Number.isInteger(w) && (w === wpn || w === prev) ? w : wpn, inCar);
  }
  const within = (ax, az, r, lim) => lim > 0 && (ax - r.raw.x) * (ax - r.raw.x) + (az - r.raw.z) * (az - r.raw.z) <= lim * lim;
  function onKo(id, msg, peer) {
    if (!GAME.pvp) return;
    const r = remotes.get(id);
    if (!r || r.fresh || !(r.wpn > 0) || !zoneOk(r.zone)) return;
    const now = performance.now();
    if (now - (koSeen.get(id) || -Infinity) < KO_GAP_MS) return;
    if (now - koAll[koAllI] < KO_ALL_MS) return;
    koAll[koAllI] = now;
    koAllI = (koAllI + 1) % KO_ALL_MAX;
    if (koSeen.size > 200) for (const [k, t] of koSeen) if (now - t >= KO_GAP_MS) koSeen.delete(k);
    koSeen.set(id, now);

    const by = typeof msg.by === 'string' ? msg.by.slice(0, 24) : '';
    const w = msg.w;
    const name = peer.profile.n;
    scoreOf(id).down++;
    let line = '';
    if (by === net.id) {
      // 내가 기절시켰다는 알림: 내 상태로 확인한다(나는 remotes에 없다)
      if (state.wpn > 0 && within(player.pos.x, player.pos.z, r, claimReach(w, state.wpn, prevWpn, state.car >= 0))) {
        scoreOf(net.id).ko++;
        line = `💥 ${name} 님을 기절시켰어요!`;
      }
    } else if (by) {
      const k = remotes.get(by);
      if (k && k !== r && !k.fresh && k.wpn > 0 && k.zone === r.zone && within(k.raw.x, k.raw.z, r, claimReach(w, k.wpn, k.prevWpn, k.car >= 0))) {
        scoreOf(by).ko++;
        line = `💫 ${name} 님이 ${koReason(by, w, k.avatar.profile.n)} 기절했어요`;
      }
    }
    if (!line) {
      const why = koReason(by, w, '');
      line = why ? `💫 ${name} 님이 ${why} 기절했어요` : `💫 ${name} 님이 기절했어요`;
    }
    ui.feed(line, id);
    bus.emit('peerKo', { id, by });
  }

  net.on('event', (id, msg, peer) => {
    if (msg.k === 'fx') onFx(id, msg);
    else if (msg.k === 'ko') onKo(id, msg, peer);
  });

  // ---------- 디버프(보스 기술) ----------
  /** sec초 동안 걷는 속도를 factor배로(0.2~1). 평화 상태에는 걸리지 않는다 */
  function addSlow(sec, factor) {
    if (!(sec > 0) || !(factor > 0) || state.wpn === 0) return;
    const f = Math.max(0.2, Math.min(1, factor));
    const until = engine.time + Math.min(sec, 10);
    if (engine.time >= slowUntil || f < slowFactor) slowFactor = f;
    if (until > slowUntil) slowUntil = until;
  }
  /** sec초 동안 무기 고장(무기 모듈이 isJammed()를 보고 쏘지 않는다) */
  function jam(sec) {
    if (!(sec > 0) || state.wpn === 0) return;
    const until = engine.time + Math.min(sec, 10);
    if (until > jamUntil) jamUntil = until;
    sfx.jam();
  }

  // ---------- 무장한 다른 사람들 ----------
  const peers = [];
  let peersFrame = -1;
  /**
   * 나와 같은 구역에서 무기를 들고 있고 기절하지 않은 원격 접속자 기록들(차에 탄 사람도 포함).
   * 같은 배열을 돌려 쓰고 프레임마다 한 번만 다시 만든다. GAME.pvp가 false면 늘 빈 배열.
   */
  function armedPeers() {
    if (peersFrame === frame) return peers;
    peersFrame = frame;
    // 배열을 비웠다가 다시 채우지 않고 자리를 덮어쓴다(프레임마다 다시 할당하지 않게)
    let n = 0;
    if (GAME.pvp) {
      const zid = player.zone;
      for (const r of remotes.map.values()) if (r.zone === zid && r.wpn > 0 && !r.ko) peers[n++] = r;
    }
    if (peers.length !== n) peers.length = n;
    return peers;
  }

  const wire = { hp: MAX_HP, wpn: 0, atk: 0, car: -1, ko: false, ax: 0, az: 0 };
  /** 통신 상태에 실을 값(같은 객체를 고쳐 돌려준다) */
  function netState() {
    wire.hp = state.hp;
    wire.wpn = state.wpn;
    wire.atk = state.atk;
    wire.car = state.car;
    wire.ko = state.ko;
    wire.ax = state.ax;
    wire.az = state.az;
    return wire;
  }

  /** 접속자 패널에 덧붙일 한 줄(이번 접속 동안의 기록). 기록이 없으면 빈 문자열 */
  function scoreLine(id) {
    const s = scores.get(id);
    return s && (s.ko || s.down) ? `⚔️ 기절시킴 ${s.ko} · 기절 ${s.down}` : '';
  }

  // ---------- 하위 모듈 ----------
  const mods = []; // 갱신 순서대로 { name, mod, fails, off }
  function runMods(dt) {
    for (let i = 0; i < mods.length; i++) {
      const m = mods[i];
      if (m.off) continue;
      try {
        m.mod.update(dt);
        m.fails = 0;
      } catch (e) {
        // 한 모듈이 매 프레임 오류를 내도 화면과 나머지 모듈은 계속 돈다. 스무 번 연달아 실패하면 그 모듈만 끈다.
        m.fails++;
        if (m.fails <= 2) console.error(`난투 모듈 '${m.name}' 갱신 중 오류`, e);
        if (m.fails >= 20) {
          m.off = true;
          console.error(`난투 모듈 '${m.name}'이(가) 계속 오류를 내서 껐어요`);
          if (m.name === 'vehicles') {
            // 차에 탄 채로 굳지 않게 풀어 준다
            player.mount = null;
            state.car = -1;
            ui.setCar(null);
          }
        }
      }
    }
  }

  function update(dt) {
    frame++;
    const t = engine.time;
    if (state.ko) {
      if (t >= wakeAt) wake();
    } else if (state.hp < MAX_HP && t - lastCombat >= REGEN_WAIT) state.hp = Math.min(MAX_HP, state.hp + REGEN_PER_SEC * dt);
    // 무기를 들 수 없는 곳·때에 들고 있으면 넣는다(구역 이동·타임어택 시작을 놓쳤을 때를 위한 확인)
    if (state.wpn > 0 && (!zoneOk(player.zone) || climbing())) forcePeace();

    runMods(dt);
    try {
      gfx.update(dt);
    } catch (e) {
      console.error('난투 효과 갱신 중 오류 — 효과를 껐어요', e);
      gfx.update = () => {};
    }

    const armed = state.wpn > 0;
    input.armed = armed && !player.mount; // 무기를 들었으면 화면 탭이 발사(aimtap)가 된다
    player.speedMul = armed ? (WEAPONS[state.wpn].speedMul || 1) * (t < slowUntil ? slowFactor : 1) : 1;
    ui.setHP(armed ? state.hp : null);
    const shown = armed ? Math.ceil(state.hp) : -1;
    if (shown !== hpShown) {
      hpShown = shown;
      player.avatar.setHP(shown < 0 ? null : shown);
    }
    flushFx(performance.now(), false);
  }

  const mayhem = {
    bus,
    gfx,
    rules,
    GAME,
    state,
    targets,
    canArm,
    setWeapon,
    cycleWeapon,
    forcePeace,
    locked,
    lockLeft,
    bumpAtk,
    touchLock,
    hurt,
    claimHit,
    claimBoss,
    claimCar,
    addTarget(t) {
      if (t && typeof t === 'object' && !targets.includes(t)) targets.push(t);
      return t;
    },
    removeTarget(t) {
      const i = targets.indexOf(t);
      if (i >= 0) targets.splice(i, 1);
    },
    addSlow,
    jam,
    isJammed: () => engine.time < jamUntil,
    armedPeers,
    isFrozen: () => state.ko,
    netState,
    scoreLine,
    respawnPoint,
    /** 그 건물이 지금 무너져 있는가(파괴 모듈이 답한다) */
    isDown(key) {
      const d = mayhem.destruct;
      return !!(d && typeof d.isDown === 'function' && d.isDown(key));
    },
    update,
    weapons: null,
    destruct: null,
    vehicles: null,
    boss: null,
  };

  // ---------- 입력·구역·탭 가려짐 ----------
  input.on('weapon', () => {
    if (!ui.panel.isOpen()) cycleWeapon();
  });
  ui.onWeapon((i) => setWeapon(i));
  // 평화 상태에서 공격을 누르면 조용히 무시하지 않고 방법을 알려 준다(F는 이제 상호작용 키가 아니다)
  input.on('fire', () => {
    if (state.wpn > 0 || player.mount || ui.panel.isOpen() || !canArm()) return;
    hint('peacefire', input.touch ? '무기 버튼으로 무기를 먼저 고르세요' : 'Q로 무기를 고르면 F로 공격해요 (문·안내는 E)', 6000);
  });
  player.on('zone', (zid) => {
    if (state.wpn > 0 && !zoneOk(zid)) {
      forcePeace();
      hint('zone', '🤝 안전 구역이에요. 무기를 넣었어요');
    }
  });
  bus.on('mount', (e) => {
    state.car = e && Number.isInteger(e.i) && e.i >= 0 && e.i <= CAR_MAX ? e.i : -1;
  });
  bus.on('unmount', () => {
    state.car = -1;
  });
  if (typeof document !== 'undefined' && document.addEventListener) {
    // 탭이 가려지면 화면 갱신이 멈춰 아무것도 피할 수 없다: 잠금과 상관없이 무기를 넣는다(가려진 동안 온 주장은 validateHit이 거부한다).
    // 바뀐 상태를 바로 알리는 일은 main.js가 한다(이 뒤에 등록한 리스너).
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      flushFx(performance.now(), true); // 방금 맞힌 것까지는 알리고
      hitQ.length = 0;
      carQ.length = 0;
      bossQ.clear();
      forcePeace();
      player.knock.x = player.knock.z = 0;
    });
  }

  // 하위 모듈: 하나가 시작하다 실패해도 나머지와 본체는 그대로 돈다.
  // 만드는 순서는 무기 → 파괴 → 차량 → 보스이고, 서로는 쓸 때마다 mayhem.vehicles처럼 찾아 쓴다.
  const ctx = { engine, world, player, cam, input, ui, net, remotes, store, profile, game, mayhem, bus, gfx, rules, sfx, GAME };
  const made = {};
  for (const [name, create] of [
    ['weapons', createWeapons],
    ['destruct', createDestruct],
    ['vehicles', createVehicles],
    ['boss', createBoss],
  ]) {
    let mod = null;
    try {
      mod = create(ctx);
    } catch (e) {
      console.error(`난투 모듈 '${name}'을(를) 시작하지 못했어요`, e);
    }
    if (!mod || typeof mod.update !== 'function') mod = { update() {} };
    const defs = MODULE_DEFAULTS[name];
    for (const k of Object.keys(defs)) if (typeof mod[k] !== 'function') mod[k] = defs[k];
    mayhem[name] = mod;
    made[name] = { name, mod, fails: 0, off: false };
  }
  // 갱신 순서: 차량이 먼저(탑승 자리 player.mount를 player.update 전에, 무기 모듈이 보기 전에 맞춘다)
  mods.push(made.vehicles, made.weapons, made.destruct, made.boss);

  return mayhem;
}
