// 무기 발사와 탄(설계서 5.1).
//   발사: 공격(F·터치 공격 버튼)을 누르고 있으면 자동 조준(input.fire), 무기를 든 채 화면을 찍으면 그곳으로(input 'aimtap').
//         'fire' 이벤트(첫 눌림)로는 쏘지 않는다 — 운전 중 경적이 쓰고, 터치 공격 버튼은 fireTouch와 'fire'를 함께 낸다.
//   탄: 물총(파란 물방울)·폭죽(빨강·흰 통 + 불꽃 꼬리)·대포알(검은 공, rules.shellLaunch 포물선). 풀을 돌려 쓰고 InstancedMesh로 그린다.
//   판정: 1.5m 이하 걸음마다 지형·건물 부피·무장한 사람·과녁·보이는 주차 차량. 폭발탄은 3m 날아가기 전에는 사람·과녁을 지나친다.
//   피해: 사람은 mayhem.claimHit(주장일 뿐 — 판정은 맞은 쪽), 과녁·보스는 target.hurt, 내 폭발에 내가 휘말리면 절반을 mayhem.hurt.
//   남의 발사: remotes 기록의 atkEvents가 늘어난 만큼 atkPose에서 같은 탄을 연출만 한다(피해 0, 폭발 알림도 dmg·bdmg 0).
//         모두 합쳐 초당 16발까지이고, 그 몫은 가까운 사람(80m 안)부터 매 프레임 시작점을 돌려 가며 나눈다(위조 id가 몫을 독차지하지 못하게).
// 시간: 쿨다운·탄 수명은 engine.time(초). 매 프레임 객체를 만들지 않는다(벡터·옵션 객체는 미리 만들어 고쳐 쓴다).
//
// 내가 내는 알림: bus 'explosion' { zone(구역 id 문자열 — 'campus' 등), x, y, z, radius, dmg, bdmg, by('me' 또는 쏜 사람 id), w(3·4), tag(맞은 건물 키 또는 null) }
//   남의 폭발 재현은 dmg·bdmg가 0이다(파괴 모듈은 by === 'me'이고 bdmg > 0인 것만 건물·차를 부순다).
import * as THREE from 'three';

const AIM_HALF = (35 * Math.PI) / 180; // 자동 조준: 카메라 정면 ±35°
const DEF_AIM = [0, 2, 25, 40, 45]; // 대상이 없을 때 겨냥하는 카메라 정면 거리(m) — 그 자리의 지면
const SUBSTEP = 1.5; // 탄이 한 걸음에 움직이는 최대 거리(m)
const ARM_DIST = 3; // 폭발탄은 이만큼 날아가기 전에는 사람·과녁과 부딪히지 않는다(쏜 사람 코앞에서 터지지 않게)
const PUNCH_DELAY = 0.1; // 주먹은 휘두르고 이만큼 뒤에 맞았는지 본다(초)
const BODY_R = 0.5; // 걷는 사람 판정 원기둥(반지름·높이 m)
const BODY_H = 1.8;
const RIDER_R = 1.6; // 차에 탄 사람
const RIDER_H = 1.6;
const CAR_HW = 0.95; // 주차 차량 상자: 1.9 × 4.3m, 높이 1.5m(반폭·반길이)
const CAR_HL = 2.15;
const CAR_H = 1.5;
const CAR_PROBE = [0.5, 1]; // 한 걸음 안에서 차를 보는 자리(비율)
const SELF_SHARE = 0.5; // 내 폭발에 내가 휘말리면 피해의 절반
const EDGE_DMG = 0.35; // 폭발 가장자리에서 받는 피해 비율(한가운데 1 → 가장자리 0.35)
const TAP_BUFFER = 0.25; // 찍었을 때 쿨다운이 이만큼 안 남았으면 기억해 뒀다가 쏜다(초)
const TAP_SKIP = 2; // 찍은 광선은 "주인공 깊이 - 2m"부터 훑는다(카메라와 주인공 사이의 앞땅·모서리에 걸리지 않게)
const MARCH_STEP = 0.8; // 찍은 광선을 훑는 간격(m)
const MARCH_MAX = 420;
const SKY_Y = 180; // 위로 가는 광선이 이 높이를 넘으면 더 볼 것이 없다
const REPLAY_RATE = 16; // 남의 발사 재현: 모두 합쳐 초당 이만큼까지(접속자 id는 얼마든지 새로 만들 수 있으므로 전체로 묶는다)
const REPLAY_PENDING = 2; // 한 사람에게서 밀려 있는 재현은 이만큼까지(나머지는 버린다)
const REPLAY_GAP = 0.8; // 같은 사람·무기의 재현 간격: 쿨다운 × 0.8 이상
const REPLAY_NEAR = 80; // 쏜 자리나 겨냥점이 나에게서 이 안(m)이면 먼저 재현한다
const REPLAY_FAR_KEEP = REPLAY_RATE / 2; // 먼 곳의 재현은 몫이 이만큼 넘게 남아 있을 때만(가까운 것을 위해 남겨 둔다)
const REPLAY_STALE = 1; // 몫이 없어 밀린 재현은 그 사람의 마지막 공격에서 이만큼(초) 지나면 버린다
const JAM_HINT_GAP = 0.8; // 고장 중에 쏘려 하면 이 간격으로 알려 준다(초)
// 포구 자리 [앞, 옆(아바타 로컬 +x — 무기를 든 쪽), 발에서 높이]: avatar.js가 무기를 그리는 자리에 맞췄다
const MUZZLE = [null, [0.5, 0.2, 1.2], [0.9, 0.33, 1.25], [0.8, 0.37, 1.45], [0.75, 0.52, 1.52]];
// 맞은 것의 종류
const HIT_ENV = 1;
const HIT_PEER = 2;
const HIT_ME = 3;
const HIT_TARGET = 4;
const HIT_CAR = 5;

// gfx 호출에 넘기는 옵션(매번 새로 만들지 않는다)
const EXP_RK = { radius: 5, big: false, quiet: false };
const EXP_SH = { radius: 9, big: true, quiet: false };
const EXPQ_RK = { radius: 5, big: false, quiet: true };
const EXPQ_SH = { radius: 9, big: true, quiet: true };
const COMIC_PUNCH = { color: '#ffd23f', size: 1.3, dur: 0.6 };
const COMIC_POP = { color: '#ff7ab8', size: 2.0, dur: 0.9 };
const COMIC_BIG = { color: '#ffb02e', size: 2.8, dur: 1.1 };
const COMIC_JAM = { color: '#ff6b6b', size: 0.9, dur: 0.7 };
const TRAIL_RK = { n: 2, speed: 1.4, dur: 0.34, gravity: -0.6, up: 0, color: 0xffd23f };
const TRAIL_SH = { n: 1, speed: 1.1, dur: 0.26, gravity: 3, up: 0.8, color: 0xffc85a };
const MUZ_SPARK = { n: 10, speed: 4, dur: 0.3, gravity: 2, up: 0.6, color: 0xffe08a };
const MUZ_SMOKE = { n: 3, size: 1.4, dur: 0.8, color: 0xe6e6e6 };
const PUNCH_SPARK = { n: 8, speed: 3.2, dur: 0.25, gravity: 0, up: 0.4, color: 0xffffff };

const fin3 = (x, y, z) => Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);

/** 색을 입힌 도형 여러 개를 지오메트리 하나로 합친다(정점 색) — 탄 하나를 한 번에 그리려고 */
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

/** 폭죽: 빨강·흰 줄무늬 통 + 노란 머리 + 금테. 머리가 +z를 본다 */
function rocketGeo() {
  const parts = [];
  const n = 4;
  const len = 0.16;
  for (let i = 0; i < n; i++) parts.push([new THREE.CylinderGeometry(0.1, 0.1, len, 10, 1, true).translate(0, (i - (n - 1) / 2) * len, 0), i % 2 ? 0xf5f3ee : 0xe5383b]);
  const half = (n * len) / 2;
  parts.push([new THREE.ConeGeometry(0.1, 0.24, 10).translate(0, half + 0.12, 0), 0xffd23f]);
  parts.push([new THREE.CylinderGeometry(0.118, 0.118, 0.06, 10).translate(0, -half, 0), 0xf2c230]);
  return fuse(parts).rotateX(Math.PI / 2);
}

/** 대포알: 까만 공 + 도화선(만화 폭탄) */
function shellGeo() {
  return fuse([
    [new THREE.SphereGeometry(0.3, 12, 9), 0x2a2d34],
    [new THREE.CylinderGeometry(0.09, 0.11, 0.08, 10).translate(0, 0.3, 0), 0x5a5e66],
    [new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6).translate(0, 0.41, 0), 0xc9a46a],
  ]);
}

export function createWeapons(ctx) {
  const { engine, world, player, cam, input, ui, remotes, mayhem, bus, gfx, rules, sfx, GAME } = ctx;
  const { WEAPONS, LIMITS } = rules;
  const NW = WEAPONS.length;
  const low = !!(engine.quality && engine.quality.low);
  const camera = engine.camera;

  const root = new THREE.Group();
  root.name = 'mayhem-shots';
  engine.scene.add(root);

  const _v = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _shell = { vx: 0, vy: 0, vz: 0, t: 0, dist: 0 }; // rules.shellLaunch의 결과를 받는 자리
  const _mz = { x: 0, y: 0, z: 0 }; // 포구
  const _aim = { x: 0, y: 0, z: 0, peer: null, target: null }; // 자동 조준 결과
  const _tap = { x: 0, y: 0, z: 0, peer: null, target: null }; // 찍은 곳 겨냥 결과

  // ---------- 탄 풀(무기 번호 2 물총, 3 폭죽, 4 대포) ----------
  function makePool(w, geo, mat, cap, scaleZ) {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.name = 'shot:' + WEAPONS[w].id;
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false; // 인스턴스가 날아다녀서 경계 구가 금방 틀린다
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    root.add(mesh);
    const items = [];
    for (let i = 0; i < cap; i++) {
      // by: 쏜 사람 id(내 탄은 ''), zid·zone: 쏜 순간의 구역 id·구역 객체, (ox, oy, oz): 이번 걸음을 떠난 자리,
      // g: 중력, life: 수명(초), range: 날아갈 수 있는 거리. 숫자 칸은 0.5로 시작한다(처음부터 소수 칸이라 나중에 객체 모양이 바뀌지 않게)
      items.push({ on: false, w, mine: false, by: '', zid: '', zone: null, x: 0.5, y: 0.5, z: 0.5, ox: 0.5, oy: 0.5, oz: 0.5, vx: 0.5, vy: 0.5, vz: 0.5, g: 0.5, age: 0.5, life: 0.5, travel: 0.5, range: 0.5, trail: 0.5, seq: 0 });
    }
    return { w, mesh, items, alive: 0, scaleZ };
  }
  const pools = [null, null, null, null, null];
  pools[2] = makePool(2, new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshLambertMaterial({ color: 0x45b4ff, emissive: 0x0f3d6e }), low ? 30 : 60, 1.9);
  pools[3] = makePool(3, rocketGeo(), new THREE.MeshLambertMaterial({ vertexColors: true }), low ? 8 : 16, 1);
  pools[4] = makePool(4, shellGeo(), new THREE.MeshLambertMaterial({ vertexColors: true }), low ? 4 : 8, 1);
  let shotSeq = 0;
  let trailFlip = 0;

  // ---------- 발사 상태 ----------
  const readyAt = new Array(NW).fill(0); // 무기별로 다음에 쏠 수 있는 시각(engine.time)
  const punch = { on: false, at: 0, ux: 0, uz: 1 }; // 판정을 기다리는 주먹(휘두른 방향)
  const tapReq = { on: false, sx: 0, sy: 0 }; // 이번 프레임에 처리할 화면 찍기
  const tapBuf = { on: false, w: 0, x: 0, y: 0, z: 0, until: 0 }; // 쿨다운이 끝나면 쏠 찍은 곳
  let jamHintAt = -Infinity;

  const cdLeft = (w) => Math.max(0, readyAt[w] - engine.time);
  /** 지금 쏠 수 있는 상황인가(쿨다운은 따로 본다): 무장 + 무장 가능한 곳·때(기절·탑승·타임어택 아님) + 패널·고장 아님 */
  function canFire() {
    const w = mayhem.state.wpn;
    return w > 0 && w < NW && mayhem.canArm() && !player.mount && !ui.panel.isOpen() && !mayhem.isJammed();
  }
  const carBusy = (i) => {
    const v = mayhem.vehicles;
    return !!(v && typeof v.isCarBusy === 'function' && v.isCarBusy(i));
  };
  const distToMe = (x, y, z) => {
    const P = player.pos;
    return Math.sqrt((x - P.x) * (x - P.x) + (y - P.y) * (y - P.y) + (z - P.z) * (z - P.z));
  };
  function callHurt(t, d, w, x, z) {
    try {
      t.hurt(d, w, x, z);
    } catch (e) {
      console.error('과녁이 피해를 받다 오류가 났어요', e);
    }
  }

  // ---------- 지형·건물 부피 ----------
  // 점은 { x, y, z } 객체로 넘긴다(탄 기록 자체 또는 아래 PROBE). 숫자 인자를 여럿 넘기면 걸음마다 숫자 상자가 생긴다.
  const PROBE = { x: 0.5, y: 0.5, z: 0.5 };
  let envSolid = null; // insideEnv가 마지막으로 찾은 건물(지형이면 null)
  /** 그 건물의 실제 지붕 높이. 무너진 건물은 -Infinity(탄이 지나간다) */
  function roofOf(sol) {
    const tag = sol.tag;
    if (tag) {
      if (mayhem.isDown(tag)) return -Infinity;
      const bk = world.buildings && world.buildings.byKey;
      if (bk && Object.hasOwn(bk, tag)) return bk[tag].top;
    }
    return sol.top;
  }
  /** 점 p { x, y, z }가 땅속이면 1, 건물 부피 안이면 2(envSolid에 그 건물), 아니면 0 */
  function insideEnv(zone, p) {
    envSolid = null;
    if (p.y <= zone.heightAt(p.x, p.z)) return 1;
    const sol = zone.collider.solidAt(p.x, p.z);
    if (sol && p.y < roofOf(sol)) {
      envSolid = sol;
      return 2;
    }
    return 0;
  }
  /** (x, y, z)를 PROBE에 놓고 insideEnv — 맞은 뒤 다듬기·찍기처럼 가끔 하는 일에 쓴다 */
  function insideAt(zone, x, y, z) {
    PROBE.x = x;
    PROBE.y = y;
    PROBE.z = z;
    return insideEnv(zone, PROBE);
  }

  /**
   * 광선 o + t·d(t ≥ t0)가 세로 원기둥(중심 cx·cz, 반지름 r, 높이 y0~y1)에 처음 닿는 t. 안 닿으면 Infinity.
   * 옆면과 윗면(내려오는 광선)을 본다. 시작점이 이미 안이면 t0.
   */
  function rayCyl(ox, oy, oz, dx, dy, dz, t0, cx, cz, r, y0, y1) {
    const qx = ox - cx;
    const qz = oz - cz;
    const a = dx * dx + dz * dz;
    let best = Infinity;
    if (a > 1e-12) {
      const b = qx * dx + qz * dz;
      const c = qx * qx + qz * qz - r * r;
      const disc = b * b - a * c;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        const t1 = (-b - sq) / a;
        const t2 = (-b + sq) / a;
        const te = t1 >= t0 ? t1 : t2 >= t0 ? t0 : Infinity; // 옆면으로 들어가는 때(이미 안이면 t0)
        if (te < Infinity) {
          const y = oy + dy * te;
          if (y >= y0 && y <= y1) best = te;
        }
      }
    } else if (qx * qx + qz * qz <= r * r) {
      // 수직 광선이 원기둥 안을 지난다: 높이 범위에 들어가는 때
      const ty = dy < 0 ? (y1 - oy) / dy : dy > 0 ? (y0 - oy) / dy : oy >= y0 && oy <= y1 ? t0 : Infinity;
      if (ty >= t0) best = ty;
      else if (oy + dy * t0 >= y0 && oy + dy * t0 <= y1) best = t0;
    }
    if (dy < -1e-9) {
      const tc = (y1 - oy) / dy; // 윗면
      if (tc >= t0 && tc < best) {
        const hx = qx + dx * tc;
        const hz = qz + dz * tc;
        if (hx * hx + hz * hz <= r * r) best = tc;
      }
    }
    return best;
  }

  // 주차 차량 칸: 차는 제자리에 서 있으므로(사라졌다 돌아올 뿐) 처음 쓸 때 한 번 8m 칸에 나눠 둔다.
  // 탄 한 걸음마다 차 27대를 다 보지 않고 그 칸에 걸친 차만 본다. 칸 번호는 작은 정수라 Map 열쇠로 써도 할당이 없다.
  const CAR_CELL = 8;
  const carCells = new Map(); // 칸 번호 → 그 칸에 걸친 차 번호들
  let carCellsFor = null; // 칸을 만든 차 목록(바뀌면 다시 만든다)
  const cellKey = (x, z) => (Math.floor(x / CAR_CELL) + 2048) * 4096 + (Math.floor(z / CAR_CELL) + 2048);
  function buildCarCells(cars) {
    carCells.clear();
    carCellsFor = cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
      for (let ix = Math.floor((c.x - 2.4) / CAR_CELL); ix <= Math.floor((c.x + 2.4) / CAR_CELL); ix++) {
        for (let iz = Math.floor((c.z - 2.4) / CAR_CELL); iz <= Math.floor((c.z + 2.4) / CAR_CELL); iz++) {
          const k = (ix + 2048) * 4096 + (iz + 2048);
          let list = carCells.get(k);
          if (!list) carCells.set(k, (list = []));
          list.push(i);
        }
      }
    }
  }
  /** 그 칸의 차 목록(list) 가운데 (x, y, z)를 품은 보이는 주차 차량 번호. 없거나 누가 타고 있으면 -1 */
  function carIn(cars, list, x, y, z) {
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      const c = cars[i];
      if (!c || !c.visible) continue;
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx > 2.4 || dx < -2.4 || dz > 2.4 || dz < -2.4 || y < c.y - 0.2 || y > c.y + CAR_H) continue;
      const s = Math.sin(c.rot);
      const co = Math.cos(c.rot);
      // 차 앞 방향 (sin rot, cos rot), 옆 방향 (cos rot, -sin rot)
      if (Math.abs(dx * s + dz * co) > CAR_HL || Math.abs(dx * co - dz * s) > CAR_HW) continue;
      if (carBusy(i)) continue;
      return i;
    }
    return -1;
  }

  /** 표면까지 거리: 점 (x, y, z)에서 세로 원기둥(밑면 중심 bx·by·bz, 반지름 r, 높이 h)까지 */
  function surfDist(x, y, z, bx, by, bz, r, h) {
    const dx = x - bx;
    const dz = z - bz;
    const hd = Math.max(0, Math.sqrt(dx * dx + dz * dz) - r);
    const dy = y < by ? by - y : y > by + h ? y - by - h : 0;
    return Math.sqrt(hd * hd + dy * dy);
  }
  const falloff = (dmg, dist, R) => Math.max(1, dmg * (1 - (1 - EDGE_DMG) * Math.min(1, dist / R)));

  // ---------- 조준 ----------
  /** 포구 자리. (fx, fz)는 몸이 보는 방향(단위 벡터), 옆은 아바타 로컬 +x = (fz, -fx) */
  function muzzleAt(w, x, y, z, fx, fz, out) {
    const m = MUZZLE[w];
    out.x = x + fx * m[0] + fz * m[1];
    out.y = y + m[2];
    out.z = z + fz * m[0] - fx * m[1];
    return out;
  }

  /** 자동 조준 후보 하나: 사거리·원뿔 안이면 수평 거리, 아니면 Infinity. rr은 대상의 반지름(가까울수록 원뿔을 조금 넓혀 준다) */
  function coneDist(dx, dz, rr, spec, near, fx, fz) {
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d - rr > spec.range || d < near) return Infinity;
    if (d > 1e-3) {
      const half = Math.min(Math.PI / 2, AIM_HALF + Math.atan2(rr, d));
      if ((dx * fx + dz * fz) / d < Math.cos(half)) return Infinity;
    }
    return d;
  }
  /**
   * 자동 조준: 카메라 정면 ±35°, 사거리 안에서 가장 가까운 무장한 사람(탑승자 포함)·과녁.
   * 폭발 무기는 폭발 반경보다 가까운 대상을 고르지 않는다. 대상이 없으면 카메라 정면 기본 거리의 지면. 찾았으면 true
   */
  function autoAim(w, out) {
    const spec = WEAPONS[w];
    const P = player.pos;
    const fx = cam.forward.x;
    const fz = cam.forward.z;
    const near = spec.radius > 0 ? spec.radius : 0;
    const melee = spec.kind === 'melee';
    let best = Infinity;
    out.peer = out.target = null;
    const peers = mayhem.armedPeers();
    for (let i = 0; i < peers.length; i++) {
      const r = peers[i];
      if (!fin3(r.x, r.y, r.z) || (melee && Math.abs(r.y - P.y) > 2)) continue;
      const rider = r.car >= 0;
      const d = coneDist(r.x - P.x, r.z - P.z, rider ? RIDER_R : BODY_R, spec, near, fx, fz);
      if (d < best) {
        best = d;
        out.peer = r;
        out.target = null;
        out.x = r.x;
        out.y = r.y + (rider ? RIDER_H : BODY_H) * 0.5;
        out.z = r.z;
      }
    }
    const ts = mayhem.targets;
    const zid = player.zone;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      if (!t || !t.alive || t.zone !== zid || !fin3(t.x, t.y, t.z)) continue;
      const h = t.height > 0 ? t.height : 2;
      if (melee && (P.y < t.y - 1.5 || P.y > t.y + h)) continue;
      const d = coneDist(t.x - P.x, t.z - P.z, t.radius > 0 ? t.radius : 0.5, spec, near, fx, fz);
      if (d < best) {
        best = d;
        out.peer = null;
        out.target = t;
        out.x = t.x;
        out.y = t.y + h * 0.5;
        out.z = t.z;
      }
    }
    if (best < Infinity) return true;
    const D = DEF_AIM[w] || 10;
    out.x = P.x + fx * D;
    out.z = P.z + fz * D;
    out.y = world.active.heightAt(out.x, out.z);
    return false;
  }

  /**
   * 찍은 화면 좌표(clientX, clientY) → 겨냥점. 카메라 광선을 직접 훑어(Raycaster 없이) 지형·건물 부피와 만나는 점을 찾는다.
   * 무장한 사람·과녁을 찍었으면 그 몸. 교점이 없으면 그 방향 사거리 끝의 지면.
   * 나에게서 max(3m, 반경 + 2m)보다 가깝거나 카메라 쪽이면 그 방향 최소 거리로 밀어낸다. 못 구하면 false
   */
  function tapAim(sx, sy, w, out) {
    const spec = WEAPONS[w];
    const canvas = engine.renderer && engine.renderer.domElement;
    if (!canvas || !camera || !Number.isFinite(sx) || !Number.isFinite(sy)) return false;
    // 위치는 화면상의 사각형에서, 크기는 렌더러가 쓰는 캔버스 크기에서(엔진의 화면비와 같게)
    const rect = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
    const left = rect && Number.isFinite(rect.left) ? rect.left : 0;
    const top = rect && Number.isFinite(rect.top) ? rect.top : 0;
    const W = canvas.clientWidth || (typeof innerWidth === 'number' ? innerWidth : 0);
    const H = canvas.clientHeight || (typeof innerHeight === 'number' ? innerHeight : 0);
    if (!(W > 0 && H > 0)) return false;
    camera.updateMatrixWorld();
    _v.set(((sx - left) / W) * 2 - 1, 1 - ((sy - top) / H) * 2, 0.5).unproject(camera);
    const ox = camera.position.x;
    const oy = camera.position.y;
    const oz = camera.position.z;
    _d.set(_v.x - ox, _v.y - oy, _v.z - oz);
    const len = _d.length();
    if (!(len > 1e-6)) return false;
    const dx = _d.x / len;
    const dy = _d.y / len;
    const dz = _d.z / len;
    const P = player.pos;
    const zone = world.active;
    // 광선의 수평 방향(거의 수직이면 카메라 정면)
    let hx = dx;
    let hz = dz;
    let hl = Math.sqrt(hx * hx + hz * hz);
    if (hl < 1e-3) {
      hx = cam.forward.x;
      hz = cam.forward.z;
      hl = Math.sqrt(hx * hx + hz * hz) || 1;
    }
    hx /= hl;
    hz /= hl;
    const minD = Math.max(3, (spec.radius > 0 ? spec.radius : 0) + 2);
    const depth = (P.x - ox) * dx + (P.y + 1.2 - oy) * dy + (P.z - oz) * dz; // 광선 위에서 주인공과 가장 가까운 자리
    const t0 = Math.max(0.3, depth - TAP_SKIP);
    const tMax = Math.min(MARCH_MAX, Math.max(t0 + 1, depth + spec.range + 30));
    let tHit = Infinity;
    out.peer = out.target = null;
    // 무장한 사람·과녁의 몸
    const peers = mayhem.armedPeers();
    for (let i = 0; i < peers.length; i++) {
      const r = peers[i];
      if (!fin3(r.x, r.y, r.z)) continue;
      const rider = r.car >= 0;
      const t = rayCyl(ox, oy, oz, dx, dy, dz, t0, r.x, r.z, rider ? RIDER_R : BODY_R, r.y - 0.1, r.y + (rider ? RIDER_H : BODY_H));
      if (t < tHit) {
        tHit = t;
        out.peer = r;
      }
    }
    const ts = mayhem.targets;
    for (let i = 0; i < ts.length; i++) {
      const tg = ts[i];
      if (!tg || !tg.alive || tg.zone !== player.zone || !fin3(tg.x, tg.y, tg.z)) continue;
      const t = rayCyl(ox, oy, oz, dx, dy, dz, t0, tg.x, tg.z, tg.radius > 0 ? tg.radius : 0.5, tg.y, tg.y + (tg.height > 0 ? tg.height : 2));
      if (t < tHit) {
        tHit = t;
        out.peer = null;
        out.target = tg;
      }
    }
    // 지형·건물: 간격을 두고 훑다가 들어간 곳을 이분법으로 좁힌다
    if (insideAt(zone, ox + dx * t0, oy + dy * t0, oz + dz * t0)) {
      if (t0 < tHit) {
        tHit = t0; // 주인공 깊이에서 이미 땅·벽 속: 카메라 쪽을 찍은 것이다(아래에서 밀어낸다)
        out.peer = out.target = null;
      }
    } else {
      let prev = t0;
      for (let t = t0 + MARCH_STEP; t <= tMax && t < tHit; t += MARCH_STEP) {
        const y = oy + dy * t;
        if (dy > 0 && y > SKY_Y) break;
        if (insideAt(zone, ox + dx * t, y, oz + dz * t)) {
          let lo = prev;
          let hi = t;
          for (let k = 0; k < 8; k++) {
            const m = (lo + hi) * 0.5;
            if (insideAt(zone, ox + dx * m, oy + dy * m, oz + dz * m)) hi = m;
            else lo = m;
          }
          if (hi < tHit) {
            tHit = hi;
            out.peer = out.target = null;
          }
          break;
        }
        prev = t;
      }
    }
    if (tHit < Infinity) {
      out.x = ox + dx * tHit;
      out.y = oy + dy * tHit;
      out.z = oz + dz * tHit;
    } else {
      // 하늘을 찍었다: 그 방향 사거리 끝의 지면
      out.x = P.x + hx * spec.range;
      out.z = P.z + hz * spec.range;
      out.y = zone.heightAt(out.x, out.z);
    }
    const vx = out.x - P.x;
    const vz = out.z - P.z;
    if (vx * vx + vz * vz < minD * minD || vx * hx + vz * hz < 0) {
      out.x = P.x + hx * minD;
      out.z = P.z + hz * minD;
      out.y = zone.heightAt(out.x, out.z);
      out.peer = out.target = null;
    }
    return fin3(out.x, out.y, out.z);
  }

  // ---------- 쏘기 ----------
  /** 탄 자리 하나. 남의 재현은 빈자리가 있을 때만 쓰고, 내 탄은 가득 차 있으면 남의 재현(없으면 내 것) 중 가장 오래된 것을 밀어낸다 */
  function takeSlot(pool, mine) {
    const items = pool.items;
    let old = null;
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      if (!s.on) {
        pool.alive++;
        return s;
      }
      if (!old || (old.mine && !s.mine) || (old.mine === s.mine && s.seq < old.seq)) old = s;
    }
    return mine ? old : null;
  }

  /** 탄 하나를 (mx, my, mz)에서 (ax, ay, az)로 쏜다. 자리가 없으면 null */
  function launch(w, mine, by, zid, zone, mx, my, mz, ax, ay, az) {
    const pool = pools[w];
    if (!pool) return null;
    const s = takeSlot(pool, mine);
    if (!s) return null;
    const spec = WEAPONS[w];
    s.on = true;
    s.mine = mine;
    s.by = by;
    s.zid = zid;
    s.zone = zone;
    s.x = mx;
    s.y = my;
    s.z = mz;
    s.age = 0;
    s.travel = 0;
    s.trail = 0;
    s.seq = ++shotSeq;
    s.g = spec.gravity > 0 ? spec.gravity : 0;
    let dx = ax - mx;
    let dy = ay - my;
    let dz = az - mz;
    if (spec.kind === 'shell') {
      // 대포알: 비행시간으로 처음 속도를 구한다(사거리로 자른다)
      rules.shellLaunch(dx, dy, dz, spec, _shell);
      s.vx = _shell.vx;
      s.vy = _shell.vy;
      s.vz = _shell.vz;
      s.life = _shell.t + 4;
      s.range = Infinity;
    } else {
      let L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(L > 1e-3)) {
        dx = 0;
        dy = 0;
        dz = 1;
        L = 1;
      }
      const k = spec.speed / L;
      s.vx = dx * k;
      s.vy = dy * k;
      s.vz = dz * k;
      // 물총은 조금 처진다: 닿을 때까지 떨어질 만큼 위로 겨눈다
      if (s.g > 0) s.vy += 0.5 * s.g * (L / spec.speed);
      s.range = spec.range;
      s.life = spec.range / spec.speed + 1;
    }
    return s;
  }

  /** 지금 든 무기 w로 (ax, ay, az)를 쏜다(조건·쿨다운은 부르는 쪽이 확인). 쐈으면 true */
  function fire(w, ax, ay, az) {
    const spec = WEAPONS[w];
    if (!spec || !fin3(ax, ay, az)) return false;
    if (!mayhem.bumpAtk(ax, az)) return false; // 공격 횟수·겨냥점·전투 잠금·내 아바타 동작
    readyAt[w] = engine.time + spec.cd;
    tapBuf.on = false;
    const P = player.pos;
    const ex = ax - P.x;
    const ez = az - P.z;
    if (ex * ex + ez * ez > 1e-6) player.yaw = Math.atan2(ex, ez); // 겨냥한 쪽으로 돌아선다
    const fx = Math.sin(player.yaw);
    const fz = Math.cos(player.yaw);
    if (spec.kind === 'melee') {
      punch.on = true;
      punch.at = engine.time + PUNCH_DELAY;
      punch.ux = fx;
      punch.uz = fz;
      return true;
    }
    muzzleAt(w, P.x, P.y, P.z, fx, fz, _mz);
    launch(w, true, '', player.zone, world.active, _mz.x, _mz.y, _mz.z, ax, ay, az);
    if (w === 2) sfx.squirt();
    else if (spec.kind === 'shell') {
      sfx.launch(true);
      gfx.smoke(_mz.x, _mz.y, _mz.z, MUZ_SMOKE);
      gfx.sparks(_mz.x, _mz.y, _mz.z, MUZ_SPARK);
    } else {
      sfx.launch();
      gfx.sparks(_mz.x, _mz.y, _mz.z, MUZ_SPARK);
    }
    return true;
  }

  /** 휘두른 지 0.1초 뒤: 사거리·호 안의 무장한 사람(주장)과 과녁(직접)에 주먹 피해 */
  function inArc(dx, dz, rr, spec) {
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d - rr > spec.range) return false;
    if (d < 1e-3) return true;
    const half = Math.min(Math.PI / 2, spec.arc * 0.5 + Math.atan2(rr, d));
    return (dx * punch.ux + dz * punch.uz) / d >= Math.cos(half);
  }
  function resolvePunch() {
    punch.on = false;
    if (mayhem.state.ko || player.mount) return;
    const spec = WEAPONS[1];
    const P = player.pos;
    let hits = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    const peers = mayhem.armedPeers();
    for (let i = 0; i < peers.length; i++) {
      const r = peers[i];
      if (!fin3(r.x, r.y, r.z) || Math.abs(r.y - P.y) > 2) continue;
      if (!inArc(r.x - P.x, r.z - P.z, r.car >= 0 ? RIDER_R : BODY_R, spec)) continue;
      mayhem.claimHit(r.id, spec.dmg, 1, r.x, r.z);
      if (!hits++) {
        cx = r.x;
        cy = r.y + 1.3;
        cz = r.z;
      }
    }
    const ts = mayhem.targets;
    for (let i = ts.length - 1; i >= 0; i--) {
      const t = ts[i];
      if (!t || !t.alive || t.zone !== player.zone || typeof t.hurt !== 'function' || !fin3(t.x, t.y, t.z)) continue;
      const h = t.height > 0 ? t.height : 2;
      if (P.y < t.y - 1.5 || P.y > t.y + h) continue;
      if (!inArc(t.x - P.x, t.z - P.z, t.radius > 0 ? t.radius : 0.5, spec)) continue;
      callHurt(t, spec.dmg, 1, t.x, t.z);
      if (!hits++) {
        cx = t.x;
        cy = Math.min(t.y + h * 0.5, P.y + 1.4);
        cz = t.z;
      }
    }
    if (!hits) return;
    sfx.punch();
    gfx.comic('퍽!', cx, cy + 0.5, cz, COMIC_PUNCH);
    gfx.sparks(cx, cy, cz, PUNCH_SPARK);
  }

  function jamHint() {
    if (engine.time - jamHintAt < JAM_HINT_GAP) return;
    jamHintAt = engine.time;
    sfx.jam();
    const P = player.pos;
    gfx.comic('고장!', P.x, P.y + 2.5, P.z, COMIC_JAM);
  }

  /** 이번 프레임의 화면 찍기: 같은 발사 조건·쿨다운을 따른다. 쿨다운이 조금만 남았으면 기억해 뒀다 쏜다 */
  function handleTap(w) {
    if (!w) return;
    if (!canFire()) {
      if (mayhem.isJammed() && mayhem.canArm()) jamHint();
      return;
    }
    const left = cdLeft(w);
    if (left > TAP_BUFFER) return;
    if (!tapAim(tapReq.sx, tapReq.sy, w, _tap)) return;
    if (left <= 0) {
      fire(w, _tap.x, _tap.y, _tap.z);
      return;
    }
    tapBuf.on = true;
    tapBuf.w = w;
    tapBuf.x = _tap.x;
    tapBuf.y = _tap.y;
    tapBuf.z = _tap.z;
    tapBuf.until = engine.time + left + 0.05;
  }

  // ---------- 탄 움직이기·판정 ----------
  function kill(pool, s) {
    if (!s.on) return;
    s.on = false;
    s.zone = null;
    pool.alive--;
  }

  /** 폭발: 효과 + 'explosion' 알림. 내 것이면 반경 안의 무장한 사람(주장)·과녁·나(절반)에게 거리 감쇠 피해 */
  function explode(s, x, y, z, tag) {
    const w = s.w;
    const spec = WEAPONS[w];
    const big = spec.kind === 'shell';
    const mine = s.mine;
    const drawn = gfx.explosion(x, y, z, mine ? (big ? EXP_SH : EXP_RK) : big ? EXPQ_SH : EXPQ_RK);
    if (drawn) {
      gfx.comic(big ? '쾅!' : '펑!', x, y + spec.radius * 0.35 + 0.8, z, big ? COMIC_BIG : COMIC_POP);
      if (!mine) sfx.at('boom', distToMe(x, y, z));
    }
    if (mine) blast(w, x, y, z, s.zid);
    bus.emit('explosion', { zone: s.zid, x, y, z, radius: spec.radius, dmg: mine ? spec.dmg : 0, bdmg: mine ? spec.bdmg || 0 : 0, by: mine ? 'me' : s.by, w, tag: tag || null });
  }

  function blast(w, x, y, z, zid) {
    const spec = WEAPONS[w];
    const R = spec.radius;
    if (zid === player.zone) {
      const peers = mayhem.armedPeers();
      for (let i = 0; i < peers.length; i++) {
        const r = peers[i];
        if (!fin3(r.x, r.y, r.z)) continue;
        const rider = r.car >= 0;
        const dist = surfDist(x, y, z, r.x, r.y, r.z, rider ? RIDER_R : BODY_R, rider ? RIDER_H : BODY_H);
        if (dist <= R) mayhem.claimHit(r.id, falloff(spec.dmg, dist, R), w, x, z);
      }
    }
    const ts = mayhem.targets;
    for (let i = ts.length - 1; i >= 0; i--) {
      const t = ts[i];
      if (!t || !t.alive || t.zone !== zid || typeof t.hurt !== 'function' || !fin3(t.x, t.y, t.z)) continue;
      const dist = surfDist(x, y, z, t.x, t.y, t.z, t.radius > 0 ? t.radius : 0.5, t.height > 0 ? t.height : 2);
      if (dist <= R) callHurt(t, falloff(spec.dmg, dist, R), w, x, z);
    }
    // 내 폭발에 나도 휘말린다(무장했을 때만 — 평화는 무적)
    if (mayhem.state.wpn > 0 && zid === player.zone) {
      const P = player.pos;
      const dist = surfDist(x, y, z, P.x, P.y, P.z, BODY_R, BODY_H);
      if (dist <= R) {
        const d = falloff(spec.dmg, dist, R) * SELF_SHARE;
        let kx = P.x - x;
        let kz = P.z - z;
        const l = Math.sqrt(kx * kx + kz * kz);
        const k = Math.min(LIMITS.maxKnock, spec.knock * Math.min(1, d / spec.maxHit));
        if (l > 1e-3) {
          kx = (kx / l) * k;
          kz = (kz / l) * k;
        } else {
          kx = k;
          kz = 0;
        }
        mayhem.hurt(d, { by: 'self', w, kx, kz });
      }
    }
  }

  /** 물총이 맞은 자리: 물보라 + (내 것이면) 맞은 사람·과녁에 피해 */
  function splashHit(s, x, y, z, peer, target) {
    gfx.splash(x, y, z, s.mine ? 10 : 5);
    if (!s.mine) return;
    const spec = WEAPONS[s.w];
    if (peer) mayhem.claimHit(peer.id, spec.dmg, s.w, x, z);
    else if (target) callHurt(target, spec.dmg, s.w, x, z);
  }

  /** 맞은 자리를 다듬고(지면·지붕·벽면) 터뜨린다 */
  function impact(pool, s, kind, body, x, y, z, ox, oy, oz) {
    let tag = null;
    const zone = s.zone;
    if (kind === HIT_ENV) {
      if (insideAt(zone, x, y, z) === 2 && envSolid) {
        const sol = envSolid;
        tag = sol.tag || null;
        if (zone.collider.solidAt(ox, oz) === sol) {
          const roof = roofOf(sol);
          if (Number.isFinite(roof) && oy >= roof) y = roof + 0.15; // 같은 건물 위에서 내려왔다: 지붕에서 터진다
          else {
            // 벽에 붙어 쏴서 포구가 이미 벽 속이었다: 그 자리에서
            x = ox;
            y = oy;
            z = oz;
          }
        } else {
          // 벽에 맞았다: 폭발 자리를 벽면 바로 바깥으로 맞춘다
          const hit = zone.collider.raycast(ox, oz, x, z);
          if (hit && hit.solid === sol) {
            const l = Math.sqrt((x - ox) * (x - ox) + (z - oz) * (z - oz)) || 1;
            y = oy + (y - oy) * hit.t;
            x = hit.x - ((x - ox) / l) * 0.3;
            z = hit.z - ((z - oz) / l) * 0.3;
          }
        }
      } else y = zone.heightAt(x, z) + 0.15;
    }
    kill(pool, s);
    if (s.w === 2) splashHit(s, x, y, z, kind === HIT_PEER ? body : null, kind === HIT_TARGET ? body : null);
    else explode(s, x, y, z, tag);
  }

  /** 한 걸음(s.ox·oy·oz → 지금 자리) 안에서 가장 먼저 맞은 것을 찾아 처리한다. 맞았으면 true */
  function hitTest(pool, s) {
    const zone = s.zone;
    const ox = s.ox;
    const oy = s.oy;
    const oz = s.oz;
    const ex = s.x - ox;
    const ey = s.y - oy;
    const ez = s.z - oz;
    let best = 2;
    let kind = 0;
    let body = null;
    // 지형·건물 부피: 끝점이 안이면 이분법으로 들어간 자리를 찾는다
    if (insideEnv(zone, s)) {
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 7; k++) {
        const m = (lo + hi) * 0.5;
        if (insideAt(zone, ox + ex * m, oy + ey * m, oz + ez * m)) hi = m;
        else lo = m;
      }
      best = hi;
      kind = HIT_ENV;
    }
    // 사람·과녁(폭발탄은 3m 날아간 뒤부터). 이 걸음이 닿을 수 없을 만큼 먼 것은 계산 없이 건너뛴다
    if (s.w < 3 || s.travel >= ARM_DIST) {
      const seg = Math.sqrt(ex * ex + ez * ez);
      const peers = mayhem.armedPeers();
      for (let i = 0; i < peers.length; i++) {
        const r = peers[i];
        const rider = r.car >= 0;
        const rr = rider ? RIDER_R : BODY_R;
        const qx = r.x - ox;
        const qz = r.z - oz;
        const reach = seg + rr;
        if (!(qx * qx + qz * qz <= reach * reach) || r.id === s.by || !Number.isFinite(r.y)) continue;
        const t = rayCyl(ox, oy, oz, ex, ey, ez, 0, r.x, r.z, rr, r.y - 0.1, r.y + (rider ? RIDER_H : BODY_H));
        if (t <= 1 && t < best) {
          best = t;
          kind = HIT_PEER;
          body = r;
        }
      }
      // 남의 탄은 무장한 나에게도 맞는다(보이기만 — 실제 피해는 그 사람이 보낸 주장으로 온다)
      if (!s.mine && GAME.pvp && mayhem.state.wpn > 0 && !mayhem.state.ko && !player.mount) {
        const P = player.pos;
        const qx = P.x - ox;
        const qz = P.z - oz;
        const reach = seg + BODY_R;
        if (qx * qx + qz * qz <= reach * reach) {
          const t = rayCyl(ox, oy, oz, ex, ey, ez, 0, P.x, P.z, BODY_R, P.y - 0.1, P.y + BODY_H);
          if (t <= 1 && t < best) {
            best = t;
            kind = HIT_ME;
            body = null;
          }
        }
      }
      const ts = mayhem.targets;
      for (let i = 0; i < ts.length; i++) {
        const tg = ts[i];
        if (!tg || !tg.alive || tg.zone !== s.zid) continue;
        const rr = tg.radius > 0 ? tg.radius : 0.5;
        const qx = tg.x - ox;
        const qz = tg.z - oz;
        const reach = seg + rr;
        if (!(qx * qx + qz * qz <= reach * reach) || !Number.isFinite(tg.y)) continue;
        const t = rayCyl(ox, oy, oz, ex, ey, ez, 0, tg.x, tg.z, rr, tg.y, tg.y + (tg.height > 0 ? tg.height : 2));
        if (t <= 1 && t < best) {
          best = t;
          kind = HIT_TARGET;
          body = tg;
        }
      }
    }
    // 보이는 주차 차량(캠퍼스 전용): 차가 걸친 칸일 때만 상자를 본다
    const cars = zone === world.campus && world.props ? world.props.cars : null;
    if (cars) {
      if (carCellsFor !== cars) buildCarCells(cars);
      for (let k = 0; k < CAR_PROBE.length; k++) {
        const m = CAR_PROBE[k];
        if (m >= best) break;
        const list = carCells.get(cellKey(ox + ex * m, oz + ez * m));
        if (list && carIn(cars, list, ox + ex * m, oy + ey * m, oz + ez * m) >= 0) {
          best = m;
          kind = HIT_CAR;
          body = null;
          break;
        }
      }
    }
    if (!kind) return false;
    impact(pool, s, kind, body, ox + ex * best, oy + ey * best, oz + ez * best, ox, oy, oz);
    return true;
  }

  /** 수명·사거리가 다 됐다: 물총은 사라지고, 폭죽·대포알은 그 자리에서 터진다 */
  function expire(pool, s) {
    kill(pool, s);
    if (s.w !== 2) explode(s, s.x, s.y, s.z, null);
  }

  function trail(s, dt) {
    if (s.w === 2) return;
    s.trail += dt;
    const rocket = s.w === 3;
    if (s.trail < (rocket ? 0.03 : 0.045)) return;
    s.trail = 0;
    if (rocket) {
      const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz) || 1;
      trailFlip ^= 1;
      TRAIL_RK.color = trailFlip ? 0xffd23f : 0xff7a2e;
      gfx.sparks(s.x - (s.vx / sp) * 0.45, s.y - (s.vy / sp) * 0.45, s.z - (s.vz / sp) * 0.45, TRAIL_RK);
    } else gfx.sparks(s.x, s.y + 0.45, s.z, TRAIL_SH);
  }

  function stepShot(pool, s, dt) {
    if (s.zid !== player.zone) {
      kill(pool, s); // 내가 다른 구역으로 옮겼다
      return;
    }
    s.age += dt;
    const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
    const n = Math.min(24, Math.max(1, Math.ceil((sp * dt) / SUBSTEP)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      s.ox = s.x;
      s.oy = s.y;
      s.oz = s.z;
      s.vy -= s.g * h;
      s.x += s.vx * h;
      s.y += s.vy * h;
      s.z += s.vz * h;
      if (hitTest(pool, s)) return;
      const dx = s.x - s.ox;
      const dy = s.y - s.oy;
      const dz = s.z - s.oz;
      s.travel += Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (s.travel >= s.range) {
        expire(pool, s);
        return;
      }
    }
    if (s.age >= s.life) {
      expire(pool, s);
      return;
    }
    trail(s, dt);
  }

  /**
   * 살아 있는 탄을 인스턴스 앞쪽에 모아 그린다(count = 살아 있는 수).
   * 행렬은 Matrix4·setMatrixAt을 거치지 않고 인스턴스 배열에 바로 쓴다(숫자를 상자에 담느라 프레임마다 메모리를 쓰지 않게).
   * 회전은 +z를 날아가는 방향 (dx, dy, dz)로 돌리는 사원수 = 정규화(-dy, dx, 0, 1 + dz) (Quaternion.setFromUnitVectors와 같다).
   */
  function renderPool(pool) {
    const mesh = pool.mesh;
    const items = pool.items;
    const arr = mesh.instanceMatrix.array;
    const sz = pool.scaleZ;
    const turn = pool.w !== 4; // 대포알은 돌리지 않는다(도화선이 늘 위)
    let k = 0;
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      if (!s.on) continue;
      let qx = 0;
      let qy = 0;
      let qw = 1;
      if (turn) {
        const l = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
        if (l > 1e-6) {
          const dz = s.vz / l;
          if (dz < -0.999999) {
            qy = 1; // 정반대(-z): y축으로 반 바퀴
            qw = 0;
          } else {
            qx = -s.vy / l;
            qy = s.vx / l;
            qw = 1 + dz;
            const n = Math.sqrt(qx * qx + qy * qy + qw * qw);
            qx /= n;
            qy /= n;
            qw /= n;
          }
        }
      }
      // Matrix4.compose(위치, (qx, qy, 0, qw), (1, 1, sz))를 열 우선으로 펼친 것
      const x2 = qx + qx;
      const y2 = qy + qy;
      const xx = qx * x2;
      const xy = qx * y2;
      const yy = qy * y2;
      const wx = qw * x2;
      const wy = qw * y2;
      const o = k * 16;
      arr[o] = 1 - yy;
      arr[o + 1] = xy;
      arr[o + 2] = -wy;
      arr[o + 3] = 0;
      arr[o + 4] = xy;
      arr[o + 5] = 1 - xx;
      arr[o + 6] = wx;
      arr[o + 7] = 0;
      arr[o + 8] = wy * sz;
      arr[o + 9] = -wx * sz;
      arr[o + 10] = (1 - (xx + yy)) * sz;
      arr[o + 11] = 0;
      arr[o + 12] = s.x;
      arr[o + 13] = s.y;
      arr[o + 14] = s.z;
      arr[o + 15] = 1;
      k++;
    }
    mesh.count = k;
    mesh.visible = k > 0;
    if (k > 0) mesh.instanceMatrix.needsUpdate = true;
  }

  function stepPool(pool, dt) {
    const items = pool.items;
    for (let i = 0; i < items.length; i++) if (items[i].on) stepShot(pool, items[i], dt);
    renderPool(pool);
  }

  // ---------- 남의 발사 재현 ----------
  // 몫(초당 16발)은 모두가 나눠 쓴다. remotes.map 순서대로 앞사람이 먼저 쓰면, 먼저 들어와 연사하는 위조 id 몇 개가 몫을 다 가져가
  // 진짜 공격자의 탄이 안 보이게 된다. 그래서 (1) 쏜 자리나 겨냥점이 80m 안인 가까운 사람을 먼저, 먼 사람은 몫이 절반 넘게 남았을 때만,
  // (2) 같은 무리 안에서는 가장 오래 재현받지 못한 사람에게 먼저 차례를 줘 고르게 나눈다(id를 늘려도 한 사람 몫씩만 가져간다).
  // (3) 몫이 모자란 프레임에는 밀린 재현을 버리지 않고 다음 차례까지 둔다(사람마다 2발까지, 마지막 공격에서 1초가 지나면 버린다) —
  //     버리면 연사를 끊임없이 채워 넣는 쪽만 몫을 받게 된다.
  // rstate: remotes 기록 → { seen: 본 atkEvents, pending: 밀린 재현 수, at: 마지막으로 공격이 는 시각, next: 무기별 다음 재현 가능 시각,
  //                         near: 이번 프레임에 가까운가, last: 마지막으로 재현한 시각, done: 재현한 수 }
  const rstate = new WeakMap();
  let replayTokens = REPLAY_RATE;
  let replayed = 0; // 지금까지 재현한 수(시험·점검용)
  const cands = []; // 이번 프레임에 재현할 것이 밀려 있는 기록(배열을 다시 만들지 않고 자리를 덮어쓴다)
  let nCand = 0;
  function replay(r, pose, w) {
    const spec = WEAPONS[w];
    const zone = world.active; // pose.zone === 내 구역일 때만 온다
    let ax = pose.ax;
    let az = pose.az;
    const dx = ax - pose.x;
    const dz = az - pose.z;
    let hd = Math.sqrt(dx * dx + dz * dz);
    if (hd > spec.range) {
      ax = pose.x + (dx / hd) * spec.range;
      az = pose.z + (dz / hd) * spec.range;
      hd = spec.range;
    }
    let fx;
    let fz;
    if (hd > 1e-3) {
      fx = (ax - pose.x) / hd;
      fz = (az - pose.z) / hd;
    } else {
      fx = Number.isFinite(pose.yaw) ? Math.sin(pose.yaw) : 0;
      fz = Number.isFinite(pose.yaw) ? Math.cos(pose.yaw) : 1;
    }
    const dist = distToMe(pose.x, pose.y, pose.z);
    if (spec.kind === 'melee') {
      sfx.at('punch', dist);
      return;
    }
    muzzleAt(w, pose.x, pose.y, pose.z, fx, fz, _mz);
    // 겨냥점은 (ax, az)뿐이다: 사람을 겨눴을 수도 있으니 지면보다 조금 위로(대포는 지면)
    const ay = zone.heightAt(ax, az) + (spec.kind === 'shell' ? 0 : 0.6);
    launch(w, false, r.id, pose.zone, zone, _mz.x, _mz.y, _mz.z, ax, ay, az);
    if (w === 2) sfx.at('squirt', dist);
    else sfx.at('launch', dist, spec.kind === 'shell');
  }

  /** 늘어난 공격 수를 밀린 재현에 더하고, 재현할 것이 있으면 이번 프레임 후보(cands)에 올린다 */
  function collectRemote(r) {
    let st = rstate.get(r);
    if (!st) {
      // 처음 보는 기록: 지금까지 센 공격은 지난 일이다
      rstate.set(r, { seen: r.atkEvents, pending: 0, at: 0, next: new Array(NW).fill(0), near: false, last: -Infinity, done: 0 });
      return;
    }
    const n = r.atkEvents - st.seen;
    st.seen = r.atkEvents;
    if (n > 0) {
      st.pending = Math.min(REPLAY_PENDING, st.pending + n);
      st.at = engine.time;
    }
    if (st.pending <= 0) return;
    if (engine.time - st.at > REPLAY_STALE) {
      st.pending = 0; // 몫이 없어 너무 오래 밀렸다: 늦은 재현은 하지 않는다
      return;
    }
    const pose = r.atkPose;
    const w = pose ? pose.w : 0;
    if (!pose || pose.zone !== player.zone || !Number.isInteger(w) || w < 1 || w >= NW || !fin3(pose.x, pose.y, pose.z) || !Number.isFinite(pose.ax) || !Number.isFinite(pose.az)) {
      st.pending = 0; // 다른 구역이거나 이상한 값: 재현하지 않는다
      return;
    }
    if (engine.time < st.next[w]) return; // 같은 사람·무기는 쿨다운 × 0.8 간격으로(밀린 것은 그대로 둔다)
    const mx = player.pos.x;
    const mz = player.pos.z;
    const nr = REPLAY_NEAR * REPLAY_NEAR;
    st.near = (pose.x - mx) * (pose.x - mx) + (pose.z - mz) * (pose.z - mz) <= nr || (pose.ax - mx) * (pose.ax - mx) + (pose.az - mz) * (pose.az - mz) <= nr;
    cands[nCand++] = r;
  }
  /**
   * 몫이 keep보다 1 넘게 남아 있는 동안, near 무리(가까운 사람 / 먼 사람)에서 재현할 수 있는 사람 중
   * 가장 오래 재현받지 못한 사람부터 한 발씩 재현한다. 재현하면 그 사람은 쿨다운 × 0.8 동안 차례에서 빠진다
   */
  function replayGroup(near, keep) {
    const t = engine.time;
    while (replayTokens >= 1 + keep) {
      let best = null;
      let bestSt = null;
      for (let i = 0; i < nCand; i++) {
        const r = cands[i];
        const st = rstate.get(r);
        if (st.near !== near || st.pending <= 0 || t < st.next[r.atkPose.w]) continue;
        if (!bestSt || st.last < bestSt.last) {
          best = r;
          bestSt = st;
        }
      }
      if (!best) return;
      const pose = best.atkPose;
      const w = pose.w;
      bestSt.pending--;
      bestSt.last = t;
      bestSt.done++;
      bestSt.next[w] = t + WEAPONS[w].cd * REPLAY_GAP;
      replayTokens -= 1;
      replayed++;
      replay(best, pose, w);
    }
  }
  /** 남의 발사 재현: 가까운 사람부터, 무리 안에서는 가장 오래 기다린 사람부터 몫을 나눈다 */
  function replayRemotes() {
    nCand = 0;
    remotes.map.forEach(collectRemote);
    // 지난 프레임보다 줄었으면 남은 칸은 비워 둔다(나간 사람의 기록을 붙잡고 있지 않게)
    for (let i = nCand; i < cands.length && cands[i] !== null; i++) cands[i] = null;
    if (!nCand) return;
    replayGroup(true, 0);
    replayGroup(false, REPLAY_FAR_KEEP);
  }

  // ---------- 입력·알림 ----------
  // 찍기는 여기서 기억만 하고 update에서 처리한다(같은 발사 조건·쿨다운을 거치고, 오류가 나도 모듈 갱신의 보호 안에서 난다)
  input.on('aimtap', (e) => {
    if (!e || !Number.isFinite(e.x) || !Number.isFinite(e.y)) return;
    tapReq.on = true;
    tapReq.sx = e.x;
    tapReq.sy = e.y;
  });
  function clearAll() {
    for (let k = 2; k < pools.length; k++) {
      const pool = pools[k];
      for (const s of pool.items) {
        s.on = false;
        s.zone = null;
      }
      pool.alive = 0;
      pool.mesh.count = 0;
      pool.mesh.visible = false;
    }
    punch.on = false;
    tapBuf.on = false;
    tapReq.on = false;
  }
  player.on('zone', clearAll); // 구역을 옮기면 날던 탄은 모두 사라진다
  bus.on('ko', () => {
    punch.on = false;
    tapBuf.on = false;
    tapReq.on = false;
  });
  bus.on('armed', (e) => {
    if (e && !e.on) {
      punch.on = false;
      tapBuf.on = false;
    }
  });

  function update(dt) {
    if (!(dt > 0)) dt = 0;
    const st = mayhem.state;
    const w = st.wpn > 0 && st.wpn < NW ? st.wpn : 0;
    const jammed = mayhem.isJammed();
    // 쿨다운 막(남은 비율: 방금 쐈으면 1, 준비됐으면 0). 고장 중에는 가득 덮는다. ui가 바뀔 때만 DOM을 고친다
    ui.setWeapon(w, w ? (jammed ? 1 : Math.min(1, cdLeft(w) / WEAPONS[w].cd)) : 0);

    // 찍은 곳으로
    if (tapReq.on) {
      tapReq.on = false;
      handleTap(w);
    }
    if (tapBuf.on) {
      if (tapBuf.w !== w || engine.time > tapBuf.until || !canFire()) tapBuf.on = false;
      else if (cdLeft(w) <= 0) fire(w, tapBuf.x, tapBuf.y, tapBuf.z);
    }
    // 누르고 있으면 자동 조준
    if (input.fire && w) {
      if (canFire()) {
        if (cdLeft(w) <= 0) {
          autoAim(w, _aim);
          fire(w, _aim.x, _aim.y, _aim.z);
        }
      } else if (jammed && mayhem.canArm() && !ui.panel.isOpen()) jamHint();
    }
    if (punch.on && engine.time >= punch.at) resolvePunch();

    // 남의 발사 재현
    replayTokens = Math.min(REPLAY_RATE, replayTokens + dt * REPLAY_RATE);
    replayRemotes();

    // 탄(살아 있는 것이 있는 풀만)
    for (let k = 2; k < pools.length; k++) if (pools[k].alive > 0) stepPool(pools[k], dt);
  }

  return {
    update,
    /** 시험·디버그: 지금 든 무기로 (x, y, z)를 쏜다. 발사 조건·쿨다운은 그대로 따른다. 쐈으면 true */
    fireAt(x, y, z) {
      const w = mayhem.state.wpn;
      if (!fin3(x, y, z) || !canFire() || cdLeft(w) > 0) return false;
      return fire(w, x, y, z);
    },
    /** 시험·디버그: 화면 좌표를 찍었을 때의 겨냥점 { x, y, z, peer(id), target(id) }(쏘지는 않는다). w를 생략하면 지금 든 무기 */
    tapAim(sx, sy, w = mayhem.state.wpn) {
      const ww = Number.isInteger(w) && w >= 1 && w < NW ? w : 2;
      if (!tapAim(sx, sy, ww, _tap)) return null;
      return { x: _tap.x, y: _tap.y, z: _tap.z, peer: _tap.peer ? _tap.peer.id : null, target: _tap.target ? _tap.target.id || true : null };
    },
    /** 시험·디버그: 지금 자동 조준이 고를 겨냥점 { x, y, z, peer(id), target(id), found } */
    autoAim(w = mayhem.state.wpn) {
      const ww = Number.isInteger(w) && w >= 1 && w < NW ? w : 2;
      const found = autoAim(ww, _aim);
      return { x: _aim.x, y: _aim.y, z: _aim.z, peer: _aim.peer ? _aim.peer.id : null, target: _aim.target ? _aim.target.id || true : null, found };
    },
    /** 그 무기의 남은 쿨다운(초) */
    cooldown(w = mayhem.state.wpn) {
      return Number.isInteger(w) && w >= 1 && w < NW ? cdLeft(w) : 0;
    },
    /** 시험·점검용: 날고 있는 탄 수 */
    stats() {
      let mine = 0;
      let remote = 0;
      for (let k = 2; k < pools.length; k++) for (const s of pools[k].items) if (s.on) s.mine ? mine++ : remote++;
      return { squirt: pools[2].alive, rocket: pools[3].alive, shell: pools[4].alive, mine, remote, replayed, replayTokens };
    },
    /** 시험·점검용: 그 사람(id)의 발사를 지금까지 재현한 수 */
    replayedBy(id) {
      const r = remotes.get(id);
      const st = r ? rstate.get(r) : null;
      return st ? st.done : 0;
    },
    /** 날고 있는 탄을 모두 지운다 */
    clear: clearAll,
  };
}
