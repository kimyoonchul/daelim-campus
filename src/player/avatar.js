// 아바타: 과잠(학과 점퍼)을 입은 로우폴리 캐릭터. 걷기·달리기·점프·감정표현 동작과 이름표·말풍선.
// 난투용으로 장난감 무기·공격 동작·기절(머리 위 별)·맞았을 때 번쩍임·체력 막대도 여기서 그린다.
import * as THREE from 'three';
import { Geo } from '../world/geom.js';
import { textTexture } from '../world/textures.js';
import { CLUBS } from '../config.js';

const SKIN = new THREE.MeshLambertMaterial({ color: 0xf3c9a2 });
const PANTS = new THREE.MeshLambertMaterial({ color: 0x2f3a4f });
const SHOE = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });
const SLEEVE = new THREE.MeshLambertMaterial({ color: 0xf4f1ea });
const EYE = new THREE.MeshBasicMaterial({ color: 0x1d1d22 });
const CHEEK = new THREE.MeshBasicMaterial({ color: 0xf2a08c });
const BLACK = new THREE.MeshLambertMaterial({ color: 0x15161a });
const GOLD = new THREE.MeshLambertMaterial({ color: 0xf2c230 });
const HAIRS = [0x1c1a19, 0x2b211b, 0x3d2a1e, 0x59402b, 0x14161d, 0x6b4a2e].map((c) => new THREE.MeshLambertMaterial({ color: c }));

const G = {
  torso: new Geo().box(0, 0.28, 0, 0.5, 0.56, 0.3).build(),
  hem: new Geo().box(0, 0.03, 0, 0.52, 0.07, 0.32).build(),
  arm: new Geo().box(0, -0.2, 0, 0.15, 0.42, 0.17).build(),
  hand: new Geo().box(0, -0.47, 0, 0.13, 0.13, 0.15).build(),
  leg: new Geo().box(0, -0.31, 0, 0.2, 0.62, 0.22).build(),
  shoe: new Geo().box(0, -0.67, 0.04, 0.22, 0.12, 0.32).build(),
  head: new THREE.SphereGeometry(0.27, 16, 12),
  hair: new THREE.SphereGeometry(0.285, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56),
  eye: new THREE.SphereGeometry(0.034, 8, 6),
  cheek: new THREE.CircleGeometry(0.045, 10),
  capBoard: new Geo().box(0, 0, 0, 0.56, 0.035, 0.56).build(),
  capBase: new THREE.CylinderGeometry(0.2, 0.23, 0.12, 12),
  tassel: new Geo().box(0, -0.09, 0, 0.03, 0.18, 0.03).build(),
};

// ----- 난투 소품 -----
// 아래 재질과 지오메트리는 모든 아바타가 함께 쓴다. 아바타의 dispose()에서 지우면 안 된다.
const ATK_DUR = 0.28; // 공격 동작 길이(초)
const FLASH_DUR = 0.15; // 맞았을 때 번쩍이는 길이(초)
const HP_FULL = 100; // 체력 막대가 가득 찼을 때의 값(mayhem/rules.js의 MAX_HP와 같은 값)
const HP_W = 0.9; // 체력 막대 크기(m)
const HP_H = 0.09;
const TOY = new THREE.MeshLambertMaterial({ vertexColors: true });
const STAR = new THREE.MeshBasicMaterial({ color: 0xffd84a, toneMapped: false });
const HP_BACK = new THREE.SpriteMaterial({ color: 0x121a28, transparent: true, opacity: 0.82, depthWrite: false, toneMapped: false, fog: false });
// 체력이 줄수록 빨강 ← 노랑 ← 초록
const HP_FILL = [0xff5a5a, 0xffc93c, 0x3ddc84].map((color) => new THREE.SpriteMaterial({ color, transparent: true, depthWrite: false, toneMapped: false, fog: false }));

/** 색을 입힌 도형 여러 개를 지오메트리 하나로 합친다(정점 색) — 소품 하나를 한 번에 그리려고 */
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
const boxAt = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
/** y축을 따라 선 원통(가운데 높이 y) */
const cylAt = (rTop, rBottom, h, y, seg = 12, open = false) => new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open).translate(0, y, 0);

/** 물총: 오른팔에 붙인다. 팔 좌표계에서 손끝 쪽이 -y, 팔을 앞으로 뻗었을 때 위쪽이 +z */
function squirtGeo() {
  return fuse([
    [boxAt(0.11, 0.42, 0.13, 0, -0.66, 0.085), 0x2196f3], // 몸통
    [boxAt(0.15, 0.2, 0.14, 0, -0.56, 0.21), 0xffd23f], // 물탱크
    [boxAt(0.07, 0.07, 0.05, 0, -0.56, 0.3), 0xff8a3d], // 탱크 마개
    [boxAt(0.065, 0.1, 0.065, 0, -0.91, 0.085), 0xffd23f], // 총구
    [boxAt(0.06, 0.09, 0.1, 0, -0.64, -0.02), 0xffd23f], // 방아쇠
  ]);
}

/** 폭죽 통: 오른 어깨에 멘다(몸통 좌표계, 앞이 +z). 빨강·흰 줄무늬 */
function tubeGeo() {
  const parts = [];
  const n = 6;
  const len = 0.17;
  for (let i = 0; i < n; i++) parts.push([cylAt(0.105, 0.105, len, (i - (n - 1) / 2) * len, 12, true), i % 2 ? 0xf5f3ee : 0xe5383b]);
  const half = (n * len) / 2;
  parts.push([cylAt(0.125, 0.125, 0.05, half + 0.02), 0xf2c230]); // 앞뒤 금테(통 끝을 막는다)
  parts.push([cylAt(0.125, 0.125, 0.05, -half - 0.02), 0xf2c230]);
  parts.push([new THREE.ConeGeometry(0.08, 0.2, 10).translate(0, half + 0.14, 0), 0xffd23f]); // 장전된 폭죽 머리
  return fuse(parts).rotateX(Math.PI / 2).translate(0.37, 0.7, 0.1);
}

/** 대포: 오른 어깨에 멘다. 장난감처럼 큼직한 진회색 원통 */
function cannonGeo() {
  return fuse([
    [cylAt(0.2, 0.235, 1.0, 0, 14), 0x3d424b], // 포신(앞이 조금 가늘다)
    [cylAt(0.255, 0.255, 0.14, 0.5, 14), 0x2a2d34], // 포구 테
    [cylAt(0.15, 0.15, 0.02, 0.572, 14), 0x08090b], // 포구 안쪽
    [cylAt(0.245, 0.245, 0.09, -0.12, 14), 0x2a2d34], // 가운데 띠
    [new THREE.SphereGeometry(0.235, 14, 8).translate(0, -0.5, 0), 0x3d424b], // 둥근 뒤쪽
    [new THREE.SphereGeometry(0.075, 10, 6).translate(0, -0.78, 0), 0xf2c230], // 뒤 꼭지
  ])
    .rotateX(Math.PI / 2)
    .translate(0.52, 0.8, 0.12);
}

/** 기절했을 때 머리 위를 도는 별 */
function starGeo() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.06 : 0.14;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false }).translate(0, 0, -0.025);
}

// 처음 쓰일 때 한 번만 만든다(무기 번호 2 물총, 3 폭죽 통, 4 대포)
const GEAR_MAKERS = [null, null, squirtGeo, tubeGeo, cannonGeo];
const gearGeos = [];
const gearGeo = (w) => gearGeos[w] || (gearGeos[w] = GEAR_MAKERS[w]());
let starGeoCache = null;
/** 무기 번호를 0(평화)~4 정수로 맞춘다. 그 밖의 값은 0 */
const weaponId = (w) => (w >= 1 && w <= 4 ? Math.floor(w) : 0);

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** 이름표: 닉네임 + (동아리 · 학번) */
function makeNameTag(profile) {
  const name = profile.n || '손님';
  const club = CLUBS.find((c) => c.id === profile.c);
  const subParts = [];
  if (club) subParts.push(club.name);
  else if (profile.c === 'etc' && profile.ct) subParts.push(profile.ct);
  if (profile.y) subParts.push(profile.y + '학번');
  const sub = subParts.join(' · ');
  const F1 = 'bold 46px "Jua", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const F2 = 'bold 28px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const m = document.createElement('canvas').getContext('2d');
  m.font = F1;
  const w1 = m.measureText(name).width;
  m.font = F2;
  const w2 = sub ? m.measureText(sub).width : 0;
  const W = Math.ceil(Math.max(w1, w2) + 44);
  const Hh = sub ? 104 : 68;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = Hh;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(18,26,40,0.74)';
  roundRect(g, 0, 0, W, Hh, 22);
  g.fill();
  if (club) {
    g.fillStyle = club.color;
    roundRect(g, 0, Hh - 8, W, 8, 4);
    g.fill();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = F1;
  g.fillStyle = '#ffffff';
  g.fillText(name, W / 2, 36);
  if (sub) {
    g.font = F2;
    g.fillStyle = club ? club.color : '#b9c6d8';
    g.fillText(sub, W / 2, 78);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
  const hM = sub ? 0.56 : 0.37;
  s.scale.set((hM * W) / Hh, hM, 1);
  s.userData.h = hM;
  return s;
}

/** 등판 글씨(과잠 뒷면) */
function makeBackPrint(profile) {
  const club = CLUBS.find((c) => c.id === profile.c);
  const text = club ? club.name : 'DAELIM';
  const t = textTexture(text, { font: 'bold 60px "Jua", "Malgun Gothic", sans-serif', color: '#ffffff', pad: 6 });
  const w = Math.min(0.42, 0.11 * text.length + 0.08);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / t.userData.aspect), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
  m.position.set(0, 0.36, -0.156);
  m.rotation.y = Math.PI;
  return m;
}

function wrapText(g, text, maxW) {
  const lines = [];
  let cur = '';
  for (const ch of text) {
    if (ch === '\n' || g.measureText(cur + ch).width > maxW) {
      lines.push(cur);
      cur = ch === '\n' ? '' : ch;
      if (lines.length === 3) break;
    } else cur += ch;
  }
  if (lines.length < 3 && cur) lines.push(cur);
  else if (lines.length === 3 && cur) lines[2] = lines[2].slice(0, -1) + '…';
  return lines;
}

function makeBubble(text) {
  const F = 'bold 34px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const m = document.createElement('canvas').getContext('2d');
  m.font = F;
  const lines = wrapText(m, text, 430);
  let w = 60;
  for (const l of lines) w = Math.max(w, m.measureText(l).width);
  const W = Math.ceil(w + 48);
  const Hh = lines.length * 44 + 40;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = Hh;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.96)';
  g.strokeStyle = 'rgba(30,40,60,0.85)';
  g.lineWidth = 4;
  roundRect(g, 2, 2, W - 4, Hh - 18, 20);
  g.fill();
  g.stroke();
  // 꼬리
  g.beginPath();
  g.moveTo(W / 2 - 12, Hh - 18);
  g.lineTo(W / 2, Hh - 2);
  g.lineTo(W / 2 + 12, Hh - 18);
  g.closePath();
  g.fillStyle = 'rgba(255,255,255,0.96)';
  g.fill();
  g.font = F;
  g.fillStyle = '#1c2533';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, W / 2, 24 + 44 * i + 16));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false }));
  const hM = 0.3 * lines.length + 0.3;
  s.scale.set((hM * W) / Hh, hM, 1);
  s.userData.h = hM;
  s.renderOrder = 20;
  return s;
}

export const EMOTES = [
  null,
  { id: 1, icon: '👋', name: '인사', dur: 2.2 },
  { id: 2, icon: '🎉', name: '환호', dur: 2.4 },
  { id: 3, icon: '💃', name: '춤', dur: 4.0 },
  { id: 4, icon: '🙇', name: '꾸벅', dur: 1.8 },
  { id: 5, icon: '🧘', name: '앉기', dur: Infinity },
  { id: 6, icon: '❤', name: '하트', dur: 2.4 },
];

export class Avatar {
  constructor(profile, id = '') {
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.id = id;
    this.phase = 0;
    this.emote = 0;
    this.emoteT = 0;
    this.air = false;
    this.speed = 0;
    this.t = (hashStr(id || 'x') % 100) / 10;
    this.jacket = new THREE.MeshLambertMaterial({ color: 0x2e86de });
    // 난투 상태(무기·공격 동작·기절·번쩍임·체력 막대). 메시는 처음 쓰일 때 만든다.
    this.wpn = 0; // 들고 있는 무기(0 평화, 1 주먹, 2 물총, 3 폭죽 통, 4 대포)
    this.gear = [null, null, null, null, null]; // 무기 번호별 메시
    this.atkT = 0; // 공격 동작이 끝나기까지 남은 시간(초)
    this.atkW = 0; // 그 동작의 무기 번호
    this.ko = false;
    this.stars = null;
    this.flashT = 0;
    this.hp = null; // 체력 막대에 보이는 비율(0~1). null이면 막대를 숨긴 상태
    this.hpBar = null;
    this.hpFill = null;
    this._build(id);
    this.setProfile(profile || {});
  }

  _build(id) {
    const b = this.body;
    const mk = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    this.torso = new THREE.Group();
    this.torso.position.y = 0.72;
    b.add(this.torso);
    mk(G.torso, this.jacket, this.torso);
    mk(G.hem, SLEEVE, this.torso);

    this.head = new THREE.Group();
    this.head.position.y = 0.82;
    this.torso.add(this.head);
    mk(G.head, SKIN, this.head);
    const hair = mk(G.hair, HAIRS[hashStr(id || 'me') % HAIRS.length], this.head, 0, 0.012, -0.012);
    hair.rotation.x = -0.28;
    mk(G.eye, EYE, this.head, -0.095, 0.02, 0.245).castShadow = false;
    mk(G.eye, EYE, this.head, 0.095, 0.02, 0.245).castShadow = false;
    const c1 = mk(G.cheek, CHEEK, this.head, -0.16, -0.06, 0.212);
    c1.rotation.y = -0.6;
    c1.castShadow = false;
    const c2 = mk(G.cheek, CHEEK, this.head, 0.16, -0.06, 0.212);
    c2.rotation.y = 0.6;
    c2.castShadow = false;

    const limb = (x, y, geoA, matA, geoB, matB) => {
      const p = new THREE.Group();
      p.position.set(x, y, 0);
      mk(geoA, matA, p);
      mk(geoB, matB, p);
      return p;
    };
    this.armL = limb(-0.33, 0.52, G.arm, SLEEVE, G.hand, SKIN);
    this.armR = limb(0.33, 0.52, G.arm, SLEEVE, G.hand, SKIN);
    this.torso.add(this.armL, this.armR);
    this.legL = limb(-0.125, 0.73, G.leg, PANTS, G.shoe, SHOE);
    this.legR = limb(0.125, 0.73, G.leg, PANTS, G.shoe, SHOE);
    b.add(this.legL, this.legR);

    // 학사모(스탬프 투어를 끝내면 쓴다)
    this.cap = new THREE.Group();
    this.cap.position.y = 0.29;
    mk(G.capBase, BLACK, this.cap, 0, -0.03, 0);
    mk(G.capBoard, BLACK, this.cap, 0, 0.05, 0).rotation.y = Math.PI / 4;
    mk(G.tassel, GOLD, this.cap, 0.2, 0.05, 0.2);
    this.cap.visible = false;
    this.head.add(this.cap);
  }

  setProfile(p) {
    this.profile = p;
    this.jacket.color.set(p.col || '#2e86de');
    if (this.back) {
      this.torso.remove(this.back);
      this.back.material.map.dispose();
      this.back.material.dispose();
    }
    this.back = makeBackPrint(p);
    this.torso.add(this.back);
    if (this.tag) {
      this.group.remove(this.tag);
      this.tag.material.map.dispose();
      this.tag.material.dispose();
    }
    this.tag = makeNameTag(p);
    this.tag.position.y = 2.02 + this.tag.userData.h / 2;
    this.group.add(this.tag);
    this.cap.visible = !!p.g;
    if (p.g) this.tag.position.y += 0.16;
    this._layout();
  }

  /** 이름표 위에 얹는 것들의 높이를 맞춘다: 이름표 → (체력 막대) → 말풍선 */
  _layout() {
    let top = this.tag.position.y + this.tag.userData.h / 2;
    if (this.hpBar && this.hpBar.visible) {
      this.hpBar.position.y = top + 0.12;
      top += 0.19;
    }
    if (this.bubble) this.bubble.position.y = top + this.bubble.userData.h / 2 + 0.06;
  }

  say(text) {
    this.clearBubble();
    this.bubble = makeBubble(text);
    this.bubbleT = Math.min(9, 3.5 + text.length * 0.09);
    this.group.add(this.bubble);
    this._layout();
  }

  clearBubble() {
    if (!this.bubble) return;
    this.group.remove(this.bubble);
    this.bubble.material.map.dispose();
    this.bubble.material.dispose();
    this.bubble = null;
  }

  playEmote(n) {
    this.emote = n;
    this.emoteT = 0;
  }

  /** 든 무기를 바꾼다(0 평화, 1 주먹은 맨손 · 2 물총은 오른손 · 3 폭죽 통과 4 대포는 오른 어깨) */
  setWeapon(w) {
    w = weaponId(w);
    if (w === this.wpn) return;
    const old = this.gear[this.wpn];
    if (old) old.visible = false;
    this.wpn = w;
    if (w < 2) return;
    let m = this.gear[w];
    if (!m) {
      m = this.gear[w] = new THREE.Mesh(gearGeo(w), TOY);
      m.castShadow = true;
      (w === 2 ? this.armR : this.torso).add(m);
    }
    m.position.set(0, 0, 0);
    m.visible = true;
  }

  /** 공격 동작 한 번(0.28초): 주먹은 잽, 나머지는 발사 반동. w를 생략하면 지금 든 무기 */
  attack(w = this.wpn) {
    w = weaponId(w);
    if (!w || this.ko) return;
    this.atkW = w;
    this.atkT = ATK_DUR;
    this.emote = 0; // 움직일 때처럼 감정표현은 풀린다
  }

  /** 기절: 뒤로 눕고 머리 위에 별이 돈다. false면 다시 일어난다 */
  setKO(on) {
    on = !!on;
    if (on === this.ko) return;
    this.ko = on;
    if (on) {
      this.emote = 0;
      this.atkT = 0;
      if (!this.stars) {
        if (!starGeoCache) starGeoCache = starGeo();
        this.stars = new THREE.Group();
        for (let i = 0; i < 3; i++) this.stars.add(new THREE.Mesh(starGeoCache, STAR));
        this.group.add(this.stars);
      }
    }
    if (this.stars) this.stars.visible = on;
  }

  /** 맞았을 때 0.15초 번쩍인다(이 아바타의 자켓 재질만 밝힌다) */
  flash() {
    this.flashT = FLASH_DUR;
    this.jacket.emissive.setScalar(0.9);
  }

  /** 이름표 위의 얇은 체력 막대. v가 null이면 숨긴다(max는 가득 찼을 때의 값) */
  setHP(v, max = HP_FULL) {
    if (v == null) {
      if (this.hp === null) return;
      this.hp = null;
      this.hpBar.visible = false;
      this._layout();
      return;
    }
    let k = v / max;
    k = k > 0 ? Math.min(1, k) : 0; // 음수·NaN은 0으로
    if (k === this.hp) return;
    if (!this.hpBar) {
      // 단색 판 2장(바탕 + 채움). 스프라이트라 늘 화면을 향하고, 같은 자리에 있어 만든 순서(바탕 먼저)대로 그려진다.
      const back = new THREE.Sprite(HP_BACK);
      back.scale.set(HP_W + 0.05, HP_H + 0.05, 1);
      this.hpFill = new THREE.Sprite(HP_FILL[2]);
      this.hpFill.scale.set(HP_W, HP_H, 1);
      this.hpBar = new THREE.Group();
      this.hpBar.add(back, this.hpFill);
      this.hpBar.visible = false;
      this.group.add(this.hpBar);
    }
    const fill = this.hpFill;
    fill.visible = k > 0.004;
    if (fill.visible) {
      // 길이는 scale.x로. center.x를 같이 옮겨 화면에서 왼쪽 끝이 고정되게 한다(스프라이트는 center 기준으로 늘어난다).
      fill.scale.x = HP_W * k;
      fill.center.x = 0.5 / k;
      fill.material = HP_FILL[k > 0.5 ? 2 : k > 0.25 ? 1 : 0];
    }
    const wasHidden = this.hp === null;
    this.hp = k;
    if (wasHidden) {
      this.hpBar.visible = true;
      this._layout();
    }
  }

  /** dt 동안의 이동 거리(moved), 속도, 공중 여부로 동작을 갱신한다 */
  update(dt, moved, speed, air) {
    this.t += dt;
    this.speed = speed;
    const t = this.t;
    const ko = this.ko;
    const run = speed > 5.6;
    if (moved > 0.0005 && !ko) {
      this.phase += moved * (run ? 2.6 : 3.6);
      if (this.emote) this.emote = 0;
    }
    const k = ko ? 0 : Math.min(1, speed / 2.2); // 걷는 정도
    const amp = (run ? 1.0 : 0.62) * k;
    const s = Math.sin(this.phase);
    let legL = s * amp;
    let legR = -s * amp;
    let armL = -s * amp * 0.85;
    let armR = s * amp * 0.85;
    let armLz = 0.06;
    let armRz = -0.06;
    let bodyY = Math.abs(Math.cos(this.phase)) * 0.05 * k;
    let lean = run ? 0.2 * k : 0.05 * k;
    let headX = 0;
    let bodyRotX = 0;
    let bodyRotY = 0;
    let bodyRotZ = 0;
    let bodyZ = 0;
    let recoil = 0; // 어깨에 멘 무기가 반동으로 뒤로 밀리는 거리
    // 숨쉬기
    const breath = Math.sin(t * 2.1) * 0.012 * (1 - k);
    armLz += breath * 2;
    armRz -= breath * 2;

    if (ko) {
      // 기절: 뒤로 벌렁 누워 팔다리를 뻗는다(걷기·공중·감정표현 자세는 건너뛴다)
      legL = 0.18;
      legR = -0.1;
      armL = armR = 0;
      armLz = 1.25;
      armRz = -1.25;
      lean = 0;
      bodyY = 0.22;
      bodyRotX = -Math.PI / 2;
    } else if (air) {
      legL = -0.5;
      legR = 0.35;
      armL = armR = -0.4;
      armLz = 0.9;
      armRz = -0.9;
      lean = 0.05;
    } else if (this.emote && speed < 0.3) {
      this.emoteT += dt;
      const e = this.emoteT;
      const def = EMOTES[this.emote];
      if (def && e > def.dur) this.emote = 0;
      else if (this.emote === 1) {
        armR = 0;
        armRz = -2.55 + Math.sin(e * 11) * 0.38;
        headX = -0.05;
      } else if (this.emote === 2) {
        armL = armR = 0;
        armLz = 2.7 + Math.sin(e * 14) * 0.15;
        armRz = -2.7 - Math.sin(e * 14) * 0.15;
        bodyY = Math.abs(Math.sin(e * 7)) * 0.28;
      } else if (this.emote === 3) {
        bodyRotY = Math.sin(e * 5) * 0.55;
        bodyRotZ = Math.sin(e * 10) * 0.08;
        armLz = 1.3 + Math.sin(e * 10) * 0.7;
        armRz = -1.3 + Math.sin(e * 10) * 0.7;
        bodyY = Math.abs(Math.sin(e * 10)) * 0.09;
        legL = Math.sin(e * 10) * 0.25;
        legR = -legL;
      } else if (this.emote === 4) {
        const w = Math.sin(Math.min(1, e / 1.6) * Math.PI);
        lean = w * 0.95;
        headX = w * 0.3;
      } else if (this.emote === 5) {
        legL = legR = 1.5;
        bodyY = -0.5;
        armL = armR = -0.5;
        lean = -0.08;
      } else if (this.emote === 6) {
        armL = armR = 0;
        armLz = 2.45;
        armRz = -2.45;
        bodyRotZ = Math.sin(e * 6) * 0.06;
        headX = -0.1;
      }
    }

    const atk = !ko && this.atkT > 0;
    if (!ko) {
      // 무기를 든 자세. 감정표현 중에는 팔을 감정표현에 맡긴다.
      const w = this.wpn;
      if (w > 1 && !(this.emote && !air && speed < 0.3)) {
        if (w === 2) armR = 0.5 + armR * 0.3; // 물총: 살짝 들고 덜 흔든다
        else {
          armR = 1.75; // 어깨에 멘 통을 오른손으로 받친다
          armRz = w === 3 ? -0.09 : -0.41;
        }
      }
      if (atk) {
        const a = 1 - this.atkT / ATK_DUR; // 진행 0 → 1
        const kick = Math.max(0, 1 - a * 2.5); // 쏜 직후 세고 금방 사라지는 반동
        if (this.atkW === 1) {
          // 주먹: 오른팔을 앞으로 쭉 뻗었다 거둔다(어깨도 같이 나간다)
          const j = Math.sin(Math.pow(a, 0.6) * Math.PI);
          armR += (1.55 - armR) * j;
          armRz += (0.12 - armRz) * j;
          bodyRotY -= 0.35 * j;
          lean += 0.1 * j;
        } else if (this.atkW === 2) {
          // 물총: 팔을 앞으로 뻗어 겨누고 총구가 살짝 들린다
          armR = 1.5 + 0.25 * kick;
          armRz = 0;
          lean -= 0.04 * kick;
        } else {
          // 폭죽 통·대포: 몸이 뒤로 젖혀지며 밀린다(대포가 더 세다)
          const big = this.atkW === 4 ? 1.7 : 1;
          lean -= 0.2 * big * kick;
          bodyZ = -0.1 * big * kick;
          recoil = 0.1 * big * kick;
        }
        this.atkT -= dt;
      }
    }

    const f = Math.min(1, dt * 16);
    const fa = atk ? Math.min(1, dt * 40) : f; // 공격 동작은 더 날래게 따라간다
    const L = (o, key, v, q = f) => {
      o.rotation[key] += (v - o.rotation[key]) * q;
    };
    L(this.legL, 'x', -legL);
    L(this.legR, 'x', -legR);
    L(this.armL, 'x', -armL);
    L(this.armR, 'x', -armR, fa);
    L(this.armL, 'z', -armLz);
    L(this.armR, 'z', -armRz, fa);
    L(this.torso, 'x', lean, fa);
    L(this.head, 'x', headX - lean * 0.5);
    L(this.body, 'x', bodyRotX, Math.min(1, dt * 9)); // 쓰러지고 일어나는 것은 조금 천천히
    L(this.body, 'y', bodyRotY, fa);
    L(this.body, 'z', bodyRotZ);
    this.body.position.y += (bodyY - this.body.position.y) * f;
    this.body.position.z += (bodyZ - this.body.position.z) * fa;
    this.torso.scale.y = 1 + breath;

    const held = this.wpn > 2 ? this.gear[this.wpn] : null;
    if (held) held.position.z = -recoil;

    if (ko && this.stars) {
      // 별은 누운 머리 위에서 돈다(쓰러지는 동안에는 머리를 따라 내려온다)
      const st = this.stars;
      const lie = -this.body.rotation.x; // 0(서 있음) → π/2(누움)
      const headH = this.torso.position.y + this.head.position.y;
      st.position.set(0, this.body.position.y + headH * Math.cos(lie) + 0.5, -headH * Math.sin(lie));
      for (let i = 0; i < st.children.length; i++) {
        const m = st.children[i];
        const a = t * 3.4 + (i * Math.PI * 2) / st.children.length;
        m.position.set(Math.cos(a) * 0.36, Math.sin(t * 5 + i * 2) * 0.04, Math.sin(a) * 0.36);
        m.rotation.y = t * 5 + i;
      }
    }

    if (this.flashT > 0) {
      this.flashT -= dt;
      this.jacket.emissive.setScalar(this.flashT > 0 ? (this.flashT / FLASH_DUR) * 0.9 : 0);
    }

    if (this.bubble) {
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) this.clearBubble();
      else this.bubble.material.opacity = Math.min(1, this.bubbleT * 2);
    }
  }

  dispose() {
    this.clearBubble();
    if (this.tag) {
      this.tag.material.map.dispose();
      this.tag.material.dispose();
    }
    if (this.back) {
      this.back.material.map.dispose();
      this.back.material.dispose();
    }
    this.jacket.dispose();
    // 난투 소품: 지오메트리·재질은 모든 아바타가 함께 쓰므로 지우지 않고, 이 아바타가 만든 객체만 떼어 낸다
    for (let i = 0; i < this.gear.length; i++) {
      if (this.gear[i]) this.gear[i].removeFromParent();
      this.gear[i] = null;
    }
    if (this.stars) this.stars.removeFromParent();
    if (this.hpBar) this.hpBar.removeFromParent();
    this.stars = this.hpBar = this.hpFill = null;
    this.wpn = 0;
    this.ko = false;
    this.hp = null;
  }
}
