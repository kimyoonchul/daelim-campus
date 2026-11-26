// 가상 보스(설계서 5.4): boss-data.js의 BOSSES를 읽어 움직이는 엔진. 다른 장소 버전에서는 데이터 파일만 바꾼다.
// ctx = { engine, world, player, cam, input, ui, net, remotes, store, profile, game, mayhem, bus, gfx, rules, sfx, GAME }
//
// 흐름: 잠 → 깨어남(무장한 내가 wake 안에 오거나, 내가 때리거나, 남의 피해 주장이 받아들여질 때) → 전투 → 격파 → 180초 뒤 재등장.
//   무장한 사람이 20초 넘게 근처에 없으면 둥지로 돌아가 다시 잠들고, 잠든 동안 초당 2%씩 회복한다.
// 보스의 움직임·기술은 통신으로 맞추지 않는다. 화면마다 따로 돌고, 기술은 "내 화면의 나"에게만 피해를 준다
//   (다른 사람이 맞는지는 그 사람 화면이 계산한다). 평화 상태(무기 없음)·기절·무적인 나는 맞지 않고 탄도 그냥 지나간다.
//   내가 무장하지 않았으면 가까운 무장한 사람을 상대로 싸우는 모습만 보여 준다(그 사람에게 피해를 주지는 않는다).
// 체력만 피해 주장으로 맞춘다: 내가 준 피해는 mayhem.claimBoss로 알리고, 남의 주장(bus 'bossClaim')은 여기서 검사한다.
//   원격 피해만으로는 1 아래로 내리지 않으므로, 격파는 내 막타이거나 "막타를 쳤다"는 boss 이벤트(내 화면 체력 20% 이하일 때)로만 일어난다.
//   boss 이벤트에는 막타 직전 1.5초 동안 그 사람이 준 피해(d)가 실려 온다 — 아직 못 받은 fx 묶음 몫이라, 남의 주장과 같은 검사·상한으로 먼저 반영한 뒤 20%를 본다.
// 내 피해는 hitR(= wake와 그 보스 기술 중 가장 긴 사거리 중 짧은 쪽) 안에서만 인정한다 — 보스가 반격할 수 없는 거리에서 안전하게 잡지 못하게.
// 과녁(mayhem.targets)에는 내가 실제로 피해를 줄 수 있을 만큼 가까울 때(wake 부근 안)만 올린다 — 그보다 먼 곳에서 준 피해는 어차피 무시한다.
// 시간: 게임 타이머는 engine.time(초), 받은 주장의 빈도 제한·알림 간격만 performance.now()(ms).
// 탄·글자 탄은 보스마다 처음에 만든 스프라이트 풀(40개, 저사양 20개 — 기술 탄 수를 다 합친 것보다 작으면 그만큼)을 돌려 쓰고, 글자 텍스처는 대사마다 처음에 만든다.
// 탄 개수는 기기와 상관없이 데이터 그대로다(게임 규칙). 저사양에서 줄이는 것은 불티·연기 같은 연출뿐이고 그것은 gfx가 한다.
// 시험용: __dl.mayhem.boss.bosses(), wake(key), defeat(key), cast(key, kind), nameOf(key), mapMarkers()
import * as THREE from 'three';
import { Avatar } from '../player/avatar.js';
import { textTexture } from '../world/textures.js';
import { SPAWN, PLAYER } from '../config.js';
import { BOSSES } from './boss-data.js';

const SCALE = 3.2; // 아바타를 키우는 배율
const SCALE2 = 3.45; // 2페이즈에서는 조금 더 커진다
const HEAD_Y = 1.54; // 키우기 전 아바타의 머리 중심 높이(m) — 말풍선 탄이 나오는 곳
const TAG_TOP = 2.45; // 키우기 전 이름표 윗변 높이쯤(만화 글자를 그 위에 띄운다)
const RESPAWN_SEC = 180;
const DOWN_SEC = 3.2; // 격파 뒤 쓰러져 있다가 사라지기까지
const IDLE_SLEEP = 20; // 무장한 사람이 이만큼(초) 근처에 없으면 잠든다
const REGEN = 0.02; // 잠든 동안 초당 회복(최대 체력 비율)
const NEAR_PLUS = 15; // 무장한 사람이 wake + 이만큼 안에 있으면 "근처"(싸울 상대)
const ENGAGE_IN = 5; // 과녁 목록: wake + 5m 안에 들어오면 올리고
const ENGAGE_OUT = 10; //   wake + 10m 밖으로 나가면 내린다(경계에서 넣었다 뺐다 하지 않게)
const HUD_RANGE = 60;
const KEEP = 15; // 둥지는 도착점·스탬프 원·깃발 등에서 이만큼 떨어진다
const KEEP_WALK = 5; // 돌아다닐 때도 그곳들 바로 위(이 반경 안)에는 서지 않는다
const STAY_MIN = 8; // 싸우는 상대와의 거리를 이 사이로 유지한다
const STAY_MAX = 14;
const WALK = 3.4; // 걷는 속도(m/s)
const WALK2 = 4.4; // 2페이즈
const GCD = 1.5; // 기술 사이 최소 간격(초)
const CD2 = 0.7; // 2페이즈 쿨다운 배율
const HOP = 0.5; // 충격파 전에 뛰어오르는 시간(초)
const REWARD_SHARE = 0.15; // 보상: 내가 직접 준 피해가 최대 체력의 이 비율 이상
const REWARD_GRADES = 10;
const REMOTE_DPS = 150; // 남의 피해 주장은 보스마다 1초에 이만큼까지
const MINE_SLOTS = 15; // 내가 준 피해를 0.1초 칸으로 1.5초 동안 기억한다(막타 boss 이벤트에 싣는다)
const EVENT_HP = 0.2; // 남의 격파 알림은 내 화면 체력이 이 비율 이하일 때만 받는다
const FEED_GAP_MS = 60000; // 남의 격파 알림 줄은 보스마다 60초에 한 줄
const MAX_HIT = 120; // 내 무기 한 방으로 인정하는 피해 상한
const ME_R = 0.45; // 내 몸(맞는 원기둥)
const ME_H = PLAYER.height + 0.05;
const CAR_R = 1.6; // 차에 탔을 때
const CAR_H = 1.6;
const DROP_H = 15; // 폭탄·글자 비가 떨어지기 시작하는 높이
const RAIN_R = 1.6; // 글자 하나가 떨어지는 자리의 반경
const RAIN_SPREAD = 6; // 글자 비가 흩어지는 반경
const SAY_GAP = 2.6;
const SAY_RANGE = 80;
const FX_RANGE = 110; // 이보다 멀리 있는 보스의 연출(만화 글자·연기)은 그리지 않는다
const ANIM_FAR = 90; // 이보다 멀리서 자고 있는 보스는 동작을 갱신하지 않는다(숨쉬기 정도라 멀리서는 보이지 않는다)
const ANIM_TAIL = 1.5; // 상태가 바뀐 뒤 이만큼은 멀어도 동작을 갱신한다(앉는 자세 등이 끝까지 가게)
const TAU = Math.PI * 2;
const GOLDEN = 2.399963229728653; // 황금각: 주변을 고르게 훑는 나선

// 탄 종류
const K_FREE = 0;
const K_BUBBLE = 1;
const K_BOMB = 2;
const K_RAIN = 3;
const K_ORB = 4;
const K_BULLET = 5;
const KINDS = new Set(['bubbles', 'shockwave', 'bombs', 'rain', 'orbs', 'burst']);
// 기술을 쓰는 거리: 싸우는 상대가 이보다 멀면 그 기술은 건너뛴다
const REACH = { bubbles: 34, shockwave: 20, bombs: 40, rain: 40, orbs: 26, burst: 30 };
const GLYPHS = ['{', '}', ';', '(', ')', '<', '>'];
const FONT = '"Jua", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
const MONO = '"Consolas", "Courier New", monospace';
const HEX6 = /^#[0-9a-f]{6}$/i;
const KEY_RE = /^[A-Za-z0-9_-]{1,16}$/;

const rand = (a, b) => a + Math.random() * (b - a);
const fin = (v, def) => (Number.isFinite(v) ? v : def);
const clampN = (v, a, b, def) => (Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : def);
const wrapAng = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** '#rrggbb'에 투명도를 준 'rgba(…)'(지도에 흐린 색으로 찍을 때) */
function fade(css, a) {
  if (!HEX6.test(css)) return `rgba(140,140,150,${a})`;
  const n = parseInt(css.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function canvasTex(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 만화 폭탄(검은 공 + 도화선 불꽃) */
function bombTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#2b2d42';
  g.beginPath();
  g.arc(30, 36, 23, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath();
  g.arc(22, 28, 7, 0, TAU);
  g.fill();
  g.strokeStyle = '#a1887f';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(40, 16);
  g.quadraticCurveTo(46, 5, 55, 8);
  g.stroke();
  g.fillStyle = '#ffd23f';
  g.beginPath();
  g.arc(56, 8, 6, 0, TAU);
  g.fill();
  const t = canvasTex(cv);
  t.userData = { aspect: 1 };
  return t;
}

/** 동그란 배지 글자(무한 루프 구슬의 '∞') */
function badgeTexture(text, bg) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const g = cv.getContext('2d');
  g.fillStyle = bg;
  g.beginPath();
  g.arc(48, 48, 42, 0, TAU);
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `bold 60px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 48, 52);
  const t = canvasTex(cv);
  t.userData = { aspect: 1 };
  return t;
}

/** 브라운관 화면: 어두운 바탕에 빨간 물결선과 에러 글자. 가로로 이어지게 그려 offset으로 흘려보낸다 */
function screenTexture() {
  const W = 256;
  const H = 128;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#0c121d';
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(120,255,170,0.06)'; // 주사선
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 2);
  g.strokeStyle = '#ff3b3b';
  g.lineWidth = 7;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  for (let x = 0; x <= W; x += 4) {
    const y = 84 + Math.sin((x / W) * TAU * 2) * 20;
    if (x) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
  g.fillStyle = '#ff5a5a';
  g.font = `bold 30px ${MONO}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('ERROR', W * 0.25, 28);
  g.fillText('ERROR', W * 0.75, 28);
  const t = canvasTex(cv);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// 말풍선 탄(흰 바탕) · 에러 글자(빨간 창)
const bubbleTexture = (line) => textTexture(line, { font: `bold 56px ${FONT}`, color: '#1c2533', bg: 'rgba(255,255,255,0.96)', border: 'rgba(30,40,60,0.9)', borderWidth: 6, radius: 30, pad: 22 });
const errorTexture = (line) => textTexture(line, { font: `bold 52px ${MONO}`, color: '#ffffff', bg: 'rgba(200,32,44,0.94)', border: '#ffd0d0', borderWidth: 5, radius: 12, pad: 18 });

// 보스끼리 함께 쓰는 텍스처(처음 쓸 때 한 번만 만든다)
let shared = null;
function sharedTextures() {
  if (!shared) {
    shared = {
      bomb: bombTexture(),
      zzz: textTexture('Z z z', { font: `bold 64px ${FONT}`, color: '#d8ecff', stroke: '#1b2433', strokeWidth: 12, pad: 12 }),
      glyphs: GLYPHS.map((s) => textTexture(s, { font: `bold 88px ${MONO}`, color: '#ff4d4d', stroke: '#ffffff', strokeWidth: 12, pad: 10 })),
    };
  }
  return shared;
}

// ---------- 머리 꾸미기 ----------
function partAdder(group) {
  return (geo, mat, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    group.add(m);
    return m;
  };
}
function hideHead(av) {
  for (const c of av.head.children) c.visible = false;
}

/** 확성기 머리: 앞(+z)으로 벌어진 나팔에 눈 두 개 */
function dressMegaphone(av, color, parts) {
  hideHead(av);
  const g = new THREE.Group();
  const add = partAdder(g);
  const body = new THREE.MeshLambertMaterial({ color });
  const white = new THREE.MeshLambertMaterial({ color: 0xf5f3ee });
  const dark = new THREE.MeshBasicMaterial({ color: 0x1d1d22 });
  const accent = new THREE.MeshLambertMaterial({ color: 0xffd23f });
  add(new THREE.CylinderGeometry(0.44, 0.14, 0.82, 20).rotateX(Math.PI / 2), body, 0, 0.02, 0.06); // 나팔
  add(new THREE.TorusGeometry(0.44, 0.05, 8, 26), accent, 0, 0.02, 0.47); // 나팔 테
  add(new THREE.CircleGeometry(0.4, 22), dark, 0, 0.02, 0.476, false); // 나팔 속
  add(new THREE.CylinderGeometry(0.17, 0.17, 0.14, 14).rotateX(Math.PI / 2), white, 0, 0.02, -0.38); // 뒤 마개
  add(new THREE.BoxGeometry(0.1, 0.3, 0.13), dark, 0, -0.26, -0.16); // 손잡이
  const eye = new THREE.SphereGeometry(0.085, 12, 8);
  const pupil = new THREE.SphereGeometry(0.04, 8, 6);
  for (const s of [-1, 1]) {
    add(eye, white, s * 0.13, 0.27, -0.02);
    add(pupil, dark, s * 0.13, 0.29, 0.05, false);
  }
  av.head.add(g);
  parts.accent = accent;
  parts.accentBase = 0xffd23f;
}

/** 모니터 머리: 브라운관 상자 + 흐르는 에러 화면 + 전원 불빛 */
function dressMonitor(av, parts) {
  hideHead(av);
  const g = new THREE.Group();
  const add = partAdder(g);
  const shell = new THREE.MeshLambertMaterial({ color: 0xdcd5c3 });
  const shell2 = new THREE.MeshLambertMaterial({ color: 0xc4bca8 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
  const screen = screenTexture();
  const screenMat = new THREE.MeshBasicMaterial({ map: screen, toneMapped: false });
  const led = new THREE.MeshBasicMaterial({ color: 0x3ddc84, toneMapped: false });
  add(new THREE.BoxGeometry(0.84, 0.66, 0.6), shell, 0, 0.06, -0.02); // 상자
  add(new THREE.BoxGeometry(0.58, 0.48, 0.34), shell2, 0, 0.06, -0.46); // 뒤로 볼록한 브라운관
  add(new THREE.BoxGeometry(0.72, 0.54, 0.03), dark, 0, 0.07, 0.285); // 화면 테
  add(new THREE.PlaneGeometry(0.62, 0.44), screenMat, 0, 0.07, 0.302, false); // 화면
  const ledMesh = add(new THREE.BoxGeometry(0.06, 0.04, 0.02), led, 0.3, -0.2, 0.29, false); // 전원 불빛
  add(new THREE.BoxGeometry(0.24, 0.14, 0.24), shell2, 0, -0.33, 0); // 목
  av.head.add(g);
  parts.screen = screen;
  parts.screenMat = screenMat;
  parts.led = ledMesh;
  parts.accent = led;
  parts.accentBase = 0x3ddc84;
}

// 'human'(다른 장소 버전용)은 아바타 그대로 두고 자켓 색만 쓴다. 체형·머리 모양·안경·직함 같은 사람 꾸미기는 일부러 두지 않는다
// (실존 인물을 흉내 내는 도구가 되지 않게 — 설계서 0절).
const LOOKS = new Set(['megaphone', 'monitor', 'human']);
const LOOK_FALLBACK = 'monitor'; // 모습을 모르면(오타·빠짐) 사람이 아닌 머리로

export function createBoss(ctx) {
  const { engine, world, player, ui, net, remotes, store, game, mayhem, bus, gfx, rules, sfx } = ctx;
  const low = !!(engine.quality && engine.quality.low);
  const POOL_N = low ? 20 : 40;
  const tex = sharedTextures();
  const bosses = [];
  const byKey = new Map();
  const probe = { x: 0, z: 0 };
  const hurtInfo = { by: '', kx: 0, kz: 0 }; // mayhem.hurt에 넘기는 것(고쳐 쓴다)
  const hud = { name: '', hp01: 0 };
  const markers = [];
  let hudBoss = null;
  let hudQ = -1;
  let farHintShown = false;
  // gfx에 넘기는 옵션(고쳐 쓴다 — gfx는 부르는 동안만 읽는다)
  const oRing = { color: 0, r0: 1, r1: 1, dur: 1 };
  const oSpark = { n: 6, color: 0xffffff, speed: 3, dur: 0.35, up: 0 };
  const oBoom = { radius: 4, big: false, quiet: false };
  const oComic = { color: '#ffd23f', size: 2, dur: 1 };
  const oSmoke = { n: 6, size: 4, dur: 1.4 };
  // 이번 프레임의 나
  const me = { armed: false };

  // ---------- 둥지 자리 ----------
  // 둥지와 걸음에서 피할 곳(캠퍼스): 도착점·깃발·스탬프 원·처음 들어오는 곳·깨어나는 곳. [x, z, x, z, …]
  const keep = [];
  {
    const A = (world.props && world.props.anchors) || {};
    for (const k of ['climbGoal', 'climbStart', 'climbFinish']) if (Object.hasOwn(A, k) && A[k]) keep.push(A[k].x, A[k].z);
    for (const s of (world.props && world.props.signs) || []) keep.push(s.x, s.z);
    keep.push(SPAWN.x, SPAWN.z);
    try {
      const rp = mayhem.respawnPoint();
      if (rp && rp.zone === world.campus.id) keep.push(rp.x, rp.z);
    } catch (e) {
      /* 깨어나는 곳을 못 구해도 보스는 선다 */
    }
  }
  function nearKeep(x, z, r) {
    const r2 = r * r;
    for (let i = 0; i < keep.length; i += 2) {
      const dx = x - keep[i];
      const dz = z - keep[i + 1];
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }

  /**
   * 둥지 { x, z, yaw }: lair.door(문 바깥 방향으로 out m) 또는 lair.anchor(+ offset).
   * 갈 수 있는 땅·건물 밖·벽에 걸리지 않음·피할 곳에서 15m 이상인지 실행할 때 확인하고, 안 되면 바깥쪽으로 2m씩 더 옮겨 보고,
   * 그래도 안 되면 처음 자리 주변을 나선으로 찾는다. 보스는 둥지에서 기준점(문·anchor) 쪽을 보고 앉는다.
   */
  function findLair(def, zone) {
    const lair = def.lair || {};
    const campus = zone === world.campus;
    let bx = NaN;
    let bz = NaN;
    let ux = 1;
    let uz = 0;
    let ax = NaN;
    let az = NaN;
    if (campus && typeof lair.door === 'string') {
      const d = world.doors.find((o) => o.key === lair.door);
      if (d) {
        const nl = Math.hypot(d.nx, d.nz) || 1;
        ux = d.nx / nl;
        uz = d.nz / nl;
        const out = clampN(lair.out, 0, 200, 20);
        bx = d.x + ux * out;
        bz = d.z + uz * out;
      }
    } else if (campus && typeof lair.anchor === 'string') {
      const A = (world.props && world.props.anchors) || {};
      const a = Object.hasOwn(A, lair.anchor) ? A[lair.anchor] : null;
      if (a && Number.isFinite(a.x) && Number.isFinite(a.z)) {
        const off = Array.isArray(lair.offset) ? lair.offset : [0, 0];
        const ox = fin(off[0], 0);
        const oz = fin(off[1], 0);
        const ol = Math.hypot(ox, oz);
        if (ol > 1e-6) {
          ux = ox / ol;
          uz = oz / ol;
        }
        bx = a.x + ox;
        bz = a.z + oz;
        ax = a.x;
        az = a.z;
      }
    }
    if (!Number.isFinite(bx) || !Number.isFinite(bz)) {
      // 기준점을 못 찾았다: 그 구역의 처음 자리
      const sp = zone.spawn || SPAWN;
      bx = sp.x;
      bz = sp.z;
    }
    const ok = (x, z) => {
      if (!zone.playable(x, z) || zone.collider.solidAt(x, z)) return false;
      probe.x = x;
      probe.z = z;
      if (zone.collider.resolve(probe, 1.2)) return false;
      if (campus && nearKeep(x, z, KEEP)) return false;
      if (Number.isFinite(ax) && (x - ax) * (x - ax) + (z - az) * (z - az) < KEEP * KEEP) return false;
      return true;
    };
    const yaw = Math.atan2(-ux, -uz);
    for (let k = 0; k <= 20; k++) {
      const x = bx + ux * 2 * k;
      const z = bz + uz * 2 * k;
      if (ok(x, z)) return { x, z, yaw };
    }
    for (let k = 1; k <= 600; k++) {
      const r = Math.sqrt(k);
      const x = bx + Math.cos(k * GOLDEN) * r;
      const z = bz + Math.sin(k * GOLDEN) * r;
      if (ok(x, z)) return { x, z, yaw };
    }
    return { x: bx, z: bz, yaw };
  }

  // ---------- 보스 만들기 ----------
  function normSkill(s) {
    if (!s || typeof s !== 'object' || !KINDS.has(s.kind)) return null;
    // 탄 개수는 게임 규칙이라 기기와 상관없이 데이터 그대로 쓴다(저사양에서 줄이는 것은 연출뿐 — gfx가 한다)
    const count = Math.round(clampN(s.count, 1, 40, 1));
    const slow = Array.isArray(s.slow) ? s.slow : null;
    return {
      kind: s.kind,
      name: typeof s.name === 'string' ? s.name.slice(0, 24) : '',
      cd: clampN(s.cd, 1, 120, 8),
      count,
      dmg: clampN(s.dmg, 0, 100, 10),
      radius: clampN(s.radius, 1, 12, 4),
      dur: clampN(s.dur, 0.5, 20, 5),
      windup: clampN(s.windup, 0.3, 6, 1.5),
      jam: clampN(s.jam, 0, 10, 0),
      slowSec: slow ? clampN(slow[0], 0, 10, 0) : 0,
      slowF: slow ? clampN(slow[1], 0.2, 1, 1) : 1,
      reach: Object.hasOwn(REACH, s.kind) ? REACH[s.kind] : 30,
    };
  }

  const mkWave = () => ({ on: false, shown: false, done: false, t0: 0, x: 0, z: 0, gy: 0, speed: 13, maxR: 26, dmg: 0 });

  function makeBoss(def) {
    if (!def || typeof def.key !== 'string' || !KEY_RE.test(def.key) || byKey.has(def.key)) {
      console.warn('보스 정의를 건너뜁니다(키가 없거나 겹쳐요)', def && def.key);
      return null;
    }
    const lair = def.lair || {};
    if (!Object.hasOwn(world.zones, lair.zone)) {
      console.warn(`보스 '${def.key}'의 구역을 찾지 못해 건너뜁니다`, lair.zone);
      return null;
    }
    const zone = world.zones[lair.zone];
    const key = def.key;
    const name = typeof def.name === 'string' && def.name.trim() ? def.name.trim().slice(0, 24) : key;
    const color = typeof def.color === 'string' && HEX6.test(def.color) ? def.color : '#c0392b';
    const lines = (Array.isArray(def.lines) ? def.lines : []).filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().slice(0, 40));
    if (!lines.length) lines.push('…');
    const skills = (Array.isArray(def.skills) ? def.skills : []).map(normSkill).filter(Boolean);
    const home = findLair(def, zone);
    let look = def.look;
    if (!LOOKS.has(look)) {
      console.warn(`보스 '${key}'의 모습(look) '${String(look)}'을(를) 몰라서 '${LOOK_FALLBACK}' 머리로 그립니다`);
      look = LOOK_FALLBACK;
    }
    const wake = clampN(def.wake, 5, 300, 45);
    // 내 피해를 인정하는 거리: wake와 기술 중 가장 긴 사거리 중 짧은 쪽(보스가 반격할 수 없는 곳에서는 피해가 들어가지 않는다)
    let reachMax = 0;
    for (const s of skills) reachMax = Math.max(reachMax, s.reach);
    const hitR = reachMax > 0 ? Math.min(wake, reachMax) : wake;
    // 탄 풀: 기본 크기(저사양은 절반)와 기술 탄 수를 모두 합친 것 중 큰 쪽(어느 기술도 탄이 모자라 잘리지 않게)
    let shotsN = 0;
    for (const s of skills) if (s.kind !== 'shockwave') shotsN += s.count;
    const poolN = Math.max(POOL_N, shotsN);

    // 몸: 아바타를 키워 쓴다(걷기 동작·이름표·말풍선·번쩍임·체력 막대가 따라온다)
    const profile = { n: name, col: color };
    const avatar = new Avatar(profile, 'boss:' + key);
    if (avatar.back) avatar.back.visible = false; // 등판 글씨(학교·동아리 이름)는 보스에게 붙이지 않는다
    const group = avatar.group;
    group.name = 'boss:' + key;
    group.scale.setScalar(SCALE);
    zone.group.add(group);
    const parts = { accent: null, accentBase: 0, screen: null, screenMat: null, led: null };
    if (look === 'megaphone') dressMegaphone(avatar, color, parts);
    else if (look === 'monitor') dressMonitor(avatar, parts);
    // 잠든 동안 머리 옆에 뜨는 "Z z z"
    const zzz = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.zzz, transparent: true, depthWrite: false, toneMapped: false }));
    zzz.scale.set(0.5 * ((tex.zzz.userData && tex.zzz.userData.aspect) || 2.5), 0.5, 1);
    zzz.position.set(0.6, 1.95, 0);
    group.add(zzz);

    // 탄 풀: 구역 그룹 바로 밑(월드 좌표)에 처음 한 번 만들어 둔다. map을 처음부터 넣어 두어 텍스처를 바꿔 껴도 셰이더를 다시 만들지 않는다
    const shotRoot = new THREE.Group();
    shotRoot.name = 'boss-shots:' + key;
    zone.group.add(shotRoot);
    const pool = [];
    for (let i = 0; i < poolN; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.bomb, transparent: true, depthWrite: false, toneMapped: false }));
      sp.visible = false;
      sp.renderOrder = 12;
      shotRoot.add(sp);
      pool.push({ sp, kind: K_FREE, x: 0, y: 0, z: 0, vx: 0, vz: 0, speed: 0, age: 0, life: 0, r: 0, w: 1, dmg: 0, gy: 0, t0: 0, land: 0, ang: 0, wob: 0, hitAt: 0, slowSec: 0, slowF: 1, jam: 0 });
    }
    const hasKind = (k) => skills.some((s) => s.kind === k);

    const b = {
      def,
      key,
      byId: 'boss:' + key,
      name,
      look,
      color,
      colorHex: parseInt(color.slice(1), 16),
      dim: fade(color, 0.5), // 지도: 잠든 보스
      faint: fade(color, 0.22), // 지도: 격파 뒤 재등장 대기
      zone,
      zid: lair.zone,
      maxHp: clampN(def.hp, 1, 100000, 500),
      arena: clampN(def.arena, 4, 200, 28),
      wake,
      hitR, // 내 피해를 인정하는 거리(m)
      lines,
      skills,
      home,
      x: home.x,
      z: home.z,
      gy: zone.heightAt(home.x, home.z),
      y: 0,
      yaw: home.yaw,
      wantYaw: home.yaw,
      hp: 0,
      state: 'sleep', // 'sleep' | 'fight' | 'down'(격파 연출) | 'gone'(재등장 대기)
      scale: SCALE,
      phase2: false,
      mine: 0, // 이번 생에 내가 직접 준 피해
      avatar,
      group,
      zzz,
      parts,
      pool,
      active: 0, // 살아 있는 탄 수
      bubbleT: hasKind('bubbles') ? lines.map(bubbleTexture) : null,
      rainT: hasKind('rain') ? lines.map(errorTexture) : null,
      orbT: hasKind('orbs') ? badgeTexture('∞', color) : null,
      ready: new Float64Array(skills.length), // 기술마다 다시 쓸 수 있는 시각
      next: 0, // 다음 차례 기술
      gcd: 0, // 다음 기술을 쓸 수 있는 가장 이른 시각
      lastNear: 0, // 무장한 사람이 근처에 있었던 마지막 시각
      nearAt: 0, // 다음에 근처를 살필 시각
      focusMe: false, // 싸우는 상대: 나
      focusR: null, //   또는 원격 접속자 기록
      hasFocus: false,
      fx: 0, // 싸우는 상대의 자리
      fz: 0,
      strafe: 1,
      strafeAt: 0,
      moved: 0, // 이번 프레임에 걸은 거리(걷기 동작용)
      hopT: 0, // 충격파 전 뛰어오르기 남은 시간
      hopSkill: null,
      castT: 0, // 사방 탄 준비 동작 남은 시간
      castSkill: null,
      waves: [mkWave(), mkWave()],
      bk: new Float64Array(10), // 남의 피해: 0.1초 칸 10개(최근 1초)
      bkSlot: 0,
      mk: new Float64Array(MINE_SLOTS), // 내가 준 피해: 0.1초 칸 15개(최근 1.5초) — 막타 boss 이벤트에 싣는다
      mkSlot: 0,
      feedAt: -Infinity,
      sayAt: -Infinity,
      hurtSayAt: -Infinity,
      farAt: -Infinity,
      respawnAt: 0,
      downT: 0,
      booms: 0,
      nBooms: 0,
      boomAt: 0,
      hpShown: -2,
      animLeft: 0, // 멀어도 동작을 갱신할 남은 시간(초). 실제로 그린 시간만큼만 줄어든다(다른 구역에 있던 동안은 그대로)
      registered: false, // mayhem.targets에 올라 있는가
      hinted: false,
      casts: 0, // 쓴 기술 수(시험용)
      target: null,
      marker: { x: 0, z: 0, color: '', r: 8 },
    };
    b.hp = b.maxHp;
    b.target = { id: b.byId, name, zone: b.zid, x: home.x, y: b.gy, z: home.z, radius: 2.2, height: 6, alive: true, hurt: (d) => hurtBoss(b, d) };
    group.position.set(b.x, b.gy, b.z);
    group.rotation.y = b.yaw;
    avatar.playEmote(5); // 앉아서 존다
    b.animLeft = ANIM_TAIL; // 처음 앉는 자세까지는 멀어도 그린다
    return b;
  }

  // ---------- 작은 도우미 ----------
  const d2me = (b) => {
    const dx = player.pos.x - b.x;
    const dz = player.pos.z - b.z;
    return dx * dx + dz * dz;
  };
  /** 이 보스가 내 화면에서 보이는가(같은 구역이고 range m 안) */
  const seen = (b, range) => player.zone === b.zid && d2me(b) <= range * range;
  const line = (b) => b.lines[Math.floor(Math.random() * b.lines.length)];
  function say(b, t, text) {
    if (t - b.sayAt < SAY_GAP || !seen(b, SAY_RANGE)) return;
    b.sayAt = t;
    b.avatar.say(text);
  }
  /** 보스 자리에서 난 소리(멀수록 작게). k는 거리에 곱하는 값(작을수록 크게 들린다) */
  function sound(b, name, k = 1, opt) {
    if (player.zone !== b.zid) return;
    sfx.at(name, Math.sqrt(d2me(b)) * k, opt);
  }
  function ring(x, y, z, color, r0, r1, dur) {
    oRing.color = color;
    oRing.r0 = r0;
    oRing.r1 = r1;
    oRing.dur = dur;
    gfx.ring(x, y, z, oRing);
  }
  function comic(b, text, size, color, dur) {
    if (!seen(b, FX_RANGE)) return;
    oComic.size = size;
    oComic.color = color;
    oComic.dur = dur;
    gfx.comic(text, b.x, b.gy + TAG_TOP * b.scale + size * 0.4, b.z, oComic);
  }
  function smoke(b, n, size, dur) {
    if (!seen(b, FX_RANGE)) return;
    oSmoke.n = n;
    oSmoke.size = size;
    oSmoke.dur = dur;
    gfx.smoke(b.x, b.gy, b.z, oSmoke);
  }
  function shakeNear(b, power, range) {
    if (player.zone !== b.zid) return;
    const d = Math.sqrt(d2me(b));
    if (d < range) gfx.shake(power * (1 - d / range));
  }

  // 지금 내가 맞을 수 있는가: 무장·기절 아님·무적 아님·같은 구역. 맞을 때마다 바뀌므로 그때그때 본다
  function canHitMe(b) {
    const st = mayhem.state;
    return st.wpn > 0 && !st.ko && engine.time >= st.invulnUntil && player.zone === b.zid;
  }
  /** 반지름 r인 탄이 (x, y, z)에서 내 몸(원기둥)에 닿는가 */
  function hitsMe(b, x, y, z, r) {
    if (!canHitMe(b)) return false;
    const p = player.pos;
    const car = !!player.mount;
    const R = (car ? CAR_R : ME_R) + r;
    const dx = p.x - x;
    const dz = p.z - z;
    if (dx * dx + dz * dz > R * R) return false;
    return y >= p.y - r && y <= p.y + (car ? CAR_H : ME_H) + r;
  }
  /** 나에게 피해 d. (fromX, fromZ)에서 나를 향해 knock m/s로 밀린다. 실제로 받은 피해를 돌려준다 */
  function hurtMe(b, d, fromX, fromZ, knock) {
    const p = player.pos;
    let dx = p.x - fromX;
    let dz = p.z - fromZ;
    const l = Math.hypot(dx, dz);
    if (l > 1e-6) {
      dx /= l;
      dz /= l;
    } else {
      dx = 1;
      dz = 0;
    }
    hurtInfo.by = b.byId;
    hurtInfo.kx = dx * knock;
    hurtInfo.kz = dz * knock;
    return mayhem.hurt(d, hurtInfo);
  }

  // ---------- 탄 풀 ----------
  function takeShot(b) {
    const pool = b.pool;
    for (let i = 0; i < pool.length; i++) {
      const sh = pool[i];
      if (sh.kind !== K_FREE) continue;
      b.active++;
      sh.age = 0;
      sh.sp.visible = true;
      sh.sp.material.opacity = 1;
      return sh;
    }
    return null;
  }
  function freeShot(b, sh) {
    if (sh.kind === K_FREE) return;
    sh.kind = K_FREE;
    sh.sp.visible = false;
    b.active--;
  }
  /** 터지며 사라진다(가까우면 불티) */
  function popShot(b, sh, color) {
    if (seen(b, 90)) {
      oSpark.n = 6;
      oSpark.color = color;
      oSpark.speed = 3;
      oSpark.dur = 0.35;
      oSpark.up = 0;
      gfx.sparks(sh.x, sh.y, sh.z, oSpark);
    }
    freeShot(b, sh);
  }
  function clearShots(b) {
    for (let i = 0; i < b.pool.length; i++) freeShot(b, b.pool[i]);
  }
  /** 글자 텍스처를 끼우고 높이 h(m)로 맞춘다(너비가 maxW를 넘으면 줄인다) */
  function textShot(sh, texture, h, maxW) {
    const asp = (texture.userData && texture.userData.aspect) || 1;
    let w = h * asp;
    let hh = h;
    if (w > maxW) {
      hh = (h * maxW) / w;
      w = maxW;
    }
    sh.w = w;
    sh.sp.material.map = texture;
    sh.sp.scale.set(w, hh, 1);
  }

  // ---------- 상태 바꾸기 ----------
  function wakeUp(b, t, byMe) {
    if (b.state !== 'sleep') return;
    b.state = 'fight';
    b.lastNear = t;
    b.nearAt = 0;
    b.gcd = t + 1.2;
    for (let i = 0; i < b.ready.length; i++) b.ready[i] = t + 1.2 + i * 0.9;
    b.next = 0;
    b.avatar.playEmote(0); // 일어선다
    if (byMe) sfx.bossRoar();
    else sound(b, 'bossRoar', 0.6);
    say(b, t, line(b));
    comic(b, '!!', 2.4, '#ff5a5a', 0.9);
    if (byMe && !b.hinted) {
      b.hinted = true;
      ui.toast(`👹 ${b.name}이(가) 깨어났어요! 무기를 넣으면(평화) 공격받지 않아요`, 4200);
    }
  }

  function clearCombat(b) {
    b.castT = 0;
    b.castSkill = null;
    b.hopT = 0;
    b.hopSkill = null;
    b.focusMe = false;
    b.focusR = null;
    b.hasFocus = false;
    for (let i = 0; i < b.waves.length; i++) b.waves[i].on = false;
    if (b.parts.screenMat) b.parts.screenMat.color.setRGB(1, 1, 1);
    clearShots(b);
  }

  function goSleep(b) {
    b.state = 'sleep';
    clearCombat(b);
    const dx = b.x - b.home.x;
    const dz = b.z - b.home.z;
    if (dx * dx + dz * dz > 4) {
      // 둥지까지 못 돌아왔으면 펑 하고 둥지로
      smoke(b, 6, 4, 1.4);
      b.x = b.home.x;
      b.z = b.home.z;
      b.gy = b.zone.heightAt(b.x, b.z);
      b.group.position.set(b.x, b.gy, b.z); // 내가 다른 구역에 있어 그리지 않는 동안에도 자리는 맞아 있게
      smoke(b, 6, 4, 1.4);
    }
    b.wantYaw = b.home.yaw;
    b.avatar.playEmote(5);
    b.animLeft = ANIM_TAIL; // 앉는 자세·Z z z는 다음에 이 구역이 보일 때 멀어도 끝까지 그린다
  }

  function setPhase2(b, on, t) {
    if (b.phase2 === on) return;
    b.phase2 = on;
    b.scale = on ? SCALE2 : SCALE;
    b.group.scale.setScalar(b.scale);
    if (b.parts.accent) b.parts.accent.color.setHex(on ? 0xff3b3b : b.parts.accentBase);
    if (b.parts.led) b.parts.led.visible = true;
    if (!on) return;
    comic(b, '2페이즈!', 3, '#ff5a5a', 1.6);
    sound(b, 'bossRoar', 0.5);
    say(b, t, line(b));
  }

  function respawn(b, t) {
    b.state = 'sleep';
    b.hp = b.maxHp;
    b.mine = 0;
    setPhase2(b, false, t);
    b.x = b.home.x;
    b.z = b.home.z;
    b.gy = b.zone.heightAt(b.x, b.z);
    b.yaw = b.wantYaw = b.home.yaw;
    b.group.rotation.y = b.yaw;
    b.group.position.set(b.x, b.gy, b.z);
    b.bk.fill(0);
    b.mk.fill(0);
    b.avatar.setKO(false);
    b.avatar.playEmote(5);
    b.group.visible = true;
    b.animLeft = ANIM_TAIL; // 쓰러진 자세에서 일어나 앉는 것까지는 멀어도 그린다(다른 구역에 있었으면 돌아온 뒤에)
    smoke(b, 8, 4.5, 1.8);
  }

  function record(b) {
    const d = store.data;
    let w = d.bossWins;
    if (!w || typeof w !== 'object' || Array.isArray(w)) w = d.bossWins = {};
    const n = Object.hasOwn(w, b.key) && Number.isFinite(w[b.key]) ? w[b.key] : 0;
    w[b.key] = n + 1;
  }

  /**
   * 격파: 연쇄 폭발·'격파!'·배너·불꽃놀이(캠퍼스)·보상(내 몫 15% 이상), 180초 뒤 재등장.
   * byMe는 내가 막타를 쳤는가(그때만 boss 이벤트를 보낸다), byId·byName은 막타를 쳤다고 알려 온 사람.
   */
  function defeat(b, t, byMe, byId, byName) {
    if (b.state !== 'sleep' && b.state !== 'fight') return false;
    const share = b.mine / b.maxHp;
    const fought = b.mine > 0;
    // 막타 직전 1.5초 동안 내가 준 피해: 아직 다른 사람에게 닿지 않았을 fx 묶음 몫이다(boss 이벤트에 실어 보낸다)
    const lastD = byMe ? Math.round(windowSum(b.mk, b, 'mkSlot', MINE_SLOTS, performance.now()) * 10) / 10 : 0;
    b.state = 'down';
    b.hp = 0;
    b.mine = 0;
    b.target.alive = false; // 같은 프레임에 날아든 탄도 더는 맞히지 못하게 바로 내린다
    clearCombat(b);
    b.downT = 0;
    b.booms = 0;
    b.boomAt = 0.05;
    b.nBooms = 3 + Math.floor(Math.random() * 3); // 3~5번
    b.respawnAt = t + RESPAWN_SEC;
    b.avatar.clearBubble();
    b.avatar.setKO(true);
    const near = seen(b, 100);
    comic(b, '격파!', 4, '#ffd23f', 2.2);
    if (near || byMe || fought) {
      ui.banner('격파!', `${b.name}을(를) 물리쳤어요`, true, 3600);
      sfx.bossDown();
    }
    if (b.zone === world.campus && player.zone === b.zid && game && game.fx && typeof game.fx.firework === 'function') game.fx.firework(b.x, b.gy, b.z);
    if (share >= REWARD_SHARE) {
      record(b);
      if (game && typeof game.addGrades === 'function') game.addGrades(REWARD_GRADES);
      else store.save();
      ui.chat.system(`🏆 ${b.name}을(를) 물리쳤어요! 보상으로 A+ ${REWARD_GRADES}개를 받았어요`);
      ui.toast(`🅰 보스 보상 A+ ${REWARD_GRADES}개!`);
    } else if (fought) {
      ui.chat.system(`🏆 ${b.name}을(를) 물리쳤어요!`);
      ui.toast(`보상(A+)은 체력의 ${Math.round(REWARD_SHARE * 100)}% 넘게 때린 사람만 받아요 (내 몫 ${Math.floor(share * 100)}%)`, 4200);
    }
    // 받는 쪽은 d를 남의 피해 주장과 같은 검사·상한으로 먼저 반영한 뒤 20%를 본다(이 이벤트가 마지막 fx 묶음을 앞질러 가도 거부되지 않게)
    if (byMe) net.sendEvent('boss', lastD >= 1 ? { b: b.key, d: lastD } : { b: b.key });
    else if (byId) {
      // 남이 알려 온 격파: 채팅창 알림은 보스마다 60초에 한 줄
      const now = performance.now();
      if (now - b.feedAt >= FEED_GAP_MS) {
        b.feedAt = now;
        ui.feed(`🏆 ${byName || '누군가'} 님이 ${b.name}을(를) 물리쳤어요!`, byId);
      }
    }
    return true;
  }

  // ---------- 맞기 ----------
  /** 내 무기·차가 보스를 맞혔다: mayhem.targets의 hurt(d, w, x, z). 실제로 준 피해를 돌려준다 */
  function hurtBoss(b, d) {
    if (!(d > 0) || !Number.isFinite(d)) return 0;
    if (b.state !== 'sleep' && b.state !== 'fight') return 0;
    const st = mayhem.state;
    if (st.wpn === 0 || st.ko || player.zone !== b.zid) return 0;
    const t = engine.time;
    if (d2me(b) > b.hitR * b.hitR) {
      // 너무 멀다: 피해 없음. hitR은 wake와 보스 기술의 가장 긴 사거리 중 짧은 쪽이라, 보스가 반격할 수 없는 곳에서는 잡을 수 없다.
      // 왜 안 들어가는지는 알려 준다
      if (t - b.farAt > 1.2) {
        b.farAt = t;
        comic(b, '멀어서 무효!', 1.5, '#d0d8e4', 0.9);
        if (!farHintShown) {
          farHintShown = true;
          ui.toast(`보스는 ${Math.floor(b.hitR)}m 안에서 때려야 피해가 들어가요`);
        }
      }
      return 0;
    }
    if (b.state === 'sleep') wakeUp(b, t, true);
    b.lastNear = t;
    const took = Math.min(d, MAX_HIT, b.hp);
    if (!(took > 0)) return 0;
    b.hp -= took;
    b.mine += took;
    windowSum(b.mk, b, 'mkSlot', MINE_SLOTS, performance.now());
    b.mk[b.mkSlot % MINE_SLOTS] += took;
    mayhem.claimBoss(b.key, took);
    b.avatar.flash();
    if (t - b.hurtSayAt > 5 && Math.random() < 0.12) {
      b.hurtSayAt = t;
      say(b, t, line(b));
    }
    if (b.hp <= 1e-6) defeat(b, t, true, '', '');
    return took;
  }

  /** 0.1초 칸 n개로 된 창 arr(마지막 칸 번호는 b[key])을 now(ms)까지 밀고(지난 칸은 비운다) 합을 돌려준다 */
  function windowSum(arr, b, key, n, now) {
    const slot = Math.floor(now / 100);
    const gap = slot - b[key];
    if (gap > 0) {
      const k = Math.min(gap, n);
      for (let i = 1; i <= k; i++) arr[(b[key] + i) % n] = 0;
      b[key] = slot;
    }
    let sum = 0;
    for (let i = 0; i < n; i++) sum += arr[i];
    return sum;
  }
  // 남의 피해: 0.1초 칸 10개로 최근 1초 동안 받아들인 양을 센다
  const remoteUsed = (b, now) => windowSum(b.bk, b, 'bkSlot', 10, now);

  /**
   * 남이 보스에게 줬다는 피해 d(fx 묶음의 b, 또는 막타 boss 이벤트의 d)를 검사해 반영한다. 받아들인 양을 돌려준다.
   * 누구나 꾸며 보낼 수 있으므로: 보낸 사람의 마지막 상태가 보스 구역·무장·기절 아님·오래되지 않음이고,
   * 둥지에서 (아레나 반경 + 그 무기가 닿는 거리) 안일 때만. 보스 자리는 화면마다 다르므로(동기화하지 않는다)
   * 내 화면의 보스가 아니라 둥지를 기준으로 잰다. 양은 보스마다 1초에 150까지, 원격 피해만으로는 체력을 1 아래로 내리지 않는다.
   */
  function takeRemote(b, id, d) {
    if (!b || (b.state !== 'sleep' && b.state !== 'fight')) return 0;
    if (!(d > 0) || !Number.isFinite(d)) return 0;
    const r = remotes.get(id);
    if (!r || r.fresh || r.ko || r.zone !== b.zid || !(r.wpn > 0)) return 0;
    const now = performance.now();
    if (!(now - r.stateAt <= rules.LIMITS.staleMs)) return 0;
    const car = r.car >= 0;
    let reach = rules.reach(r.wpn, car);
    if (r.prevWpn > 0 && now - r.wpnChangedAt <= rules.LIMITS.lockSec * 1000) reach = Math.max(reach, rules.reach(r.prevWpn, car));
    if (car) reach = Math.max(reach, rules.reach('car', true));
    // 제대로 된 사람은 자기 화면의 보스에게 hitR 안에서만 피해를 준다 → 멀리 닿는 무기도 hitR + 여유까지만 인정
    const lim = b.arena + Math.min(reach, b.hitR + 8);
    const dx = r.raw.x - b.home.x;
    const dz = r.raw.z - b.home.z;
    if (!(dx * dx + dz * dz <= lim * lim)) return 0;
    const take = Math.min(d, REMOTE_DPS - remoteUsed(b, now), b.hp - 1);
    if (!(take > 0)) return 0;
    b.bk[b.bkSlot % 10] += take;
    b.hp -= take;
    const t = engine.time;
    b.lastNear = t;
    if (b.state === 'sleep') wakeUp(b, t, false);
    if (player.zone === b.zid) b.avatar.flash();
    return take;
  }

  // 남이 보스에게 줬다는 피해(fx 묶음의 b — index.js가 형식만 걸러 넘긴다)
  bus.on('bossClaim', (e) => {
    if (!e || typeof e.key !== 'string' || typeof e.id !== 'string') return;
    takeRemote(byKey.get(e.key), e.id, e.d);
  });

  // 남이 막타를 쳤다는 알림: 내 화면에서도 거의 다 잡았을 때(체력 20% 이하)만 받아들인다.
  // 함께 실려 온 d(막타 직전 1.5초 동안 그 사람이 준 피해 — 이 이벤트가 앞질러 온 fx 묶음 몫)는 남의 피해 주장과 같은 검사·상한으로 먼저 반영한다.
  // 나중에 그 fx 묶음이 와도 이미 격파됐으면 무시되고, 거부됐으면 한 번 더 깎일 뿐이다(원격 피해만으로는 1 아래로 못 내린다).
  net.on('event', (id, msg, peer) => {
    if (!msg || msg.k !== 'boss' || typeof msg.b !== 'string') return;
    const b = byKey.get(msg.b);
    if (!b || (b.state !== 'sleep' && b.state !== 'fight')) return;
    const r = remotes.get(id);
    if (!r || r.fresh || r.zone !== b.zid) return;
    if (Number.isFinite(msg.d) && msg.d > 0) takeRemote(b, id, Math.min(msg.d, 10000));
    if (b.hp > b.maxHp * EVENT_HP) return;
    defeat(b, engine.time, false, id, peer && peer.profile ? peer.profile.n : '');
  });

  // ---------- 전투 ----------
  // 원격 접속자 훑기: 반복자를 만들지 않게 forEach에 미리 만든 함수를 넘기고, 결과는 아래 변수에 모은다
  let scanB = null;
  let scanLim2 = 0;
  let scanBest = null;
  let scanBd = 0;
  let scanAny = false;
  const scanRemote = (r) => {
    if (r.fresh || r.ko || !(r.wpn > 0) || r.zone !== scanB.zid) return;
    const dx = r.x - scanB.x;
    const dz = r.z - scanB.z;
    const dd = dx * dx + dz * dz;
    if (dd > scanLim2) return;
    scanAny = true;
    if (dd < scanBd) {
      scanBd = dd;
      scanBest = r;
    }
  };
  /** 싸울 상대 고르기(0.25초마다): 무장한 내가 근처면 나, 아니면 가장 가까운 무장한 원격 접속자. 누가 있었으면 lastNear 갱신 */
  function chooseFocus(b, t) {
    const lim = b.wake + NEAR_PLUS;
    scanB = b;
    scanLim2 = lim * lim;
    scanBest = null;
    scanBd = scanLim2;
    scanAny = false;
    b.focusMe = me.armed && player.zone === b.zid && d2me(b) <= scanLim2;
    // armedPeers()는 내 구역만 보고 GAME.pvp가 꺼지면 비므로, 보스 구역의 무장한 사람은 remotes에서 직접 찾는다
    remotes.map.forEach(scanRemote);
    b.focusR = b.focusMe ? null : scanBest;
    if (b.focusMe || scanAny) b.lastNear = t;
    scanB = scanBest = null;
  }

  function blocked(b, x, z) {
    const zone = b.zone;
    if (!zone.playable(x, z) || zone.collider.solidAt(x, z)) return true;
    return zone === world.campus && nearKeep(x, z, KEEP_WALK);
  }
  function inArena(b, x, z) {
    const dx = x - b.home.x;
    const dz = z - b.home.z;
    return dx * dx + dz * dz <= b.arena * b.arena + 1e-6;
  }
  /** (sx, sz)만큼 걷는다: 아레나 밖·건물 안·갈 수 없는 땅으로는 가지 않고, 막히면 한 축씩 미끄러진다 */
  function step(b, sx, sz) {
    let nx = b.x + sx;
    let nz = b.z + sz;
    const hx = nx - b.home.x;
    const hz = nz - b.home.z;
    const hd = Math.hypot(hx, hz);
    if (hd > b.arena) {
      nx = b.home.x + (hx / hd) * b.arena;
      nz = b.home.z + (hz / hd) * b.arena;
    }
    if (blocked(b, nx, nz)) {
      if (!blocked(b, nx, b.z) && inArena(b, nx, b.z)) nz = b.z;
      else if (!blocked(b, b.x, nz) && inArena(b, b.x, nz)) nx = b.x;
      else return;
    }
    b.moved += Math.hypot(nx - b.x, nz - b.z);
    b.x = nx;
    b.z = nz;
    b.gy = b.zone.heightAt(nx, nz);
  }
  /** 상대와 8~14m를 유지하며 옆걸음, 상대가 없으면 둥지로 */
  function move(b, dt, t, has) {
    let vx = 0;
    let vz = 0;
    if (has) {
      const dx = b.fx - b.x;
      const dz = b.fz - b.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-3) {
        const ux = dx / d;
        const uz = dz / d;
        const v = b.phase2 ? WALK2 : WALK;
        if (d > STAY_MAX) {
          vx = ux * v;
          vz = uz * v;
        } else if (d < STAY_MIN) {
          vx = -ux * v * 0.85;
          vz = -uz * v * 0.85;
        } else {
          if (t >= b.strafeAt) {
            b.strafe = Math.random() < 0.5 ? -1 : 1;
            b.strafeAt = t + rand(2.2, 4.5);
          }
          vx = -uz * b.strafe * v * 0.45;
          vz = ux * b.strafe * v * 0.45;
        }
      }
    } else {
      const dx = b.home.x - b.x;
      const dz = b.home.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.2) {
        vx = (dx / d) * WALK * 0.8;
        vz = (dz / d) * WALK * 0.8;
        b.wantYaw = Math.atan2(dx, dz);
      } else b.wantYaw = b.home.yaw;
    }
    if (vx || vz) step(b, vx * dt, vz * dt);
  }

  function trySkill(b, t) {
    const n = b.skills.length;
    if (!n) return;
    const d = Math.hypot(b.fx - b.x, b.fz - b.z);
    for (let k = 0; k < n; k++) {
      const i = (b.next + k) % n;
      const s = b.skills[i];
      if (t < b.ready[i] || d > s.reach) continue;
      b.ready[i] = t + s.cd * (b.phase2 ? CD2 : 1);
      b.gcd = t + GCD * (b.phase2 ? CD2 : 1);
      b.next = (i + 1) % n;
      cast(b, s, t);
      return;
    }
  }
  function cast(b, s, t) {
    b.casts++;
    if (s.kind === 'bubbles') castBubbles(b, s, t);
    else if (s.kind === 'shockwave') {
      b.hopT = HOP; // 뛰었다 내려앉을 때 고리가 퍼진다
      b.hopSkill = s;
      say(b, t, line(b));
    } else if (s.kind === 'bombs') castDrops(b, s, t, K_BOMB);
    else if (s.kind === 'rain') castDrops(b, s, t, K_RAIN);
    else if (s.kind === 'orbs') castOrbs(b, s, t);
    else if (s.kind === 'burst') startBurst(b, s, t);
  }

  /** 말풍선 탄: 상대 쪽으로 부채꼴로 내뱉고, 날아가며 천천히 쫓아간다 */
  function castBubbles(b, s, t) {
    const base = Math.atan2(b.fx - b.x, b.fz - b.z);
    const n = s.count;
    const k = b.scale / SCALE;
    for (let i = 0; i < n; i++) {
      const sh = takeShot(b);
      if (!sh) break;
      const a = base + (n > 1 ? (i / (n - 1) - 0.5) * 1.2 : 0);
      sh.kind = K_BUBBLE;
      sh.x = b.x + Math.sin(base) * 2.2 * k;
      sh.z = b.z + Math.cos(base) * 2.2 * k;
      sh.y = b.gy + HEAD_Y * b.scale;
      sh.vx = Math.sin(a);
      sh.vz = Math.cos(a);
      sh.speed = (b.phase2 ? 9 : 7.5) * rand(0.9, 1.1);
      sh.life = 6.5;
      sh.dmg = s.dmg;
      sh.slowSec = s.slowSec;
      sh.slowF = s.slowF;
      const list = b.bubbleT || b.rainT;
      textShot(sh, list ? list[Math.floor(Math.random() * list.length)] : tex.bomb, 1.0, 4.2);
      sh.r = Math.min(1.4, 0.55 + sh.w * 0.15);
      sh.sp.material.opacity = 0;
      sh.sp.position.set(sh.x, sh.y, sh.z);
    }
    b.avatar.attack(1);
    sound(b, 'wrong', 0.7);
    say(b, t, line(b));
  }

  /** 폭탄(예고 원 하나씩, 1.4초 뒤 폭발) · 글자 비(넓은 예고 원 하나 안으로 글자가 떨어진다) */
  function castDrops(b, s, t, kind) {
    const zone = b.zone;
    const rain = kind === K_RAIN;
    const n = s.count;
    if (rain) {
      const gy = zone.heightAt(b.fx, b.fz);
      ring(b.fx, gy, b.fz, 0xff4040, RAIN_SPREAD + RAIN_R, RAIN_SPREAD + RAIN_R, 1.15 + n * 0.09 + 0.25);
    }
    for (let i = 0; i < n; i++) {
      let x = b.fx;
      let z = b.fz;
      let ok = zone.playable(x, z) && !zone.collider.solidAt(x, z);
      if (i > 0) {
        // 첫 발은 상대 자리, 나머지는 그 둘레(건물 안·갈 수 없는 땅은 피한다)
        ok = false;
        for (let k = 0; k < 6 && !ok; k++) {
          const a = rand(0, TAU);
          const r = rain ? Math.sqrt(Math.random()) * RAIN_SPREAD : rand(3, 7);
          x = b.fx + Math.cos(a) * r;
          z = b.fz + Math.sin(a) * r;
          ok = zone.playable(x, z) && !zone.collider.solidAt(x, z);
        }
      }
      if (!ok) continue;
      const sh = takeShot(b);
      if (!sh) break;
      sh.kind = kind;
      sh.x = x;
      sh.z = z;
      sh.gy = zone.heightAt(x, z);
      sh.t0 = t;
      sh.land = t + (rain ? 1.15 + i * 0.09 : 1.4);
      sh.y = sh.gy + DROP_H;
      sh.dmg = s.dmg;
      if (rain) {
        sh.r = RAIN_R;
        const list = b.rainT || b.bubbleT;
        textShot(sh, list ? list[Math.floor(Math.random() * list.length)] : tex.bomb, 0.85, 4.5);
      } else {
        sh.r = s.radius;
        textShot(sh, tex.bomb, 1.3, 1.3);
        ring(x, sh.gy, z, 0xff4040, s.radius, s.radius, sh.land - t);
      }
      sh.sp.position.set(sh.x, sh.y, sh.z);
    }
    b.avatar.attack(1);
    if (rain) sound(b, 'jam', 0.8);
    say(b, t, line(b));
  }
  function landDrop(b, sh) {
    const x = sh.x;
    const z = sh.z;
    const gy = sh.gy;
    if (player.zone === b.zid) {
      if (sh.kind === K_BOMB) {
        oBoom.radius = Math.min(6, sh.r);
        oBoom.big = false;
        oBoom.quiet = false;
        gfx.explosion(x, gy + 0.4, z, oBoom);
      } else if (seen(b, 90)) {
        oSpark.n = 10;
        oSpark.color = 0xff4d4d;
        oSpark.speed = 4.5;
        oSpark.dur = 0.45;
        oSpark.up = 2;
        gfx.sparks(x, gy + 0.4, z, oSpark);
      }
    }
    if (canHitMe(b)) {
      const p = player.pos;
      const dx = p.x - x;
      const dz = p.z - z;
      const R = sh.r + (player.mount ? CAR_R : ME_R);
      if (dx * dx + dz * dz <= R * R && p.y <= gy + sh.r + 1 && p.y >= gy - 3) hurtMe(b, sh.dmg, x, z, sh.kind === K_BOMB ? 8 : 3);
    }
    freeShot(b, sh);
  }

  /** 무한 루프 구슬: 보스 둘레를 돌며 반지름이 늘었다 줄었다 한다 */
  function castOrbs(b, s, t) {
    const n = s.count;
    const wob = rand(0, TAU);
    for (let i = 0; i < n; i++) {
      const sh = takeShot(b);
      if (!sh) break;
      sh.kind = K_ORB;
      sh.life = s.dur;
      sh.ang = (i / n) * TAU;
      sh.wob = wob;
      sh.dmg = s.dmg;
      sh.r = 0.75;
      sh.hitAt = 0;
      textShot(sh, b.orbT || tex.bomb, 1.5, 1.5);
      orbPos(b, sh);
      sh.sp.position.set(sh.x, sh.y, sh.z);
    }
    sound(b, 'beep', 0.8);
    say(b, t, line(b));
  }
  function orbPos(b, sh) {
    const a = sh.ang + sh.age * (b.phase2 ? 2.1 : 1.5);
    const rad = 7 + 4 * Math.sin(sh.age * (b.phase2 ? 1.6 : 1.2) + sh.wob);
    sh.x = b.x + Math.sin(a) * rad;
    sh.z = b.z + Math.cos(a) * rad;
    sh.y = b.zone.heightAt(sh.x, sh.z) + 1.3 + Math.sin(sh.age * 4 + sh.ang) * 0.25;
  }

  /** 사방 탄: 기술 이름을 크게 외치며 windup초 동안 준비(두 팔을 들고 바닥 경고 원)한 뒤 쏜다 */
  function startBurst(b, s, t) {
    b.castSkill = s;
    b.castT = s.windup;
    b.avatar.playEmote(2); // 두 팔 번쩍
    comic(b, s.name || '!!!', 3.4, '#ff4d4d', Math.min(6, s.windup + 0.4));
    if (player.zone === b.zid) ring(b.x, b.gy, b.z, 0xff3030, 2.4, 8, s.windup);
    sound(b, 'bossRoar', 0.7);
    if (b.parts.screenMat) b.parts.screenMat.color.setRGB(1, 0.45, 0.45);
    say(b, t, line(b));
  }
  function fireBurst(b) {
    const s = b.castSkill;
    b.castT = 0;
    b.castSkill = null;
    b.avatar.playEmote(0);
    if (b.parts.screenMat) b.parts.screenMat.color.setRGB(1, 1, 1);
    if (!s) return;
    const n = s.count;
    const a0 = rand(0, TAU / n);
    const k = b.scale / SCALE;
    for (let i = 0; i < n; i++) {
      const sh = takeShot(b);
      if (!sh) break;
      const a = a0 + (i / n) * TAU;
      sh.kind = K_BULLET;
      sh.vx = Math.sin(a);
      sh.vz = Math.cos(a);
      sh.speed = b.phase2 ? 15 : 13;
      sh.x = b.x + sh.vx * 2.4 * k;
      sh.z = b.z + sh.vz * 2.4 * k;
      sh.y = b.zone.heightAt(sh.x, sh.z) + 1.1;
      sh.life = 38 / sh.speed;
      sh.dmg = s.dmg;
      sh.jam = s.jam;
      sh.r = 0.55;
      textShot(sh, tex.glyphs[Math.floor(Math.random() * tex.glyphs.length)], 1.1, 1.4);
      sh.sp.position.set(sh.x, sh.y, sh.z);
    }
    b.avatar.attack(1);
    sound(b, 'launch', 0.6);
    shakeNear(b, 0.35, 30);
  }

  /** 충격파: 내려앉은 자리에서 고리가 퍼진다(2페이즈는 두 겹) */
  function startWaves(b, t) {
    const s = b.hopSkill;
    b.hopSkill = null;
    if (!s) return;
    const n = b.phase2 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const w = b.waves[i];
      w.on = true;
      w.shown = false;
      w.done = false;
      w.t0 = t + i * 0.75;
      w.x = b.x;
      w.z = b.z;
      w.gy = b.gy;
      w.speed = b.phase2 ? 15 : 13;
      w.maxR = 26;
      w.dmg = s.dmg;
    }
    shakeNear(b, 0.5, 40);
    smoke(b, 5, 3.5, 1.2);
    sound(b, 'crash', 0.5);
  }
  function stepWaves(b, t) {
    for (let i = 0; i < b.waves.length; i++) {
      const w = b.waves[i];
      if (!w.on || t < w.t0) continue;
      if (!w.shown) {
        w.shown = true;
        if (player.zone === b.zid) ring(w.x, w.gy, w.z, b.colorHex, 1, w.maxR, (w.maxR - 1) / w.speed);
      }
      // gfx.ring과 같은 식(r0 → r1로 고르게)이라 보이는 고리와 맞는 순간이 같다
      const r = Math.min(w.maxR, 1 + (t - w.t0) * w.speed);
      if (!w.done && player.zone === b.zid) {
        const p = player.pos;
        const d = Math.hypot(p.x - w.x, p.z - w.z) - (player.mount ? CAR_R : ME_R);
        if (d <= r) {
          // 고리 앞머리가 내 몸에 닿은 순간 한 번만 본다: 땅에 서 있으면 맞고, 공중이면(점프) 피한다
          w.done = true;
          if (d <= w.maxR && Math.abs(p.y - w.gy) < 6 && player.onGround && canHitMe(b)) hurtMe(b, w.dmg, w.x, w.z, 9);
        }
      }
      if (r >= w.maxR) w.on = false;
    }
  }

  function stepShots(b, dt, t) {
    const zone = b.zone;
    const pool = b.pool;
    for (let i = 0; i < pool.length; i++) {
      const sh = pool[i];
      const kind = sh.kind;
      if (kind === K_FREE) continue;
      sh.age += dt;
      if (kind === K_BUBBLE) {
        if (sh.age >= sh.life) {
          popShot(b, sh, 0xffffff);
          continue;
        }
        if (b.hasFocus) {
          // 느린 유도: 초당 1(2페이즈 1.3) 라디안까지만 돈다
          const cur = Math.atan2(sh.vx, sh.vz);
          let diff = wrapAng(Math.atan2(b.fx - sh.x, b.fz - sh.z) - cur);
          const turn = (b.phase2 ? 1.3 : 1.0) * dt;
          if (diff > turn) diff = turn;
          else if (diff < -turn) diff = -turn;
          sh.vx = Math.sin(cur + diff);
          sh.vz = Math.cos(cur + diff);
        }
        sh.x += sh.vx * sh.speed * dt;
        sh.z += sh.vz * sh.speed * dt;
        sh.y += (zone.heightAt(sh.x, sh.z) + 1.25 - sh.y) * Math.min(1, dt * 2.2);
        if (zone.collider.solidAt(sh.x, sh.z)) {
          popShot(b, sh, 0xffffff);
          continue;
        }
        if (hitsMe(b, sh.x, sh.y, sh.z, sh.r)) {
          const took = hurtMe(b, sh.dmg, sh.x - sh.vx, sh.z - sh.vz, 3);
          if (took > 0 && sh.slowSec > 0) mayhem.addSlow(sh.slowSec, sh.slowF);
          popShot(b, sh, 0xffffff);
          continue;
        }
        // 남을 노린 탄은 그 사람에게 닿으면 터지기만 한다(피해는 그 사람 화면이 계산한다)
        if (!b.focusMe && b.hasFocus && (sh.x - b.fx) * (sh.x - b.fx) + (sh.z - b.fz) * (sh.z - b.fz) < 1.2) {
          popShot(b, sh, 0xffffff);
          continue;
        }
        sh.sp.material.opacity = Math.min(1, sh.age * 6, (sh.life - sh.age) * 2);
      } else if (kind === K_BOMB || kind === K_RAIN) {
        const span = sh.land - sh.t0;
        const u = span > 0 ? (t - sh.t0) / span : 1;
        if (u >= 1) {
          landDrop(b, sh);
          continue;
        }
        sh.y = sh.gy + 0.6 + DROP_H * (1 - u * u);
      } else if (kind === K_ORB) {
        if (sh.age >= sh.life) {
          popShot(b, sh, b.colorHex);
          continue;
        }
        orbPos(b, sh);
        const s = 1.5 * (1 + Math.sin(sh.age * 9 + sh.ang) * 0.08);
        sh.sp.scale.set(s, s, 1);
        if (t >= sh.hitAt && hitsMe(b, sh.x, sh.y, sh.z, sh.r)) {
          sh.hitAt = t + 0.9; // 같은 구슬은 0.9초에 한 번만
          hurtMe(b, sh.dmg, b.x, b.z, 6);
        }
      } else if (kind === K_BULLET) {
        if (sh.age >= sh.life) {
          freeShot(b, sh);
          continue;
        }
        // 한 프레임에 0.5m보다 많이 가면 나눠서 본다(큰 dt에서 나를 건너뛰지 않게)
        const dist = sh.speed * dt;
        const nStep = Math.min(6, Math.max(1, Math.ceil(dist / 0.5)));
        const sx = (sh.vx * dist) / nStep;
        const sz = (sh.vz * dist) / nStep;
        let gone = false;
        for (let k = 0; k < nStep; k++) {
          sh.x += sx;
          sh.z += sz;
          if (zone.collider.solidAt(sh.x, sh.z)) {
            popShot(b, sh, 0xff6060);
            gone = true;
            break;
          }
          sh.y = zone.heightAt(sh.x, sh.z) + 1.1;
          if (hitsMe(b, sh.x, sh.y, sh.z, sh.r)) {
            const took = hurtMe(b, sh.dmg, sh.x - sh.vx * 3, sh.z - sh.vz * 3, 5);
            if (took > 0 && sh.jam > 0) mayhem.jam(sh.jam);
            popShot(b, sh, 0xff6060);
            gone = true;
            break;
          }
        }
        if (gone) continue;
      }
      if (sh.kind !== K_FREE) sh.sp.position.set(sh.x, sh.y, sh.z);
    }
  }

  // ---------- 상태별 갱신 ----------
  function stepSleep(b, dt, t) {
    if (b.hp < b.maxHp) {
      b.hp = Math.min(b.maxHp, b.hp + b.maxHp * REGEN * dt);
      if (b.hp >= b.maxHp) b.mine = 0; // 다 나았으면 예전에 때린 몫은 없어진다
      if (b.phase2 && b.hp > b.maxHp * 0.5) setPhase2(b, false, t);
    }
    if (me.armed && player.zone === b.zid && d2me(b) <= b.wake * b.wake) wakeUp(b, t, true);
  }

  function stepFight(b, dt, t) {
    if (t >= b.nearAt) {
      b.nearAt = t + 0.25;
      chooseFocus(b, t);
    }
    if (t - b.lastNear > IDLE_SLEEP) {
      goSleep(b);
      return;
    }
    // 싸우는 상대의 지금 자리
    let has = false;
    if (b.focusMe && me.armed && player.zone === b.zid) {
      b.fx = player.pos.x;
      b.fz = player.pos.z;
      has = true;
    } else if (b.focusR) {
      const r = b.focusR;
      if (remotes.get(r.id) === r && !r.ko && r.wpn > 0 && r.zone === b.zid) {
        b.fx = r.x;
        b.fz = r.z;
        has = true;
      } else b.focusR = null;
    }
    b.hasFocus = has;
    if (!b.phase2 && b.hp <= b.maxHp * 0.5) setPhase2(b, true, t);
    if (has) b.wantYaw = Math.atan2(b.fx - b.x, b.fz - b.z);
    if (b.castT > 0) {
      // 준비 동작: 제자리에서 상대를 본다
      b.castT -= dt;
      if (b.castT <= 0) fireBurst(b);
      return;
    }
    if (b.hopT > 0) {
      b.hopT -= dt;
      if (b.hopT <= 0) {
        b.hopT = 0;
        startWaves(b, t);
      }
      return;
    }
    move(b, dt, t, has);
    // 기술은 내가 같은 구역에 있을 때만(보이지 않는 곳의 연출은 하지 않는다)
    if (has && t >= b.gcd && player.zone === b.zid) trySkill(b, t);
  }

  function stepDown(b, dt) {
    b.downT += dt;
    if (b.booms < b.nBooms && b.downT >= b.boomAt) {
      b.booms++;
      const last = b.booms === b.nBooms;
      if (player.zone === b.zid) {
        const a = rand(0, TAU);
        const r = rand(0.5, 2.8);
        oBoom.radius = last ? 5 : rand(2.8, 4);
        oBoom.big = last;
        oBoom.quiet = false;
        gfx.explosion(b.x + Math.cos(a) * r, b.gy + rand(0.8, 4.5), b.z + Math.sin(a) * r, oBoom);
      }
      b.boomAt = b.downT + rand(0.28, 0.45);
    }
    if (b.downT >= DOWN_SEC) {
      b.state = 'gone';
      b.group.visible = false;
    }
  }

  /** 과녁 목록: 내가 실제로 피해를 줄 수 있을 만큼 가까울 때만 올린다(wake 부근, 경계는 넉넉히) */
  function syncTarget(b) {
    const tg = b.target;
    const alive = b.state === 'sleep' || b.state === 'fight';
    if (tg.alive !== alive) tg.alive = alive;
    let want = false;
    if (alive && player.zone === b.zid) {
      const lim = b.wake + (b.registered ? ENGAGE_OUT : ENGAGE_IN);
      want = d2me(b) <= lim * lim;
    }
    if (want !== b.registered) {
      b.registered = want;
      if (want) mayhem.addTarget(tg);
      else mayhem.removeTarget(tg);
    }
    // 자리는 목록에 올라 있는 동안만 맞춘다(아무도 보지 않을 때는 쓰지 않는다)
    if (b.registered) {
      tg.x = b.x;
      tg.y = b.gy;
      tg.z = b.z;
    }
  }

  function animate(b, dt, t) {
    if (!b.group.visible) return;
    // 멀리서 자고 있는 보스는 움직이지 않으므로 그대로 둔다(상태가 막 바뀌었으면 자세가 끝까지 가게 조금 더 갱신)
    if (b.state === 'sleep' && b.hopT <= 0 && b.animLeft <= 0 && d2me(b) > ANIM_FAR * ANIM_FAR) {
      b.moved = 0;
      return;
    }
    if (b.animLeft > 0) b.animLeft -= dt;
    let hop = 0;
    if (b.hopT > 0) hop = Math.sin((1 - b.hopT / HOP) * Math.PI) * 1.8;
    b.y = b.gy + hop;
    const gp = b.group.position;
    if (gp.x !== b.x || gp.y !== b.y || gp.z !== b.z) gp.set(b.x, b.y, b.z); // 가만히 있으면 건드리지 않는다
    const turn = wrapAng(b.wantYaw - b.yaw);
    if (turn > 1e-4 || turn < -1e-4) {
      b.yaw += turn * Math.min(1, dt * 4);
      b.group.rotation.y = b.yaw;
    }
    const moved = b.moved;
    b.moved = 0;
    // 키운 만큼 나눠 준다(보폭이 몸에 맞게)
    b.avatar.update(dt, moved / b.scale, moved / dt / b.scale, hop > 0.3);
    const sleeping = b.state === 'sleep';
    if (b.zzz.visible !== sleeping) b.zzz.visible = sleeping;
    if (sleeping) {
      b.zzz.position.y = 1.95 + Math.sin(t * 1.6) * 0.08;
      b.zzz.material.opacity = 0.65 + Math.sin(t * 2.3) * 0.3;
    }
    if (b.parts.screen) b.parts.screen.offset.x = (b.parts.screen.offset.x + dt * (b.phase2 ? 0.55 : 0.22)) % 1;
    if (b.parts.led && b.phase2) b.parts.led.visible = Math.sin(t * 12) > 0;
    // 머리 위 체력 막대: 깨어 있는 동안만
    const shown = b.state === 'fight' ? Math.ceil(b.hp) : -1;
    if (shown !== b.hpShown) {
      b.hpShown = shown;
      b.avatar.setHP(shown < 0 ? null : shown, b.maxHp);
    }
  }

  /** 보스 체력 막대: 내가 60m 안이고 깨어 있는 보스 중 가장 가까운 것. 타임어택 중에는 숨긴다 */
  function updateHud() {
    let best = null;
    let bd = HUD_RANGE * HUD_RANGE;
    const climbing = !!(game && typeof game.climbActive === 'function' && game.climbActive());
    if (!climbing) {
      for (let i = 0; i < bosses.length; i++) {
        const b = bosses[i];
        if (b.state !== 'fight' || b.zid !== player.zone) continue;
        const d = d2me(b);
        if (d <= bd) {
          bd = d;
          best = b;
        }
      }
    }
    const q = best ? Math.round((Math.max(0, best.hp) / best.maxHp) * 400) : -1; // 0.25% 단위로만 다시 그린다
    if (best === hudBoss && q === hudQ) return;
    hudBoss = best;
    hudQ = q;
    if (!best) {
      ui.setBoss(null);
      return;
    }
    hud.name = best.name;
    hud.hp01 = Math.max(0, best.hp) / best.maxHp;
    ui.setBoss(hud);
  }

  /** 지도 표시: 깨어 있으면 보스 색, 잠들었으면 흐리게, 재등장 대기는 더 흐리게(같은 배열·객체를 고쳐 쓴다) */
  function mapMarkers() {
    markers.length = 0;
    for (let i = 0; i < bosses.length; i++) {
      const b = bosses[i];
      if (b.zid !== player.zone) continue;
      const m = b.marker;
      const gone = b.state === 'gone';
      m.x = gone ? b.home.x : b.x;
      m.z = gone ? b.home.z : b.z;
      m.color = b.state === 'fight' ? b.color : b.state === 'sleep' ? b.dim : b.faint;
      m.r = b.state === 'fight' ? 10 : 7;
      markers.push(m);
    }
    return markers;
  }

  function update(dt) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    const t = engine.time;
    const st = mayhem.state;
    me.armed = st.wpn > 0 && !st.ko;
    for (let i = 0; i < bosses.length; i++) {
      const b = bosses[i];
      if (b.state === 'gone') {
        if (t >= b.respawnAt) respawn(b, t);
      } else if (b.state === 'down') stepDown(b, dt);
      else if (b.state === 'sleep') stepSleep(b, dt, t);
      else stepFight(b, dt, t);
      if (b.active > 0) stepShots(b, dt, t);
      stepWaves(b, t);
      syncTarget(b);
      if (player.zone === b.zid) animate(b, dt, t);
      else b.moved = 0; // 다른 구역에 있는 동안 걸은 거리는 버린다(돌아왔을 때 걷기 동작이 튀지 않게)
    }
    updateHud();
  }

  // ---------- 만들기 ----------
  for (const def of BOSSES) {
    const b = makeBoss(def);
    if (!b) continue;
    bosses.push(b);
    byKey.set(b.key, b);
  }
  if (game && typeof game.addMapMarker === 'function') game.addMapMarker(mapMarkers);

  const find = (key) => {
    if (typeof key !== 'string') return null;
    const k = key.startsWith('boss:') ? key.slice(5) : key;
    return byKey.get(k) || null;
  };

  return {
    update,
    /**
     * 보스 기록들(읽기 전용으로 쓸 것). 다른 모듈이 읽는 필드라 이름을 바꾸지 않는다:
     *   key · byId('boss:키') · name · zid(구역 id) · home { x, z, yaw } · arena · wake · hitR(내 피해를 인정하는 거리) · state('sleep'|'fight'|'down'|'gone')
     *   x · z · hp · maxHp · target(mayhem.targets에 올리는 과녁 객체) — 파괴 모듈은 허수아비를 세울 때 zid·home·wake·arena를 본다(깨우는 거리 밖에 세운다)
     */
    bosses: () => bosses,
    /** 'nag' 또는 'boss:nag' → 보스 이름(모르면 빈 문자열). 기절 알림 문구용 */
    nameOf(key) {
      const b = find(key);
      return b ? b.name : '';
    },
    mapMarkers,
    /** 시험용: 잠든 보스를 깨운다 */
    wake(key) {
      const b = find(key);
      if (!b || b.state !== 'sleep') return false;
      wakeUp(b, engine.time, true);
      return true;
    },
    /** 시험용: 격파 연출(막타 알림은 보내지 않는다. 보상은 평소 규칙대로) */
    defeat(key) {
      const b = find(key);
      return b ? defeat(b, engine.time, false, '', '') : false;
    },
    /** 시험용: 깨어 있는 보스가 그 종류의 기술을 지금 쓴다(상대가 없으면 나를 노린다) */
    cast(key, kind) {
      const b = find(key);
      if (!b || b.state !== 'fight' || b.castT > 0 || b.hopT > 0) return false;
      const s = b.skills.find((x) => x.kind === kind);
      if (!s) return false;
      if (!b.hasFocus) {
        b.fx = player.pos.x;
        b.fz = player.pos.z;
        b.hasFocus = true;
      }
      cast(b, s, engine.time);
      return true;
    },
  };
}
