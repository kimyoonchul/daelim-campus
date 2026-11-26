// 난투 효과: 폭발·잔해·만화 효과음 글자·물보라·연기·바닥 고리·화면 흔들림.
// 전부 처음에 만들어 둔 풀을 돌려 쓴다(효과가 날 때마다 메시·재질을 만들지 않는다).
// 살아 있는 것이 하나도 없는 풀은 갱신도 GPU 업로드도 하지 않고 숨겨 둔다.
// 조명은 여기서 만들지 않는다 — createEngine이 만들어 둔 engine.flashLights의 밝기만 바꾼다(없으면 빛 스프라이트만 번쩍인다).
import * as THREE from 'three';
import { textTexture } from '../world/textures.js';
import { sfx } from '../core/sfx.js';

const HIDE_Y = -9999; // 죽은 입자를 치워 두는 높이
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const fin = (v, def) => (Number.isFinite(v) ? v : def);

/** 둥글고 가장자리가 흐린 빛 점(불꽃 입자·섬광) */
function dotTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; // 글자 텍스처와 같은 색 공간(만화 글자 스프라이트가 이 텍스처를 임시로 물고 있다가 바꿔 낀다)
  return t;
}

/**
 * createGfx(engine, cam, { currentGround })
 *   cam            따라가는 카메라(createFollowCamera) — 화면 흔들림(cam.shake)에 쓴다
 *   currentGround  () => (x, z) => 지면 높이 — "지금 내가 있는 구역"의 지면 함수를 돌려주는 함수.
 *                  debris가 ground를 받지 못했을 때 쓴다(생략하면 높이 0인 평지).
 */
export function createGfx(engine, cam, opts = {}) {
  const low = !!(engine.quality && engine.quality.low);
  const camera = engine.camera || null;
  const lights = engine.flashLights || [];
  const currentGround = typeof opts.currentGround === 'function' ? opts.currentGround : null;
  const flat = () => 0;

  const root = new THREE.Group();
  root.name = 'mayhem-gfx';
  engine.scene.add(root);
  const dot = dotTexture();
  const _c = new THREE.Color();
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _e = new THREE.Euler();
  const counts = { sparks: 0, smoke: 0, debris: 0, rings: 0, flashes: 0, comics: 0, lights: 0, textures: 0 };

  // ---------- 불꽃 입자(가산 혼합 점) ----------
  const N_SPARK = low ? 240 : 600;
  const spPos = new Float32Array(N_SPARK * 3);
  const spCol = new Float32Array(N_SPARK * 3);
  const spVel = new Float32Array(N_SPARK * 3);
  const spBase = new Float32Array(N_SPARK * 3);
  const spLife = new Float32Array(N_SPARK);
  const spDur = new Float32Array(N_SPARK);
  const spGrav = new Float32Array(N_SPARK);
  const spDrag = new Float32Array(N_SPARK);
  let spHead = 0;
  let spAlive = 0;
  for (let i = 0; i < N_SPARK; i++) spPos[i * 3 + 1] = HIDE_Y;
  const spGeo = new THREE.BufferGeometry();
  spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  spGeo.setAttribute('color', new THREE.BufferAttribute(spCol, 3));
  const sparkPts = new THREE.Points(
    spGeo,
    new THREE.PointsMaterial({ map: dot, size: low ? 1.1 : 0.9, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  sparkPts.frustumCulled = false;
  sparkPts.renderOrder = 31;
  sparkPts.visible = false;
  root.add(sparkPts);

  // 입자 하나. 색은 _c 같은 THREE.Color로 넘긴다(값을 베껴 두므로 다시 써도 된다)
  function spark(x, y, z, vx, vy, vz, color, dur, grav, drag) {
    const i = spHead;
    spHead = (spHead + 1) % N_SPARK;
    if (!(spLife[i] > 0)) spAlive++; // 살아 있던 칸을 덮어쓰면 수는 그대로
    const o = i * 3;
    spPos[o] = x;
    spPos[o + 1] = y;
    spPos[o + 2] = z;
    spVel[o] = vx;
    spVel[o + 1] = vy;
    spVel[o + 2] = vz;
    spBase[o] = spCol[o] = color.r;
    spBase[o + 1] = spCol[o + 1] = color.g;
    spBase[o + 2] = spCol[o + 2] = color.b;
    spLife[i] = spDur[i] = dur;
    spGrav[i] = grav;
    spDrag[i] = drag;
    sparkPts.visible = true;
  }

  function updateSparks(dt) {
    for (let i = 0; i < N_SPARK; i++) {
      if (!(spLife[i] > 0)) continue;
      const o = i * 3;
      spLife[i] -= dt;
      if (!(spLife[i] > 0)) {
        spLife[i] = 0;
        spPos[o + 1] = HIDE_Y;
        spAlive--;
        continue;
      }
      const drag = Math.exp(-dt * spDrag[i]);
      spVel[o] *= drag;
      spVel[o + 1] = spVel[o + 1] * drag - spGrav[i] * dt;
      spVel[o + 2] *= drag;
      spPos[o] += spVel[o] * dt;
      spPos[o + 1] += spVel[o + 1] * dt;
      spPos[o + 2] += spVel[o + 2] * dt;
      const k = Math.min(1, (spLife[i] / spDur[i]) * 1.8); // 끝으로 갈수록 어두워진다
      spCol[o] = spBase[o] * k;
      spCol[o + 1] = spBase[o + 1] * k;
      spCol[o + 2] = spBase[o + 2] * k;
    }
    spGeo.attributes.position.needsUpdate = true;
    spGeo.attributes.color.needsUpdate = true;
    if (spAlive <= 0) {
      spAlive = 0;
      sparkPts.visible = false;
    }
  }

  // ---------- 연기(만화풍 뭉게 덩어리: 커졌다가 줄어들며 떠오른다) ----------
  const N_SMOKE = low ? 20 : 48;
  const smP = new Float32Array(N_SMOKE * 3);
  const smV = new Float32Array(N_SMOKE * 3);
  const smLife = new Float32Array(N_SMOKE);
  const smDur = new Float32Array(N_SMOKE);
  const smSize = new Float32Array(N_SMOKE);
  let smHead = 0;
  let smAlive = 0;
  const smokeMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), N_SMOKE);
  const smArr = smokeMesh.instanceMatrix.array;
  smArr.fill(0);
  for (let i = 0; i < N_SMOKE; i++) {
    smArr[i * 16 + 15] = 1;
    smokeMesh.setColorAt(i, _c.setHex(0xffffff));
  }
  smokeMesh.frustumCulled = false;
  smokeMesh.visible = false;
  root.add(smokeMesh);

  function puff(x, y, z, vx, vy, vz, size, dur, color) {
    const i = smHead;
    smHead = (smHead + 1) % N_SMOKE;
    if (!(smLife[i] > 0)) smAlive++;
    const o = i * 3;
    smP[o] = x;
    smP[o + 1] = y;
    smP[o + 2] = z;
    smV[o] = vx;
    smV[o + 1] = vy;
    smV[o + 2] = vz;
    smSize[i] = size;
    smLife[i] = smDur[i] = dur;
    smokeMesh.setColorAt(i, color);
    smokeMesh.instanceColor.needsUpdate = true;
    smokeMesh.visible = true;
  }

  function updateSmoke(dt) {
    const slow = Math.exp(-dt * 1.4);
    for (let i = 0; i < N_SMOKE; i++) {
      if (!(smLife[i] > 0)) continue;
      const o = i * 3;
      const m = i * 16;
      smLife[i] -= dt;
      let s = 0;
      if (smLife[i] > 0) {
        smV[o] *= slow;
        smV[o + 1] *= slow;
        smV[o + 2] *= slow;
        smP[o] += smV[o] * dt;
        smP[o + 1] += smV[o + 1] * dt;
        smP[o + 2] += smV[o + 2] * dt;
        const a = 1 - smLife[i] / smDur[i]; // 진행 0 → 1
        const k = a < 0.15 ? 1 - (1 - a / 0.15) * (1 - a / 0.15) : 1 - Math.pow((a - 0.15) / 0.85, 1.7);
        s = smSize[i] * Math.max(0, k);
      } else {
        smLife[i] = 0;
        smAlive--;
      }
      smArr[m] = smArr[m + 5] = smArr[m + 10] = s;
      smArr[m + 12] = smP[o];
      smArr[m + 13] = smP[o + 1];
      smArr[m + 14] = smP[o + 2];
    }
    smokeMesh.instanceMatrix.needsUpdate = true;
    if (smAlive <= 0) {
      smAlive = 0;
      smokeMesh.visible = false;
    }
  }

  // ---------- 잔해(인스턴스 큐브: 포물선으로 날아가 바닥에서 튄다) ----------
  const N_DEBRIS = low ? 120 : 360;
  const DEBRIS_G = 22;
  const dbP = new Float32Array(N_DEBRIS * 3);
  const dbV = new Float32Array(N_DEBRIS * 3);
  const dbR = new Float32Array(N_DEBRIS * 3); // 자세(오일러 각)
  const dbW = new Float32Array(N_DEBRIS * 3); // 도는 빠르기
  const dbS = new Float32Array(N_DEBRIS * 3); // 크기
  const dbLife = new Float32Array(N_DEBRIS);
  const dbBounce = new Uint8Array(N_DEBRIS);
  const dbRest = new Uint8Array(N_DEBRIS);
  const dbGround = new Array(N_DEBRIS).fill(flat);
  let dbHead = 0;
  let dbAlive = 0;
  const debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), N_DEBRIS);
  const dbArr = debrisMesh.instanceMatrix.array;
  dbArr.fill(0);
  for (let i = 0; i < N_DEBRIS; i++) {
    dbArr[i * 16 + 15] = 1;
    debrisMesh.setColorAt(i, _c.setHex(0xffffff));
  }
  debrisMesh.frustumCulled = false;
  debrisMesh.visible = false;
  root.add(debrisMesh);

  function updateDebris(dt) {
    for (let i = 0; i < N_DEBRIS; i++) {
      if (!(dbLife[i] > 0)) continue;
      const o = i * 3;
      dbLife[i] -= dt;
      if (!(dbLife[i] > 0)) {
        dbLife[i] = 0;
        dbAlive--;
        for (let q = i * 16; q < i * 16 + 11; q++) dbArr[q] = 0; // 회전·크기 부분을 모두 0으로: 숨긴다
        continue;
      }
      if (!dbRest[i]) {
        dbV[o + 1] -= DEBRIS_G * dt;
        dbP[o] += dbV[o] * dt;
        dbP[o + 1] += dbV[o + 1] * dt;
        dbP[o + 2] += dbV[o + 2] * dt;
        dbR[o] += dbW[o] * dt;
        dbR[o + 1] += dbW[o + 1] * dt;
        dbR[o + 2] += dbW[o + 2] * dt;
        let gy = dbGround[i](dbP[o], dbP[o + 2]);
        gy = Number.isFinite(gy) ? gy + dbS[o + 1] * 0.5 : -1e9;
        if (dbP[o + 1] <= gy) {
          dbP[o + 1] = gy;
          if (dbV[o + 1] < -3 && dbBounce[i] < 3) {
            // 튄다: 튈 때마다 힘이 빠진다
            dbBounce[i]++;
            dbV[o + 1] *= -0.36;
            dbV[o] *= 0.6;
            dbV[o + 2] *= 0.6;
            dbW[o] *= 0.6;
            dbW[o + 1] *= 0.6;
            dbW[o + 2] *= 0.6;
          } else {
            // 멈춘다: 바닥에 납작하게 눕힌다
            dbRest[i] = 1;
            dbR[o] = dbR[o + 2] = 0;
          }
        }
      }
      const k = dbLife[i] < 0.4 ? dbLife[i] / 0.4 : 1; // 사라지기 직전에 줄어든다
      _q.setFromEuler(_e.set(dbR[o], dbR[o + 1], dbR[o + 2]));
      _m.compose(_p.set(dbP[o], dbP[o + 1], dbP[o + 2]), _q, _s.set(dbS[o] * k, dbS[o + 1] * k, dbS[o + 2] * k));
      _m.toArray(dbArr, i * 16);
    }
    debrisMesh.instanceMatrix.needsUpdate = true;
    if (dbAlive <= 0) {
      dbAlive = 0;
      debrisMesh.visible = false;
    }
  }

  // ---------- 바닥 고리(충격파·경고 원) ----------
  const N_RING = low ? 10 : 16;
  const ringGeo = new THREE.RingGeometry(0.84, 1, low ? 28 : 44);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = [];
  let ringAlive = 0;
  for (let i = 0; i < N_RING; i++) {
    const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    mesh.visible = false;
    mesh.renderOrder = 4;
    root.add(mesh);
    rings.push({ mesh, t: 0, dur: 0, r0: 1, r1: 1, ease: false });
  }
  function spawnRing(x, y, z, color, r0, r1, dur, ease) {
    // 쉬는 것을 쓰고, 없으면 가장 곧 끝날 것을 덮어쓴다
    let pick = rings[0];
    for (const r of rings) {
      if (r.t <= 0) {
        pick = r;
        break;
      }
      if (r.t < pick.t) pick = r;
    }
    if (pick.t <= 0) ringAlive++;
    pick.t = pick.dur = dur;
    pick.r0 = r0;
    pick.r1 = r1;
    pick.ease = ease;
    pick.mesh.position.set(x, y, z);
    pick.mesh.scale.set(r0, 1, r0);
    pick.mesh.material.color.set(color);
    pick.mesh.material.opacity = 0;
    pick.mesh.visible = true;
  }
  function updateRings(dt) {
    for (const r of rings) {
      if (r.t <= 0) continue;
      r.t -= dt;
      if (r.t <= 0) {
        r.t = 0;
        r.mesh.visible = false;
        ringAlive--;
        continue;
      }
      const a = 1 - r.t / r.dur;
      const k = r.ease ? 1 - (1 - a) * (1 - a) : a;
      const rad = r.r0 + (r.r1 - r.r0) * k;
      r.mesh.scale.set(rad, 1, rad);
      r.mesh.material.opacity = 0.9 * Math.min(1, a * 10) * Math.min(1, (1 - a) / 0.35);
    }
    if (ringAlive < 0) ringAlive = 0;
  }

  // ---------- 섬광(빛 스프라이트 + 있으면 점 조명) ----------
  const N_FLASH = low ? 3 : 5;
  const flashes = [];
  let flashAlive = 0;
  for (let i = 0; i < N_FLASH; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xffe2a8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
    sprite.visible = false;
    sprite.renderOrder = 32;
    root.add(sprite);
    flashes.push({ sprite, t: 0, dur: 0, size: 1 });
  }
  const lightState = lights.map(() => ({ t: 0, dur: 0, peak: 0 }));
  let lightAlive = 0;
  function flash(x, y, z, size, dur, lightPeak) {
    let pick = flashes[0];
    for (const f of flashes) {
      if (f.t <= 0) {
        pick = f;
        break;
      }
      if (f.t < pick.t) pick = f;
    }
    if (pick.t <= 0) flashAlive++;
    pick.t = pick.dur = dur;
    pick.size = size;
    pick.sprite.position.set(x, y, z);
    pick.sprite.scale.set(size * 0.6, size * 0.6, 1);
    pick.sprite.material.opacity = 1;
    pick.sprite.visible = true;
    if (!lights.length || !(lightPeak > 0)) return;
    // 조명은 가장 곧 꺼질 것을 돌려 쓴다. 밝기만 바꾼다(visible은 건드리지 않는다)
    let li = 0;
    for (let i = 1; i < lights.length; i++) if (lightState[i].t < lightState[li].t) li = i;
    if (lightState[li].t <= 0) lightAlive++;
    lightState[li].t = lightState[li].dur = dur * 1.3;
    lightState[li].peak = lightPeak;
    lights[li].position.set(x, y + 1.5, z);
    lights[li].intensity = lightPeak;
  }
  function updateFlashes(dt) {
    if (flashAlive > 0) {
      for (const f of flashes) {
        if (f.t <= 0) continue;
        f.t -= dt;
        if (f.t <= 0) {
          f.t = 0;
          f.sprite.visible = false;
          flashAlive--;
          continue;
        }
        const k = f.t / f.dur; // 1 → 0
        const s = f.size * (1.25 - 0.65 * k);
        f.sprite.scale.set(s, s, 1);
        f.sprite.material.opacity = k * k;
      }
    }
    if (lightAlive > 0) {
      for (let i = 0; i < lights.length; i++) {
        const st = lightState[i];
        if (st.t <= 0) continue;
        st.t -= dt;
        if (st.t <= 0) {
          st.t = 0;
          lights[i].intensity = 0;
          lightAlive--;
          continue;
        }
        const k = st.t / st.dur;
        lights[i].intensity = st.peak * k * k;
      }
    }
  }

  // ---------- 만화 효과음 글자 ----------
  // 텍스처는 (색 + 글자)로 기억해 두고 돌려 쓴다. 쓰는 중이 아닌 오래된 것부터 버린다.
  const N_COMIC = low ? 6 : 10;
  const TEX_MAX = low ? 40 : 72;
  const COMIC_FONT = `bold ${low ? 64 : 96}px "Jua", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
  const COMIC_STROKE = low ? 12 : 18;
  const texCache = new Map(); // 키 → { tex, aspect, uses }
  const comics = [];
  let comicAlive = 0;
  for (let i = 0; i < N_COMIC; i++) {
    // map을 처음부터 넣어 두면 나중에 글자 텍스처로 바꿔 끼워도 셰이더를 다시 만들지 않는다
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false, toneMapped: false }));
    sprite.visible = false;
    sprite.renderOrder = 40;
    root.add(sprite);
    comics.push({ sprite, t: 0, dur: 0, size: 1, aspect: 1, entry: null });
  }
  const cssColor = (c) => (typeof c === 'number' ? '#' + (c & 0xffffff).toString(16).padStart(6, '0') : String(c));
  function comicTexture(text, color) {
    const key = color + '|' + text;
    let e = texCache.get(key);
    if (e) {
      // 방금 쓴 것을 맨 뒤로 보낸다(Map은 넣은 순서를 기억한다)
      texCache.delete(key);
      texCache.set(key, e);
      return e;
    }
    const tex = textTexture(text, { font: COMIC_FONT, color, stroke: '#1b2433', strokeWidth: COMIC_STROKE, pad: COMIC_STROKE });
    e = { tex, aspect: tex.userData.aspect || 1, uses: 0 };
    texCache.set(key, e);
    if (texCache.size > TEX_MAX) {
      for (const [k, old] of texCache) {
        if (old.uses > 0 || old === e) continue;
        old.tex.dispose();
        texCache.delete(k);
        break;
      }
    }
    return e;
  }
  function releaseComic(c) {
    c.t = 0;
    c.sprite.visible = false;
    if (c.entry) c.entry.uses--;
    c.entry = null;
  }
  function updateComics(dt) {
    for (const c of comics) {
      if (c.t <= 0) continue;
      c.t -= dt;
      if (c.t <= 0) {
        releaseComic(c);
        comicAlive--;
        continue;
      }
      const e = c.dur - c.t; // 지난 시간
      // 튀어나왔다가(살짝 넘치게) 제 크기로, 끝에서 흐려진다
      const u = Math.min(1, e / 0.14);
      const pop = u < 1 ? 1.28 * (1 - (1 - u) * (1 - u)) : 1 + 0.28 * Math.max(0, 1 - (e - 0.14) / 0.12);
      const s = c.size * pop;
      c.sprite.scale.set(s * c.aspect, s, 1);
      c.sprite.position.y += dt * 0.9;
      c.sprite.material.opacity = Math.min(1, c.t / (c.dur * 0.3));
    }
    if (comicAlive < 0) comicAlive = 0;
  }

  // ---------- 바깥에서 부르는 것 ----------
  const quietAt = [-Infinity, -Infinity]; // 남의 폭발을 그린 최근 두 번의 시각(engine.time)
  let quietI = 0;

  const gfx = {
    /**
     * 폭발: 불꽃 입자 + 연기 + 충격파 고리 + 섬광 + 흔들림·소리.
     * quiet(남의 폭발 재현)면 흔들림·소리를 빼고, 모두 합쳐 1초에 2번까지만 그린다. 그렸으면 true
     */
    explosion(x, y, z, o) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
      const radius = Math.max(0.5, Math.min(30, fin(o && o.radius, 5)));
      const big = !!(o && o.big);
      const quiet = !!(o && o.quiet);
      if (quiet) {
        const t = engine.time || 0;
        if (t - quietAt[quietI] < 1) return false;
        quietAt[quietI] = t;
        quietI ^= 1;
      }
      // 불꽃: 위쪽으로 더 많이 퍼진다. 폭죽(작은 폭발)에는 색색 불티를 섞는다
      const n = Math.round((big ? 64 : 40) * (low ? 0.45 : 1) * (quiet ? 0.6 : 1));
      for (let i = 0; i < n; i++) {
        const u = rand(-0.3, 1);
        const a = rand(0, TAU);
        const s = Math.sqrt(1 - u * u);
        const sp = radius * rand(1.3, 3.3);
        const roll = Math.random();
        if (!big && roll < 0.42) _c.setHSL(Math.random(), 1, 0.65);
        else if (roll < 0.6) _c.setRGB(1, 0.95, 0.72);
        else if (roll < 0.86) _c.setRGB(1, 0.66, 0.2);
        else _c.setRGB(1, 0.36, 0.12);
        spark(x + Math.cos(a) * s * radius * 0.1, y + u * radius * 0.1, z + Math.sin(a) * s * radius * 0.1, Math.cos(a) * s * sp, u * sp + radius * 0.4, Math.sin(a) * s * sp, _c, rand(0.35, 0.85), 10, 2.6);
      }
      // 연기: 대포는 짙은 회색, 폭죽은 옅은 파스텔
      const ns = low ? (big ? 4 : 2) : big ? 9 : 5;
      for (let i = 0; i < ns; i++) {
        const a = rand(0, TAU);
        const d = rand(0, radius * 0.3);
        if (big) _c.setHSL(0.08, 0.06, rand(0.26, 0.5));
        else _c.setHSL(Math.random(), 0.3, rand(0.8, 0.94));
        puff(x + Math.cos(a) * d, y + rand(0.2, radius * 0.3), z + Math.sin(a) * d, Math.cos(a) * rand(0.4, 2), rand(1.2, 3), Math.sin(a) * rand(0.4, 2), radius * rand(0.38, 0.62), rand(0.9, 1.6) * (big ? 1.25 : 1), _c);
      }
      spawnRing(x, y + 0.15, z, 0xffffff, radius * 0.25, radius * 1.1, 0.42, true);
      flash(x, y + radius * 0.15, z, radius * 1.8, big ? 0.28 : 0.2, quiet ? 0 : big ? 1200 : 500);
      if (!quiet) {
        const dist = camera ? camera.position.distanceTo(_p.set(x, y, z)) : 0;
        gfx.shake((big ? 1.3 : 0.75) * Math.max(0, 1 - dist / (radius * 9)));
        sfx.at('boom', Math.min(dist * 0.5, 50));
      }
      return true;
    },

    /**
     * 잔해: 큐브 count개가 흩어져 날아가 바닥에서 튄다.
     * colors 색 목록(hex) · power 튀어 나가는 세기(m/s) · spread 처음 흩어진 폭(m) · size 한 변(m)
     * ground(x, z) 바닥 높이 함수 — 생략하면 지금 구역의 지면
     */
    debris(x, y, z, o) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
      const want = Math.max(0, Math.min(N_DEBRIS, Math.round(fin(o && o.count, 40))));
      const n = low ? Math.ceil(want / 2) : want;
      const colors = o && Array.isArray(o.colors) && o.colors.length ? o.colors : null;
      const power = Math.max(0, Math.min(60, fin(o && o.power, 10)));
      const spread = Math.max(0, Math.min(60, fin(o && o.spread, 3)));
      const size = Math.max(0.05, Math.min(6, fin(o && o.size, 0.6)));
      let ground = o && typeof o.ground === 'function' ? o.ground : null;
      if (!ground && currentGround) ground = currentGround();
      if (typeof ground !== 'function') ground = flat;
      for (let k = 0; k < n; k++) {
        const i = dbHead;
        dbHead = (dbHead + 1) % N_DEBRIS;
        if (!(dbLife[i] > 0)) dbAlive++;
        const j = i * 3;
        const a = rand(0, TAU);
        const d = Math.sqrt(Math.random()) * spread;
        dbP[j] = x + Math.cos(a) * d;
        dbP[j + 1] = y + rand(0, spread * 0.6);
        dbP[j + 2] = z + Math.sin(a) * d;
        const out = power * rand(0.25, 0.9);
        dbV[j] = Math.cos(a) * out;
        dbV[j + 1] = power * rand(0.45, 1.15);
        dbV[j + 2] = Math.sin(a) * out;
        dbR[j] = rand(0, TAU);
        dbR[j + 1] = rand(0, TAU);
        dbR[j + 2] = rand(0, TAU);
        dbW[j] = rand(-9, 9);
        dbW[j + 1] = rand(-9, 9);
        dbW[j + 2] = rand(-9, 9);
        dbS[j] = size * rand(0.5, 1.35);
        dbS[j + 1] = size * rand(0.4, 1.0);
        dbS[j + 2] = size * rand(0.5, 1.35);
        dbLife[i] = rand(2.4, 3.6);
        dbBounce[i] = 0;
        dbRest[i] = 0;
        dbGround[i] = ground;
        _c.set(colors ? colors[Math.floor(Math.random() * colors.length)] : 0x999999).multiplyScalar(rand(0.78, 1.08));
        debrisMesh.setColorAt(i, _c);
      }
      if (n > 0) {
        debrisMesh.instanceColor.needsUpdate = true;
        debrisMesh.visible = true;
      }
    },

    /** 만화 효과음 글자("퍽!", "쾅!"): 굵은 외곽선 글자가 튀어나왔다가 떠오르며 사라진다. size는 글자 높이(m) */
    comic(text, x, y, z, o) {
      const str = text == null ? '' : String(text).slice(0, 40);
      if (!str || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
      const size = Math.max(0.2, Math.min(12, fin(o && o.size, 2.2)));
      const dur = Math.max(0.2, Math.min(6, fin(o && o.dur, 1.0)));
      const entry = comicTexture(str, cssColor(o && o.color != null ? o.color : '#ffd23f'));
      let pick = comics[0];
      for (const c of comics) {
        if (c.t <= 0) {
          pick = c;
          break;
        }
        if (c.t < pick.t) pick = c;
      }
      if (pick.t > 0) releaseComic(pick);
      else comicAlive++;
      pick.t = pick.dur = dur;
      pick.size = size;
      pick.aspect = entry.aspect;
      pick.entry = entry;
      entry.uses++;
      const mat = pick.sprite.material;
      mat.map = entry.tex;
      mat.opacity = 1;
      mat.rotation = rand(-0.16, 0.16);
      pick.sprite.position.set(x, y, z);
      pick.sprite.scale.set(0.001, 0.001, 1);
      pick.sprite.visible = true;
    },

    /** 불티 한 줌(탄 꼬리·불똥 등에 쓰는 기본 입자). up은 위로 뜨는 속도, gravity는 떨어지는 가속 */
    sparks(x, y, z, o) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
      const want = Math.max(0, Math.min(80, Math.round(fin(o && o.n, 8))));
      const n = low ? Math.ceil(want / 2) : want;
      const speed = fin(o && o.speed, 3);
      const dur = Math.max(0.05, Math.min(4, fin(o && o.dur, 0.5)));
      const grav = fin(o && o.gravity, 6);
      const up = fin(o && o.up, 0);
      _c.set(o && o.color != null ? o.color : 0xffc040);
      for (let i = 0; i < n; i++) {
        const u = rand(-1, 1);
        const a = rand(0, TAU);
        const s = Math.sqrt(1 - u * u);
        const sp = speed * rand(0.4, 1);
        spark(x, y, z, Math.cos(a) * s * sp, u * sp + up, Math.sin(a) * s * sp, _c, dur * rand(0.6, 1), grav, 2);
      }
    },

    /** 물보라(물총이 맞은 자리) */
    splash(x, y, z, n = 10) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
      const want = Math.max(0, Math.min(60, Math.round(fin(n, 10))));
      const m = low ? Math.ceil(want / 2) : want;
      for (let i = 0; i < m; i++) {
        const a = rand(0, TAU);
        const sp = rand(0.6, 2.6);
        if (i % 3) _c.setRGB(0.5, 0.82, 1);
        else _c.setRGB(0.86, 0.96, 1);
        spark(x, y, z, Math.cos(a) * sp, rand(1.5, 4.6), Math.sin(a) * sp, _c, rand(0.28, 0.55), 15, 1.2);
      }
    },

    /** 연기 뭉치. n 덩어리 수 · size 덩어리 지름(m) · dur 사라지기까지(초) · color 색(hex, 생략하면 옅은 회색) */
    smoke(x, y, z, o) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
      const want = Math.max(0, Math.min(N_SMOKE, Math.round(fin(o && o.n, 6))));
      const n = low ? Math.ceil(want / 2) : want;
      const size = Math.max(0.1, Math.min(20, fin(o && o.size, 3)));
      const dur = Math.max(0.2, Math.min(8, fin(o && o.dur, 1.6)));
      const tint = o && o.color != null ? o.color : null;
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU);
        const d = rand(0, size * 0.35);
        if (tint != null) _c.set(tint).multiplyScalar(rand(0.85, 1.1));
        else _c.setHSL(0.6, 0.04, rand(0.6, 0.86));
        puff(x + Math.cos(a) * d, y + rand(0, size * 0.3), z + Math.sin(a) * d, Math.cos(a) * rand(0.2, 1), rand(0.8, 1.9), Math.sin(a) * rand(0.2, 1), size * rand(0.6, 1), dur * rand(0.75, 1.1), _c);
      }
    },

    /** 바닥에 눕는 고리: 반지름 r0에서 r1까지 dur초 동안 고르게 변한다(경고 원·충격파). y는 바닥 높이 */
    ring(x, y, z, o) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
      const r0 = Math.max(0.05, Math.min(200, fin(o && o.r0, 0.5)));
      const r1 = Math.max(0.05, Math.min(200, fin(o && o.r1, 4)));
      const dur = Math.max(0.05, Math.min(20, fin(o && o.dur, 1)));
      spawnRing(x, y + 0.12, z, o && o.color != null ? o.color : 0xff4040, r0, r1, dur, false);
    },

    /** 화면 흔들림(세기 0~1.5쯤). 이미 더 세게 흔들리고 있으면 그대로 둔다 */
    shake(power) {
      if (!cam || !(power > 0)) return;
      cam.shake = Math.min(1.5, Math.max(cam.shake || 0, power));
    },

    /** 시험·점검용: 지금 살아 있는 효과 수 */
    stats() {
      counts.sparks = spAlive;
      counts.smoke = smAlive;
      counts.debris = dbAlive;
      counts.rings = ringAlive;
      counts.flashes = flashAlive;
      counts.comics = comicAlive;
      counts.lights = lightAlive;
      counts.textures = texCache.size;
      return counts;
    },

    update(dt) {
      if (!(dt > 0)) return;
      if (spAlive > 0) updateSparks(dt);
      if (smAlive > 0) updateSmoke(dt);
      if (dbAlive > 0) updateDebris(dt);
      if (ringAlive > 0) updateRings(dt);
      if (flashAlive > 0 || lightAlive > 0) updateFlashes(dt);
      if (comicAlive > 0) updateComics(dt);
    },
  };
  return gfx;
}
