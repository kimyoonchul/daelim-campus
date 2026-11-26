// 캠퍼스 소품: 나무·가로등·계단·무빙워크·주차 차량·안내판·정문 표지석·마스코트 등.
import * as THREE from 'three';
import data from '../../data/campus-data.js';
import { heightAt, slopeAt, grid } from './heightfield.js';
import { occAt, zoneAt, OCC } from './occupancy.js';
import { Geo, resample, inPoly, bboxOf, centroid, distSeg } from './geom.js';
import { makeRng } from '../core/rng.js';
import { SPAWN } from '../config.js';
import { textPlane, patternTexture } from './textures.js';

const { X0, Z0, X1, Z1 } = grid;

function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,240,190,1)');
  gr.addColorStop(0.35, 'rgba(255,220,140,0.45)');
  gr.addColorStop(1, 'rgba(255,200,100,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildProps(engine, world) {
  const group = new THREE.Group();
  group.name = 'props';
  const campus = world.campus;
  const collider = campus.collider;
  const low = engine.quality.low;
  const lamb = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const add = (geo, material, shadow = true) => {
    const m = new THREE.Mesh(geo.build ? geo.build() : geo, material);
    m.castShadow = shadow;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const doors = world.doors;
  const nearDoor = (x, z, d) => doors.some((o) => Math.hypot(o.x - x, o.z - z) < d);
  const updaters = [];
  const anchors = {};

  // ---------- 나무·덤불 ----------
  // 배치는 칸 크기(품질)에 따라 달라진다. 길가 주차 차량은 모든 기기에서 같은 자리에 서야 해서
  // 두 품질의 배치를 모두 구해 두고(plantSets), 이 기기에는 제 품질 것만 심는다.
  const scatterPlants = (CELL) => {
    const rnd = makeRng(777);
    const trees = [];
    const bushes = [];
    for (let z = Z0 + 5; z < Z1 - 5; z += CELL) {
      for (let x = X0 + 5; x < X1 - 5; x += CELL) {
        const jx = x + rnd.range(-3, 3);
        const jz = z + rnd.range(-3, 3);
        const o = occAt(jx, jz);
        const zone = zoneAt(jx, jz);
        const roll = rnd();
        const roll2 = rnd();
        let p = 0;
        if (o === OCC.WOOD) p = zone === 1 ? 0.75 : 0.92;
        else if (o === OCC.GRASS) p = zone === 0 ? 0.14 : zone === 1 ? 0.13 : 0.22;
        if (zone > 0) {
          if (slopeAt(jx, jz).mag > 1.0) p *= 0.25;
          if (nearDoor(jx, jz, 9)) p = 0;
          if (Math.hypot(jx - SPAWN.x, jz - SPAWN.z) < 16) p = 0; // 정문 앞은 시야를 비워 둔다
        }
        if (roll < p) {
          trees.push({ x: jx, z: jz, s: rnd.range(0.8, 1.45), pine: rnd() < (zone === 1 ? 0.25 : 0.42), pink: zone === 1 && o !== OCC.WOOD && rnd() < 0.3, r: rnd() * 6.28, v: rnd(), zone });
        } else if (zone === 1 && o === OCC.GRASS && roll2 < 0.1 && !nearDoor(jx, jz, 6)) {
          bushes.push({ x: jx + 1.5, z: jz - 1.2, s: rnd.range(0.7, 1.3), v: rnd() });
        }
      }
    }
    return { trees, bushes };
  };
  const plantSets = [scatterPlants(7), scatterPlants(9.5)]; // [보통, 저사양]
  {
    const { trees, bushes } = plantSets[low ? 1 : 0];
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 2.6, 6);
    trunkGeo.translate(0, 1.3, 0);
    const roundGeo = new THREE.IcosahedronGeometry(1.75, 0);
    roundGeo.translate(0, 3.7, 0);
    const pineGeo = new THREE.ConeGeometry(1.5, 4.6, 7);
    pineGeo.translate(0, 4.3, 0);
    const nPine = trees.filter((t) => t.pine).length;
    const trunks = new THREE.InstancedMesh(trunkGeo, lamb(0x6b4b34), trees.length);
    const rounds = new THREE.InstancedMesh(roundGeo, lamb(0xffffff), trees.length - nPine);
    const pines = new THREE.InstancedMesh(pineGeo, lamb(0xffffff), nPine);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    let ir = 0;
    let ip = 0;
    trees.forEach((t, i) => {
      const y = heightAt(t.x, t.z) - 0.15;
      q.setFromAxisAngle(up, t.r);
      m4.compose(new THREE.Vector3(t.x, y, t.z), q, new THREE.Vector3(t.s, t.s * (0.9 + t.v * 0.3), t.s));
      trunks.setMatrixAt(i, m4);
      if (t.pine) {
        pines.setMatrixAt(ip, m4);
        pines.setColorAt(ip++, col.setHSL(0.36 + t.v * 0.05, 0.42, 0.2 + t.v * 0.08));
      } else {
        rounds.setMatrixAt(ir, m4);
        if (t.pink) col.setHSL(0.94 + t.v * 0.03, 0.75, 0.82 + t.v * 0.06);
        else col.setHSL(0.27 + t.v * 0.08, 0.5, 0.3 + t.v * 0.12);
        rounds.setColorAt(ir++, col);
      }
      if (t.zone > 0) collider.addCircle(t.x, t.z, 0.32 * t.s);
    });
    for (const m of [trunks, rounds, pines]) {
      m.castShadow = !low;
      m.receiveShadow = false;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      group.add(m);
    }
    // 둥글게 다듬은 덤불(잔디밭 정원수)
    const bushGeo = new THREE.IcosahedronGeometry(0.95, 1);
    const bm = new THREE.InstancedMesh(bushGeo, lamb(0xffffff), bushes.length);
    bushes.forEach((b, i) => {
      m4.compose(new THREE.Vector3(b.x, heightAt(b.x, b.z) + 0.45 * b.s, b.z), q.identity(), new THREE.Vector3(b.s, b.s * 0.85, b.s));
      bm.setMatrixAt(i, m4);
      bm.setColorAt(i, col.setHSL(0.3 + b.v * 0.05, 0.55, 0.26 + b.v * 0.1));
      collider.addCircle(b.x, b.z, 0.7 * b.s);
    });
    bm.castShadow = !low;
    bm.computeBoundingSphere();
    group.add(bm);
    anchors.treeCount = trees.length;
  }

  // ---------- 가로등 ----------
  {
    const pts = [];
    for (const r of data.roads) {
      if (!r.inCampus || r.kind !== 'service') continue;
      const rs = resample(r.pts, 27);
      for (let i = 1; i < rs.length - 1; i++) {
        const a = rs[i - 1];
        const b = rs[i + 1];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const side = i % 2 ? 1 : -1;
        const x = rs[i][0] + ((-(b[1] - a[1]) / l) * (r.w / 2 + 1.1)) * side;
        const z = rs[i][1] + (((b[0] - a[0]) / l) * (r.w / 2 + 1.1)) * side;
        const o = occAt(x, z);
        if (o === OCC.BUILDING || o === OCC.ROAD) continue;
        if (pts.some((p) => Math.hypot(p[0] - x, p[1] - z) < 14)) continue;
        pts.push([x, z]);
      }
    }
    const pole = new Geo();
    const bulb = new Geo();
    const glowPos = [];
    for (const [x, z] of pts) {
      const y = heightAt(x, z);
      pole.box(x, y + 2.4, z, 0.14, 4.8, 0.14);
      pole.box(x, y + 4.85, z, 0.9, 0.12, 0.9);
      bulb.box(x, y + 4.72, z, 0.6, 0.16, 0.6);
      glowPos.push(x, y + 4.6, z);
      collider.addCircle(x, z, 0.2);
    }
    add(pole, lamb(0x3d4650));
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0x8a8a80 });
    add(bulb, bulbMat, false);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
    const glow = new THREE.Points(gg, new THREE.PointsMaterial({ map: glowTexture(), size: 9, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    glow.frustumCulled = false;
    group.add(glow);
    engine.onNight((night) => {
      bulbMat.color.setHex(night > 0.3 ? 0xfff0b8 : 0x8a8a80);
      glow.material.opacity = night * 0.95;
      glow.visible = night > 0.05;
    });
    anchors.lamps = pts;
  }

  // ---------- 계단 ----------
  {
    const g = new Geo();
    for (const r of data.roads) {
      if (r.kind !== 'steps' || r.conveying || r.bridge) continue;
      const rs = resample(r.pts, 0.4);
      for (let i = 0; i < rs.length - 1; i++) {
        const a = rs[i];
        const b = rs[i + 1];
        const ha = heightAt(a[0], a[1]);
        const hb = heightAt(b[0], b[1]);
        const top = Math.max(ha, hb) + 0.02;
        const bot = Math.min(ha, hb) - 0.3;
        g.color(i % 2 ? 0xd6d1c6 : 0xc2bdb1);
        g.box((a[0] + b[0]) / 2, (top + bot) / 2, (a[1] + b[1]) / 2, r.w - 0.2, top - bot, 0.42, Math.atan2(b[0] - a[0], b[1] - a[1]));
      }
    }
    add(g, new THREE.MeshLambertMaterial({ vertexColors: true }), false);
  }

  // ---------- 무빙워크·에스컬레이터 (유리 지붕) ----------
  {
    const belt = new Geo();
    const frame = new Geo();
    const glass = new Geo();
    const beltTex = patternTexture('belt', '#3b4046', '#565c64');
    for (const r of data.roads) {
      if (!r.conveying) continue;
      const rs = resample(r.pts, 1.5);
      const h0 = heightAt(rs[0][0], rs[0][1]);
      const h1 = heightAt(rs[rs.length - 1][0], rs[rs.length - 1][1]);
      const sign = h1 >= h0 ? 1 : -1; // 오르막 방향으로 실어 나른다
      const half = 0.8;
      const segs = [];
      for (let i = 0; i < rs.length - 1; i++) {
        const a = rs[i];
        const b = rs[i + 1];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const tx = (b[0] - a[0]) / l;
        const tz = (b[1] - a[1]) / l;
        const nx = -tz;
        const nz = tx;
        const ya = heightAt(a[0], a[1]) + 0.1;
        const yb = heightAt(b[0], b[1]) + 0.1;
        belt.quad([a[0] + nx * half, ya, a[1] + nz * half], [b[0] + nx * half, yb, b[1] + nz * half], [b[0] - nx * half, yb, b[1] - nz * half], [a[0] - nx * half, ya, a[1] - nz * half], [0, a[2] / 1.2, 0, b[2] / 1.2, 1, b[2] / 1.2, 1, a[2] / 1.2]);
        // 난간 유리 + 손잡이
        for (const s of [-1, 1]) {
          const ox = nx * (half + 0.08) * s;
          const oz = nz * (half + 0.08) * s;
          glass.quad([a[0] + ox, ya, a[1] + oz], [b[0] + ox, yb, b[1] + oz], [b[0] + ox, yb + 1.0, b[1] + oz], [a[0] + ox, ya + 1.0, a[1] + oz]);
          frame.box((a[0] + b[0]) / 2 + ox, (ya + yb) / 2 + 1.03, (a[1] + b[1]) / 2 + oz, 0.1, 0.08, l + 0.05, Math.atan2(tx, tz));
        }
        // 3칸마다 기둥과 지붕
        if (i % 3 === 0) {
          const rot = Math.atan2(tx, tz);
          for (const s of [-1, 1]) frame.box(a[0] + nx * (half + 0.35) * s, ya + 1.45, a[1] + nz * (half + 0.35) * s, 0.12, 2.9, 0.12, rot);
          frame.box(a[0], ya + 2.95, a[1], 2.6, 0.12, 0.14, rot);
        }
        glass.box((a[0] + b[0]) / 2, (ya + yb) / 2 + 3.05, (a[1] + b[1]) / 2, 2.7, 0.06, l + 0.05, Math.atan2(tx, tz));
        segs.push([a[0], a[1], b[0], b[1], tx * sign, tz * sign]);
      }
      const bb = bboxOf(r.pts);
      campus.conveyors.push({
        bb: [bb[0] - 2, bb[1] - 2, bb[2] + 2, bb[3] + 2],
        at(x, z) {
          for (const s of segs) if (distSeg(x, z, s[0], s[1], s[2], s[3]) < half + 0.15) return { dx: s[4], dz: s[5], speed: 2.7 };
          return null;
        },
      });
    }
    const bm = add(belt, new THREE.MeshLambertMaterial({ map: beltTex }), false);
    add(frame, lamb(0x59626b));
    const gm = add(glass, new THREE.MeshLambertMaterial({ color: 0x9fd8ee, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }), false);
    gm.renderOrder = 2;
    updaters.push((dt) => {
      bm.material.map.offset.y -= dt * 2.2;
    });
  }

  // ---------- 주차된 차 ----------
  // 차량 번호(parked의 순서)는 통신에 쓰인다 → 모든 기기에서 같은 순서·같은 개수여야 한다.
  // 주차장 차량이 앞 번호이고, 길가 주차 차량은 안내판·깃발 등이 다 놓인 뒤 맨 끝에서 덧붙인다.
  // 기록: { i, x, y(지면 높이), z, rot(앞 방향이 (sin rot, cos rot)), color, col: [뒤·앞 충돌 원 번호], visible }
  const parked = [];
  const CAR_PAL = [0xf2f2f2, 0xd9dcde, 0x2b2f36, 0x8d949c, 0x1f4e8c, 0xa62b2b, 0x3c6e57, 0xe9e2d0, 0x565e68];
  const LOT_MAX = 150;
  const ROADSIDE_MAX = 16;
  let carBody = null;
  let carCab = null;
  {
    const rnd = makeRng(4242);
    const cars = [];
    for (const a of data.areas) {
      if (a.kind !== 'parking' || !a.inCampus) continue;
      let best = 0;
      let ang = 0;
      for (let i = 0; i < a.poly.length; i++) {
        const p = a.poly[i];
        const q = a.poly[(i + 1) % a.poly.length];
        const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (l > best) {
          best = l;
          ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
        }
      }
      const bb = bboxOf(a.poly);
      const cxm = (bb[0] + bb[2]) / 2;
      const czm = (bb[1] + bb[3]) / 2;
      const R = Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) / 2 + 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      // 바닥 텍스처의 주차선·통로 배치와 같은 규칙
      for (let u0 = -R + 5; u0 <= R; u0 += 16.5) {
        for (const u of [u0 - 2.7, u0 + 8.7]) {
          for (let v = -R + 1.3; v <= R; v += 2.6) {
            if (rnd() > 0.42) continue;
            const x = cxm + v * ca - u * sa;
            const z = czm + v * sa + u * ca;
            if (!inPoly(x, z, a.poly) || occAt(x, z) !== OCC.PARKING) continue;
            if (!inPoly(x - sa * 2, z + ca * 2, a.poly) || !inPoly(x + sa * 2, z - ca * 2, a.poly)) continue;
            if (slopeAt(x, z).mag > 0.25) continue;
            cars.push({ x, z, rot: Math.atan2(-sa, ca) + (u < u0 ? 0 : Math.PI), c: rnd(), k: rnd() });
          }
        }
      }
    }
    const list = cars.slice(0, LOT_MAX); // 품질과 무관하게 같은 개수
    const bodyGeo = new Geo().box(0, 0.62, 0, 1.8, 0.62, 4.3).box(0, 0.25, 1.45, 1.85, 0.3, 0.5).box(0, 0.25, -1.45, 1.85, 0.3, 0.5).build();
    const cabGeo = new Geo().box(0, 1.2, -0.15, 1.6, 0.58, 2.3).build();
    // 길가 주차 차량 몫까지 자리를 잡아 두고, 실제 대수(count)는 길가 차량을 놓은 뒤에 정한다
    const body = new THREE.InstancedMesh(bodyGeo, lamb(0xffffff), list.length + ROADSIDE_MAX);
    const cab = new THREE.InstancedMesh(cabGeo, lamb(0x1f2a36), list.length + ROADSIDE_MAX);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    list.forEach((c, i) => {
      const y = heightAt(c.x, c.z);
      const color = CAR_PAL[Math.floor(c.c * CAR_PAL.length)];
      q.setFromAxisAngle(up, c.rot);
      m4.compose(new THREE.Vector3(c.x, y + 0.02, c.z), q, new THREE.Vector3(1, 1, 1));
      body.setMatrixAt(i, m4);
      cab.setMatrixAt(i, m4);
      body.setColorAt(i, col.setHex(color));
      const c0 = collider.addCircle(c.x - Math.sin(c.rot) * 1.0, c.z - Math.cos(c.rot) * 1.0, 1.05);
      const c1 = collider.addCircle(c.x + Math.sin(c.rot) * 1.0, c.z + Math.cos(c.rot) * 1.0, 1.05);
      parked.push({ i, x: c.x, y, z: c.z, rot: c.rot, color, col: [c0, c1], visible: true });
    });
    for (const m of [body, cab]) {
      m.castShadow = !low;
      group.add(m);
    }
    carBody = body;
    carCab = cab;
  }

  // ---------- 건물 안내판(스탬프 찍는 곳) ----------
  const signs = [];
  {
    const post = new Geo();
    const ringGeo = new THREE.RingGeometry(1.15, 1.55, 28);
    ringGeo.rotateX(-Math.PI / 2);
    for (const d of doors) {
      // 문 오른쪽 옆, 벽에서 조금 떨어진 곳
      const px = -d.nz;
      const pz = d.nx;
      let x = d.x + px * 4.6 + d.nx * 1.4;
      let z = d.z + pz * 4.6 + d.nz * 1.4;
      if (collider.solidAt(x, z)) {
        x = d.x - px * 4.6 + d.nx * 1.4;
        z = d.z - pz * 4.6 + d.nz * 1.4;
      }
      const y = Math.max(d.y, heightAt(x, z));
      const rot = Math.atan2(d.nx, d.nz);
      post.color(0x2d3a4b).box(x, y + 1.0, z, 0.16, 2.0, 0.16, rot);
      post.color(0x0f1c2e).box(x, y + 2.25, z, 1.9, 1.15, 0.12, rot);
      post.color(0x009fe3).box(x, y + 2.86, z, 1.9, 0.1, 0.14, rot);
      const label = textPlane(`${d.letter}\n${d.name}`, 1.5, { color: '#ffffff', font: 'bold 60px "Jua", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif', pad: 10 });
      label.position.set(x + d.nx * 0.08, y + 2.25, z + d.nz * 0.08);
      label.rotation.y = rot;
      const sc = Math.min(1, 1.0 / label.userData.h);
      label.scale.setScalar(sc);
      group.add(label);
      const back = label.clone();
      back.position.set(x - d.nx * 0.08, y + 2.25, z - d.nz * 0.08);
      back.rotation.y = rot + Math.PI;
      group.add(back);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthWrite: false }));
      const rx = x + d.nx * 1.9;
      const rz = z + d.nz * 1.9;
      ring.position.set(rx, Math.max(d.y, heightAt(rx, rz)) + 0.09, rz);
      ring.renderOrder = 3;
      group.add(ring);
      collider.addCircle(x, z, 0.3);
      signs.push({ key: d.key, name: d.name, letter: d.letter, x: rx, y: ring.position.y, z: rz, ring, door: d });
    }
    add(post, new THREE.MeshLambertMaterial({ vertexColors: true }));
    updaters.push((dt, t) => {
      for (const s of signs) {
        const k = 1 + Math.sin(t * 3 + s.x) * 0.07;
        s.ring.scale.set(k, 1, k);
      }
    });
  }

  // ---------- 정문 표지석 · 마스코트 · 타임어택 깃발 ----------
  const place = (x, z) => ({ x, z, y: heightAt(x, z) });
  {
    const p = place(6.5, 149.5);
    const rot = -0.75;
    const stone = new Geo();
    stone.color(0x5d6670).box(p.x, p.y + 0.35, p.z, 8.6, 0.7, 1.5, rot);
    stone.color(0x39424d).box(p.x, p.y + 1.75, p.z, 8.0, 2.1, 0.8, rot);
    add(stone, new THREE.MeshLambertMaterial({ vertexColors: true }));
    for (const s of [1, -1]) {
      const t1 = textPlane('대림대학교', 6.2, { color: '#ffffff', font: 'bold 110px "Jua", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif', pad: 6, oneSided: true });
      t1.position.set(p.x + Math.sin(rot) * 0.42 * s, p.y + 1.95, p.z + Math.cos(rot) * 0.42 * s);
      t1.rotation.y = rot + (s < 0 ? Math.PI : 0);
      group.add(t1);
      const t2 = textPlane('비공식 동문 프로젝트 · 안양 캠퍼스', 4.6, { color: '#9fd8ff', font: 'bold 44px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif', pad: 4, oneSided: true });
      t2.position.set(p.x + Math.sin(rot) * 0.42 * s, p.y + 1.02, p.z + Math.cos(rot) * 0.42 * s);
      t2.rotation.y = t1.rotation.y;
      group.add(t2);
    }
    collider.addCircle(p.x - 2.6, p.z - 2.4, 1.3);
    collider.addCircle(p.x, p.z, 1.3);
    collider.addCircle(p.x + 2.6, p.z + 2.4, 1.3);
  }
  {
    // 안내 곰: 학교 상징 동물이 곰이라서, 정문에서 길을 알려 주는 곰을 세웠다
    const p = place(1.2, 156.5);
    const bear = new THREE.Group();
    const brown = lamb(0x9a6a3f);
    const cream = lamb(0xf1dfc0);
    const dark = lamb(0x2b1d14);
    const sph = (r, mat, x, y, z, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      bear.add(m);
      return m;
    };
    sph(0.62, brown, 0, 0.75, 0, 1, 1.12, 0.92);
    sph(0.4, cream, 0, 0.72, 0.33, 1, 1.1, 0.6);
    const head = sph(0.5, brown, 0, 1.75, 0.05);
    sph(0.17, brown, -0.36, 2.16, 0);
    sph(0.17, brown, 0.36, 2.16, 0);
    sph(0.2, cream, 0, 1.64, 0.42, 1.1, 0.8, 0.8);
    sph(0.07, dark, 0, 1.7, 0.6);
    sph(0.055, dark, -0.18, 1.86, 0.44);
    sph(0.055, dark, 0.18, 1.86, 0.44);
    const armL = sph(0.2, brown, -0.62, 1.05, 0.1, 0.8, 1.5, 0.8);
    const armR = sph(0.2, brown, 0.66, 1.45, 0.1, 0.8, 1.5, 0.8);
    armR.rotation.z = -2.4;
    sph(0.25, brown, -0.3, 0.2, 0.15, 1, 0.8, 1.3);
    sph(0.25, brown, 0.3, 0.2, 0.15, 1, 0.8, 1.3);
    // 파란 목도리(학교 색)
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.11, 8, 18), lamb(0x009fe3));
    scarf.rotation.x = Math.PI / 2;
    scarf.position.set(0, 1.33, 0.03);
    bear.add(scarf);
    bear.position.set(p.x, p.y, p.z);
    bear.rotation.y = -2.2;
    bear.scale.setScalar(1.25);
    group.add(bear);
    collider.addCircle(p.x, p.z, 0.9);
    updaters.push((dt, t) => {
      armR.rotation.z = -2.4 + Math.sin(t * 5) * 0.35;
      head.rotation.z = Math.sin(t * 1.6) * 0.08;
      void armL;
    });
    anchors.bear = { x: p.x, y: p.y, z: p.z };
  }
  const flag = (x, z, text, color, rot) => {
    const p = place(x, z);
    const g = new Geo();
    g.color(0xe8e8e8).box(p.x, p.y + 2.6, p.z, 0.14, 5.2, 0.14);
    g.color(color).box(p.x + Math.cos(rot) * 1.25, p.y + 4.45, p.z - Math.sin(rot) * 1.25, 2.4, 1.3, 0.06, rot);
    add(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    for (const s of [1, -1]) {
      const t = textPlane(text, 2.1, { color: '#ffffff', font: 'bold 64px "Jua", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif', pad: 6, oneSided: true });
      t.position.set(p.x + Math.cos(rot) * 1.25 + Math.sin(rot) * 0.05 * s, p.y + 4.45, p.z - Math.sin(rot) * 1.25 + Math.cos(rot) * 0.05 * s);
      t.rotation.y = rot + (s < 0 ? Math.PI : 0);
      const k = Math.min(1, 1.1 / t.userData.h);
      t.scale.setScalar(k);
      group.add(t);
    }
    collider.addCircle(p.x, p.z, 0.25);
    return p;
  };
  anchors.climbStart = flag(-8.2, 150.5, '등굣길\nSTART', 0xe5484d, 0.4);
  {
    const su = doors.find((d) => d.key === 'suam');
    if (su) {
      const fx = su.x + su.nx * 5 - su.nz * 5;
      const fz = su.z + su.nz * 5 + su.nx * 5;
      anchors.climbFinish = flag(fx, fz, '도착\nFINISH', 0x2fbf71, Math.atan2(su.nx, su.nz));
      anchors.climbGoal = { x: su.x + su.nx * 3, z: su.z + su.nz * 3, y: su.y };
    }
  }

  // ---------- 자동차관 앞 전시 차량 ----------
  {
    const d = doors.find((o) => o.key === 'auto');
    if (d) {
      const x = d.x + d.nx * 9 + d.nz * 6;
      const z = d.z + d.nz * 9 - d.nx * 6;
      const y = heightAt(x, z);
      const g = new Geo();
      g.color(0x8a9199).box(x, y + 1.6, z, 0.35, 3.2, 0.35);
      const rot = Math.atan2(d.nx, d.nz) + 1.2;
      g.color(0xd42a2a).box(x, y + 3.55, z, 1.8, 0.6, 4.2, rot);
      g.color(0x1b2330).box(x - Math.sin(rot) * 0.2, y + 4.05, z - Math.cos(rot) * 0.2, 1.55, 0.5, 2.0, rot);
      const m = add(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.rotation.z = 0;
      collider.addCircle(x, z, 0.45);
    }
  }

  // ---------- 전산관 앞 광장: 벤치·현수막·자판기 ----------
  {
    const sq = data.areas.find((a) => a.kind === 'square');
    const js = doors.find((d) => d.key === 'jeonsan');
    if (sq && js) {
      const c = centroid(sq.poly);
      const y = sq.pad != null ? sq.pad : heightAt(c[0], c[1]);
      const g = new Geo();
      const rnd = makeRng(31);
      let placed = 0;
      for (let t = 0; t < 80 && placed < 5; t++) {
        const bb = bboxOf(sq.poly);
        const x = rnd.range(bb[0] + 2, bb[2] - 2);
        const z = rnd.range(bb[1] + 2, bb[3] - 2);
        if (!inPoly(x, z, sq.poly) || Math.hypot(x - js.x, z - js.z) < 7 || nearDoor(x, z, 5)) continue;
        const rot = rnd() * 3.14;
        g.color(0x8a5a35).box(x, y + 0.45, z, 1.9, 0.1, 0.55, rot);
        g.color(0x4a4f57).box(x, y + 0.22, z, 1.5, 0.44, 0.12, rot);
        collider.addCircle(x, z, 0.75);
        placed++;
      }
      // 현수막
      const bx = js.x + js.nx * 13;
      const bz = js.z + js.nz * 13;
      const rot = Math.atan2(js.nx, js.nz);
      const px = -js.nz;
      const pz = js.nx;
      g.color(0xdedede).box(bx + px * 5.2, y + 2.9, bz + pz * 5.2, 0.12, 5.8, 0.12);
      g.color(0xdedede).box(bx - px * 5.2, y + 2.9, bz - pz * 5.2, 0.12, 5.8, 0.12);
      g.color(0x0b2a4a).box(bx, y + 5.0, bz, 10.4, 1.3, 0.05, rot);
      add(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
      for (const s of [1, -1]) {
        const t = textPlane('전산관에 오신 것을 환영합니다\n지공모 · COMMON · 모비딕', 9.4, { color: '#ffffff', font: 'bold 56px "Jua", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif', pad: 6, oneSided: true });
        const k = Math.min(1, 1.15 / t.userData.h);
        t.scale.setScalar(k);
        t.position.set(bx + js.nx * 0.05 * s, y + 5.0, bz + js.nz * 0.05 * s);
        t.rotation.y = rot + (s < 0 ? Math.PI : 0);
        group.add(t);
      }
      collider.addCircle(bx + px * 5.2, bz + pz * 5.2, 0.2);
      collider.addCircle(bx - px * 5.2, bz - pz * 5.2, 0.2);
    }
    const sh = doors.find((d) => d.key === 'saenghwal');
    if (sh) {
      const x = sh.x + sh.nz * 4.4 - sh.nx * 1.0;
      const z = sh.z - sh.nx * 4.4 - sh.nz * 1.0;
      const y = sh.y;
      const rot = Math.atan2(sh.nx, sh.nz);
      const g = new Geo();
      g.color(0xc0392b).box(x, y + 1.0, z, 1.1, 2.0, 0.8, rot);
      g.color(0xfff3c4).box(x + sh.nx * 0.38, y + 1.25, z + sh.nz * 0.38, 0.85, 1.1, 0.08, rot);
      add(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
      const t = textPlane('☕ 커피', 0.8, { color: '#5a2a12', font: 'bold 64px "Jua", "Malgun Gothic", sans-serif', pad: 4, oneSided: true });
      t.position.set(x + sh.nx * 0.44, y + 1.3, z + sh.nz * 0.44);
      t.rotation.y = rot;
      group.add(t);
      collider.addCircle(x, z, 0.7);
      anchors.vending = { x: x + sh.nx * 1.3, y, z: z + sh.nz * 1.3 };
    }
  }

  // ---------- 운동장: 골대와 불꽃 발사대 ----------
  {
    const f = data.areas.find((a) => a.kind === 'field');
    if (f) {
      const c = centroid(f.poly);
      const y = f.pad != null ? f.pad : heightAt(c[0], c[1]);
      // 긴 변 방향
      let best = 0;
      let ang = 0;
      for (let i = 0; i < f.poly.length; i++) {
        const p = f.poly[i];
        const q = f.poly[(i + 1) % f.poly.length];
        const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (l > best) {
          best = l;
          ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
        }
      }
      const g = new Geo();
      g.color(0xf5f5f5);
      for (const s of [-1, 1]) {
        const gx = c[0] + Math.cos(ang) * (best / 2 - 5) * s;
        const gz = c[1] + Math.sin(ang) * (best / 2 - 5) * s;
        const rot = Math.atan2(Math.cos(ang), Math.sin(ang)) + Math.PI / 2;
        const px = -Math.sin(ang);
        const pz = Math.cos(ang);
        g.box(gx + px * 3.6, y + 1.2, gz + pz * 3.6, 0.14, 2.4, 0.14);
        g.box(gx - px * 3.6, y + 1.2, gz - pz * 3.6, 0.14, 2.4, 0.14);
        g.box(gx, y + 2.4, gz, 0.14, 0.14, 7.34, rot);
        collider.addCircle(gx + px * 3.6, gz + pz * 3.6, 0.2);
        collider.addCircle(gx - px * 3.6, gz - pz * 3.6, 0.2);
      }
      g.color(0x2d3a4b).box(c[0], y + 0.2, c[1], 1.2, 0.4, 1.2);
      g.color(0xffd23f).box(c[0], y + 0.5, c[1], 0.5, 0.5, 0.5);
      add(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
      collider.addCircle(c[0], c[1], 0.8);
      anchors.field = { x: c[0], y, z: c[1] };
    }
  }

  // ---------- 길가 주차 차량 ----------
  // 교내 찻길의 도로 폭 밖 길가에, 길 방향으로, 서로 40m 안팎 떨어뜨려 세운다(최대 16대, 주차장 차량 뒤 번호).
  // 비탈·건물·계단 때문에 세울 수 있는 자리가 드물어서, 자리를 모두 찾은 다음 고르게 퍼지도록 고른다.
  // 모든 기기에서 같은 자리가 나와야 하므로 판정에는 품질과 무관한 것만 쓴다:
  // 나무·덤불은 두 품질의 배치를 모두 피하고, 거리 비교는 사칙연산과 제곱근으로만 한다.
  {
    const MIN_GAP = 30; // 차끼리 적어도 이만큼 띄운다(정문 앞 2대만 예외). 지금 지도에서는 가장 가까운 차가 36~50m 거리다
    const SIDE = 1.6; // 도로 가장자리에서 차 중심선까지
    const HALF = 2.15; // 차 길이의 절반
    const ENDS = [-HALF, 0, HALF]; // 차 중심선 위의 검사점: 뒤 끝·가운데·앞 끝
    const BODY = [-1.4, 0, 1.4]; // 반지름 CLEAR인 원 3개로 차체(와 충돌 원)를 다 덮는다
    const CLEAR = 1.25;
    const sq = (v) => v * v;
    const d2 = (ax, az, bx, bz) => sq(ax - bx) + sq(az - bz);
    /** 점과 꺾은선 사이 거리의 제곱 */
    const lineD2 = (x, z, pts) => {
      let best = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i][0];
        const az = pts[i][1];
        const ex = pts[i + 1][0] - ax;
        const ez = pts[i + 1][1] - az;
        const l2 = ex * ex + ez * ez;
        let t = l2 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        best = Math.min(best, d2(x, z, ax + ex * t, az + ez * t));
      }
      return best;
    };

    // 차가 걸치면 안 되는 길: 찻길은 폭 밖으로, 계단·무빙워크는 5m 밖으로, 보행로는 넉넉히(길 위 A+ 동전까지 비운다)
    const ways = [];
    for (const r of data.roads) {
      if (r.bridge) continue;
      const need = r.kind === 'steps' || r.conveying ? 5 : r.kind === 'footway' || r.kind === 'path' || r.kind === 'cycleway' ? r.w / 2 + 2.5 : r.w / 2 + 1.1;
      const bb = bboxOf(r.pts);
      ways.push({ pts: r.pts, need2: need * need, bb: [bb[0] - need, bb[1] - need, bb[2] + need, bb[3] + need] });
    }
    // 운동장·농구장·광장 같은 평지에는 세우지 않는다(주차장은 괜찮다)
    const pads = data.areas.filter((a) => a.kind === 'field' || a.kind === 'court' || a.kind === 'square' || a.kind === 'golf' || a.kind === 'smoking');
    // 7m 안에 세우지 않는 곳: 스폰, 문, 안내판(기둥·스탬프 원·그 앞 빈터), 깃발, 곰, 도착점, 자판기, 운동장 한가운데
    const keep = [[SPAWN.x, SPAWN.z]];
    for (const d of doors) keep.push([d.x, d.z]);
    for (const s of signs) {
      const d = s.door;
      keep.push([s.x, s.z], [s.x - d.nx * 1.9, s.z - d.nz * 1.9], [s.x + d.nx * 4.5, s.z + d.nz * 4.5]);
    }
    for (const k of ['bear', 'climbStart', 'climbFinish', 'climbGoal', 'vending', 'field']) if (anchors[k]) keep.push([anchors[k].x, anchors[k].z]);
    // 두 품질의 나무·덤불을 한데 모은다: [x, z, 반지름, …]
    const plants = [];
    for (const set of plantSets) {
      for (const t of set.trees) if (t.zone > 0) plants.push(t.x, t.z, 0.32 * t.s);
      for (const b of set.bushes) plants.push(b.x, b.z, 0.7 * b.s);
    }

    const tmp = { x: 0, z: 0 };
    /** 중심 (x,z), 앞 방향 (fx,fz)로 차를 세워도 되는 자리인가 */
    const fits = (x, z, fx, fz) => {
      for (const p of keep) if (d2(x, z, p[0], p[1]) < 49) return false;
      for (const c of parked) if (d2(x, z, c.x, c.z) < 36) return false; // 다른 차와 6m 이상
      for (const a of ENDS) {
        const px = x + fx * a;
        const pz = z + fz * a;
        if (!campus.playable(px, pz) || collider.solidAt(px, pz)) return false;
        const s = campus.slopeAt(px, pz);
        if (s.dx * s.dx + s.dz * s.dz > 0.0625) return false; // 경사 0.25 이하
        for (const p of pads) if (inPoly(px, pz, p.poly)) return false;
        for (const w of ways) {
          if (px < w.bb[0] || px > w.bb[2] || pz < w.bb[1] || pz > w.bb[3]) continue;
          if (lineD2(px, pz, w.pts) < w.need2) return false;
        }
      }
      for (const a of BODY) {
        const px = x + fx * a;
        const pz = z + fz * a;
        // 나무·덤불은 resolve보다 조금 더 엄하게 직접 본다 → 이 기기에 없는 쪽 배치 때문에 결과가 갈리지 않는다
        for (let i = 0; i < plants.length; i += 3) if (d2(px, pz, plants[i], plants[i + 1]) < sq(CLEAR + plants[i + 2] + 0.05)) return false;
        tmp.x = px;
        tmp.z = pz;
        if (collider.resolve(tmp, CLEAR)) return false; // 벽·가로등·벤치·다른 차 등
      }
      return true;
    };

    // 교내 찻길과 누적 길이
    const lanes = [];
    for (const r of data.roads) {
      if (!r.inCampus || r.kind !== 'service' || r.bridge) continue;
      const cum = [0];
      for (let i = 0; i < r.pts.length - 1; i++) cum.push(cum[i] + Math.sqrt(d2(r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1])));
      lanes.push({ r, cum, len: cum[cum.length - 1] });
    }
    /** 길을 따라 s만큼 간 점 */
    const along = (ln, s) => {
      const pts = ln.r.pts;
      const cum = ln.cum;
      let i = 0;
      while (i < cum.length - 2 && cum[i + 1] < s) i++;
      const t = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    };
    /** 길 위 s 지점 옆의 길가 자리. side 1은 진행 방향의 오른쪽, -1은 왼쪽 */
    const poseAt = (ln, s, side) => {
      const p = along(ln, s);
      const a = along(ln, Math.max(0, s - 2.5));
      const b = along(ln, Math.min(ln.len, s + 2.5));
      const l = Math.sqrt(d2(a[0], a[1], b[0], b[1]));
      if (!(l > 0)) return null;
      const tx = (b[0] - a[0]) / l;
      const tz = (b[1] - a[1]) / l;
      const off = (ln.r.w / 2 + SIDE) * side;
      // 우측통행처럼: 오른쪽에 선 차는 진행 방향을, 왼쪽에 선 차는 반대 방향을 본다
      return { x: p[0] - tz * off, z: p[1] + tx * off, fx: tx * side, fz: tz * side };
    };
    const spawnD2 = (c) => d2(c.x, c.z, SPAWN.x, SPAWN.z);

    // 1) 세울 수 있는 길가 자리를 모두 찾는다: 교내 찻길을 3m 간격으로, 양쪽 다
    const spots = [];
    for (const ln of lanes) {
      for (let s = 3; s <= ln.len - 3; s += 3) {
        for (const side of [1, -1]) {
          const c = poseAt(ln, s, side);
          if (c && fits(c.x, c.z, c.fx, c.fz)) spots.push(c);
        }
      }
    }

    // 2) 정문 진입로: 스폰에서 40m 안에 2대. 스폰에서 가까운 자리부터, 서로 12m 이상 떨어지게
    const picked = [];
    const lim = sq(40 - HALF - 1); // 차 전체가 40m 안에 들어오게
    const near = spots.filter((c) => spawnD2(c) < lim).sort((p, q) => spawnD2(p) - spawnD2(q));
    for (const c of near) if (picked.length < 2 && picked.every((o) => d2(o.x, o.z, c.x, c.z) >= 144)) picked.push(c);

    // 3) 나머지: 이미 있는 차(주차장·정문 차 포함)에서 가장 먼 자리부터 하나씩 고른다
    //    → 한쪽에 몰리지 않고 캠퍼스 전체에 고르게 퍼진다. 차끼리 MIN_GAP보다 가까워져야 하면 그만 세운다
    while (picked.length < ROADSIDE_MAX) {
      let best = null;
      let bd = MIN_GAP * MIN_GAP;
      for (const c of spots) {
        let d = Infinity;
        for (const o of parked) d = Math.min(d, d2(o.x, o.z, c.x, c.z));
        for (const o of picked) d = Math.min(d, d2(o.x, o.z, c.x, c.z));
        if (d > bd) {
          bd = d;
          best = c;
        }
      }
      if (!best) break;
      picked.push(best);
    }

    // 세우기: 인스턴스 행렬·색·충돌 원 2개
    const rnd = makeRng(4243);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qy = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const nrm = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const col = new THREE.Color();
    for (const c of picked) {
      const i = parked.length;
      // 길가는 비탈이라 수평으로 두면 한쪽이 뜨거나 묻힌다 → 네 바퀴 자리의 지면 높이로 차를 땅에 붙인다
      const lx = c.fz; // 차의 옆 방향(로컬 +x)
      const lz = -c.fx;
      const h = (a, b) => heightAt(c.x + c.fx * a + lx * b, c.z + c.fz * a + lz * b);
      const h0 = h(1.5, 0.8);
      const h1 = h(1.5, -0.8);
      const h2 = h(-1.5, 0.8);
      const h3 = h(-1.5, -0.8);
      const y = (h0 + h1 + h2 + h3) / 4;
      const ga = (h0 + h1 - h2 - h3) / 6; // 앞뒤 기울기
      const gl = (h0 + h2 - h1 - h3) / 3.2; // 좌우 기울기
      const rot = Math.atan2(c.fx, c.fz);
      const color = CAR_PAL[Math.floor(rnd() * CAR_PAL.length)];
      nrm.set(-(ga * c.fx + gl * lx), 1, -(ga * c.fz + gl * lz)).normalize(); // 지면 법선
      q.setFromUnitVectors(up, nrm).multiply(qy.setFromAxisAngle(up, rot));
      m4.compose(pos.set(c.x, y + 0.02, c.z), q, one);
      carBody.setMatrixAt(i, m4);
      carCab.setMatrixAt(i, m4);
      carBody.setColorAt(i, col.setHex(color));
      const c0 = collider.addCircle(c.x - c.fx, c.z - c.fz, 1.05);
      const c1 = collider.addCircle(c.x + c.fx, c.z + c.fz, 1.05);
      parked.push({ i, x: c.x, y, z: c.z, rot, color, col: [c0, c1], visible: true });
    }
    // 대수가 정해졌다. 경계 구(화면 밖 판정)는 모든 차가 제자리에 있을 때 한 번만 구한다.
    for (const m of [carBody, carCab]) {
      m.count = parked.length;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }

  // 차를 숨기거나(터짐·누가 타고 감) 제자리에 되돌린다: 인스턴스 행렬 scale 0/원래 + 충돌 원 끄고 켜기.
  // why는 숨기는 까닭이다(안 줘도 된다). 모듈마다 다른 이름을 주면 서로의 숨김을 풀지 않는다:
  // 까닭이 하나라도 남아 있으면 계속 숨고, 다 없어져야 다시 보인다. cars[i].visible은 그 결과.
  const carHome = carBody.instanceMatrix.array.slice(0, parked.length * 16); // 차마다 원래 행렬
  const carWhy = parked.map(() => new Set());
  const carM = new THREE.Matrix4();
  const setCarVisible = (i, on, why = '') => {
    if (!Number.isInteger(i) || i < 0 || i >= parked.length) return;
    const c = parked[i];
    if (on) carWhy[i].delete(why);
    else carWhy[i].add(why);
    const show = carWhy[i].size === 0;
    if (c.visible === show) return; // 매 프레임 불러도 바뀔 때만 일한다
    c.visible = show;
    const o = i * 16;
    if (show) carM.fromArray(carHome, o);
    else carM.makeScale(0, 0, 0).setPosition(carHome[o + 12], carHome[o + 13], carHome[o + 14]);
    carBody.setMatrixAt(i, carM);
    carCab.setMatrixAt(i, carM);
    carBody.instanceMatrix.needsUpdate = true;
    carCab.instanceMatrix.needsUpdate = true;
    collider.setCircleEnabled(c.col[0], show);
    collider.setCircleEnabled(c.col[1], show);
  };

  return {
    group,
    signs,
    anchors,
    cars: parked,
    setCarVisible,
    update(dt, t) {
      for (const f of updaters) f(dt, t);
    },
  };
}
