// 아바타: 과잠(학과 점퍼)을 입은 로우폴리 캐릭터. 걷기·달리기·점프·감정표현 동작과 이름표·말풍선.
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
  }

  say(text) {
    this.clearBubble();
    this.bubble = makeBubble(text);
    this.bubble.position.y = this.tag.position.y + this.tag.userData.h / 2 + this.bubble.userData.h / 2 + 0.06;
    this.bubbleT = Math.min(9, 3.5 + text.length * 0.09);
    this.group.add(this.bubble);
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

  /** dt 동안의 이동 거리(moved), 속도, 공중 여부로 동작을 갱신한다 */
  update(dt, moved, speed, air) {
    this.t += dt;
    this.speed = speed;
    const t = this.t;
    const run = speed > 5.6;
    if (moved > 0.0005) {
      this.phase += moved * (run ? 2.6 : 3.6);
      if (this.emote) this.emote = 0;
    }
    const k = Math.min(1, speed / 2.2); // 걷는 정도
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
    let bodyRotY = 0;
    let bodyRotZ = 0;
    // 숨쉬기
    const breath = Math.sin(t * 2.1) * 0.012 * (1 - k);
    armLz += breath * 2;
    armRz -= breath * 2;

    if (air) {
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

    const f = Math.min(1, dt * 16);
    const L = (o, key, v) => {
      o.rotation[key] += (v - o.rotation[key]) * f;
    };
    L(this.legL, 'x', -legL);
    L(this.legR, 'x', -legR);
    L(this.armL, 'x', -armL);
    L(this.armR, 'x', -armR);
    L(this.armL, 'z', -armLz);
    L(this.armR, 'z', -armRz);
    L(this.torso, 'x', lean);
    L(this.head, 'x', headX - lean * 0.5);
    L(this.body, 'y', bodyRotY);
    L(this.body, 'z', bodyRotZ);
    this.body.position.y += (bodyY - this.body.position.y) * f;
    this.torso.scale.y = 1 + breath;

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
  }
}
