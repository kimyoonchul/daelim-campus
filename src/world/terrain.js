// 지형 메시와 바닥 텍스처. 도로·주차장·운동장은 큰 캔버스 한 장에 그려서 지형에 입힌다.
import * as THREE from 'three';
import data from '../../data/campus-data.js';
import { H, grid, heightAt } from './heightfield.js';
import { zoneAt, occAt, OCC } from './occupancy.js';
import { noise2, makeRng } from '../core/rng.js';
import { bboxOf } from './geom.js';

const { X0, Z0, STEP, NX, NZ, X1, Z1 } = grid;

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
const sm = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function makeGroundCanvas(low) {
  const W = low ? 2048 : 4096;
  const Hh = Math.round((W * (Z1 - Z0)) / (X1 - X0));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = Hh;
  const g = cv.getContext('2d');
  const sx = W / (X1 - X0);
  const sz = Hh / (Z1 - Z0);
  const px = (x) => (x - X0) * sx;
  const pz = (z) => (z - Z0) * sz;

  // 1) 바탕: 풀밭·숲·옹벽(가파른 곳)을 낮은 해상도로 칠해 늘린다
  const bw = 1024;
  const bh = Math.round((bw * Hh) / W);
  const base = document.createElement('canvas');
  base.width = bw;
  base.height = bh;
  const bg = base.getContext('2d');
  const img = bg.createImageData(bw, bh);
  const d = img.data;
  const G1 = [104, 158, 78];
  const G2 = [131, 178, 88];
  const FOREST = [62, 110, 60];
  const WALL = [186, 180, 168];
  const DIRT = [150, 140, 104];
  for (let y = 0; y < bh; y++) {
    const z = Z0 + ((y + 0.5) / bh) * (Z1 - Z0);
    for (let x = 0; x < bw; x++) {
      const wx = X0 + ((x + 0.5) / bw) * (X1 - X0);
      const e = 1.4;
      const sdx = (heightAt(wx + e, z) - heightAt(wx - e, z)) / (2 * e);
      const sdz = (heightAt(wx, z + e) - heightAt(wx, z - e)) / (2 * e);
      const slope = Math.hypot(sdx, sdz);
      const n = noise2(wx * 0.07, z * 0.07);
      const n2 = noise2(wx * 0.45 + 31, z * 0.45 + 7);
      const zone = zoneAt(wx, z);
      let c = lerp3(G1, G2, n);
      if (occAt(wx, z) === OCC.WOOD || zone === 0) c = lerp3(c, FOREST, zone === 0 ? 0.75 : 0.6);
      // 비탈은 조금 어둡게, 아주 가파르면 옹벽
      c = lerp3(c, DIRT, sm(0.35, 0.8, slope) * 0.35);
      if (zone > 0) c = lerp3(c, WALL, sm(0.95, 1.35, slope));
      // 햇빛 방향 음영(남동쪽이 밝다)
      const lit = 1 + (sdx * 0.25 - sdz * 0.2);
      const k = Math.max(0.72, Math.min(1.18, lit)) * (0.93 + n2 * 0.14);
      const o = (y * bw + x) * 4;
      d[o] = Math.min(255, c[0] * k);
      d[o + 1] = Math.min(255, c[1] * k);
      d[o + 2] = Math.min(255, c[2] * k);
      d[o + 3] = 255;
    }
  }
  bg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(base, 0, 0, W, Hh);

  const path = (poly) => {
    g.beginPath();
    poly.forEach((v, i) => (i ? g.lineTo(px(v[0]), pz(v[1])) : g.moveTo(px(v[0]), pz(v[1]))));
    g.closePath();
  };
  const line = (pts) => {
    g.beginPath();
    pts.forEach((v, i) => (i ? g.lineTo(px(v[0]), pz(v[1])) : g.moveTo(px(v[0]), pz(v[1]))));
  };

  // 2) 물·공원
  for (const a of data.areas) {
    if (a.kind === 'water') {
      path(a.poly);
      g.fillStyle = '#4f8fc9';
      g.fill();
    } else if (a.kind === 'park' || a.kind === 'playground') {
      path(a.poly);
      g.fillStyle = a.kind === 'park' ? 'rgba(140,196,104,0.55)' : 'rgba(214,190,150,0.8)';
      g.fill();
    }
  }

  // 3) 주차장: 아스팔트 + 주차선
  const rnd = makeRng(99);
  for (const a of data.areas) {
    if (a.kind !== 'parking') continue;
    path(a.poly);
    g.fillStyle = '#767b82';
    g.fill();
    // 가장 긴 변 방향으로 주차선을 긋는다
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
    g.save();
    path(a.poly);
    g.clip();
    g.translate(px(cxm), pz(czm));
    g.rotate(ang);
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = Math.max(1, 0.14 * sx);
    for (let v = -R; v <= R; v += 2.6) {
      g.beginPath();
      g.moveTo(v * sx, -R * sx);
      g.lineTo(v * sx, R * sx);
      g.stroke();
    }
    // 통로(주차 칸 사이 길)를 다시 아스팔트로 덮는다
    g.fillStyle = '#6b7077';
    for (let u = -R + 5; u <= R; u += 16.5) g.fillRect(-R * sx, u * sx, 2 * R * sx, 6 * sx);
    g.restore();
    void rnd;
  }

  // 4) 도로: 보도(연한 띠) → 아스팔트 → 차선
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const car = (k) => k === 'primary' || k === 'primary_link' || k === 'tertiary' || k === 'residential' || k === 'service';
  for (const r of data.roads) {
    if (r.bridge || !car(r.kind)) continue;
    line(r.pts);
    g.strokeStyle = r.inCampus ? '#cfcabd' : '#c2beb4';
    g.lineWidth = (r.w + (r.kind === 'service' ? 1.8 : 3.2)) * sx;
    g.stroke();
  }
  for (const r of data.roads) {
    if (r.bridge || !car(r.kind)) continue;
    line(r.pts);
    g.strokeStyle = r.kind === 'service' ? '#5d6168' : '#50545a';
    g.lineWidth = r.w * sx;
    g.stroke();
  }
  for (const r of data.roads) {
    if (r.bridge) continue;
    if (r.kind === 'primary' || r.kind === 'tertiary') {
      line(r.pts);
      g.strokeStyle = '#f2df8e';
      g.lineWidth = Math.max(1.2, 0.2 * sx);
      g.setLineDash(r.kind === 'primary' ? [] : [3 * sx, 4 * sx]);
      g.stroke();
      g.setLineDash([]);
    } else if (r.kind === 'service' && r.inCampus) {
      // 교내 도로 가장자리 흰 선
      line(r.pts);
      g.strokeStyle = 'rgba(255,255,255,0.28)';
      g.lineWidth = Math.max(1, 0.12 * sx);
      g.setLineDash([2.5 * sx, 3.5 * sx]);
      g.stroke();
      g.setLineDash([]);
    }
  }
  // 보행로·자전거길·계단 바닥·무빙워크 바닥
  for (const r of data.roads) {
    if (r.bridge || car(r.kind)) continue;
    line(r.pts);
    if (r.conveying) g.strokeStyle = '#9aa0a8';
    else if (r.kind === 'steps') g.strokeStyle = '#bdb7ab';
    else if (r.kind === 'cycleway') g.strokeStyle = '#b5574a';
    else g.strokeStyle = '#c59d80';
    g.lineWidth = (r.w + (r.conveying ? 1.2 : 0)) * sx;
    g.stroke();
  }

  // 5) 평지(패드): 운동장·농구장·광장·골프연습장
  for (const a of data.areas) {
    if (a.kind === 'field') {
      path(a.poly);
      g.fillStyle = '#dcc490';
      g.fill();
      g.save();
      path(a.poly);
      g.clip();
      // 흙 얼룩
      const bb = bboxOf(a.poly);
      const r2 = makeRng(5);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(${150 + r2() * 60},${120 + r2() * 50},${70 + r2() * 40},0.07)`;
        g.beginPath();
        g.ellipse(px(r2.range(bb[0], bb[2])), pz(r2.range(bb[1], bb[3])), (2 + r2() * 7) * sx, (1 + r2() * 4) * sx, r2() * 3, 0, 7);
        g.fill();
      }
      g.restore();
      path(a.poly);
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = 0.3 * sx;
      g.stroke();
    } else if (a.kind === 'court') {
      path(a.poly);
      g.fillStyle = '#3f9468';
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 0.22 * sx;
      g.stroke();
    } else if (a.kind === 'square') {
      path(a.poly);
      g.fillStyle = '#d6c7ad';
      g.fill();
      g.save();
      path(a.poly);
      g.clip();
      const bb = bboxOf(a.poly);
      g.strokeStyle = 'rgba(150,120,90,0.35)';
      g.lineWidth = Math.max(1, 0.08 * sx);
      for (let x = Math.floor(bb[0]); x <= bb[2]; x += 1.5) {
        g.beginPath();
        g.moveTo(px(x), pz(bb[1]));
        g.lineTo(px(x), pz(bb[3]));
        g.stroke();
      }
      for (let z = Math.floor(bb[1]); z <= bb[3]; z += 1.5) {
        g.beginPath();
        g.moveTo(px(bb[0]), pz(z));
        g.lineTo(px(bb[2]), pz(z));
        g.stroke();
      }
      g.restore();
    } else if (a.kind === 'golf') {
      path(a.poly);
      g.fillStyle = '#2f8a5c';
      g.fill();
    } else if (a.kind === 'smoking') {
      path(a.poly);
      g.fillStyle = '#b9b2a2';
      g.fill();
    }
  }
  return cv;
}

export function buildTerrain(engine) {
  const n = NX * NZ;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let k = 0; k < NZ; k++) {
    for (let i = 0; i < NX; i++) {
      const c = k * NX + i;
      pos[c * 3] = X0 + i * STEP;
      pos[c * 3 + 1] = H[c];
      pos[c * 3 + 2] = Z0 + k * STEP;
      const hl = H[k * NX + Math.max(0, i - 1)];
      const hr = H[k * NX + Math.min(NX - 1, i + 1)];
      const hu = H[Math.max(0, k - 1) * NX + i];
      const hd = H[Math.min(NZ - 1, k + 1) * NX + i];
      const nx = (hl - hr) / (2 * STEP);
      const nz = (hu - hd) / (2 * STEP);
      const l = Math.hypot(nx, 1, nz);
      nor[c * 3] = nx / l;
      nor[c * 3 + 1] = 1 / l;
      nor[c * 3 + 2] = nz / l;
      uv[c * 2] = i / (NX - 1);
      uv[c * 2 + 1] = 1 - k / (NZ - 1);
    }
  }
  const idx = new Uint32Array((NX - 1) * (NZ - 1) * 6);
  let o = 0;
  for (let k = 0; k < NZ - 1; k++) {
    for (let i = 0; i < NX - 1; i++) {
      const a = k * NX + i;
      const b = a + 1;
      const d = a + NX;
      const e = d + 1;
      idx[o++] = a;
      idx[o++] = d;
      idx[o++] = b;
      idx[o++] = b;
      idx[o++] = d;
      idx[o++] = e;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();

  const cv = makeGroundCanvas(engine.quality.low);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = engine.renderer.capabilities.getMaxAnisotropy();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  const group = new THREE.Group();
  group.add(mesh);
  // 지형 바깥을 채우는 먼 땅
  const far = new THREE.Mesh(new THREE.CircleGeometry(2600, 40), new THREE.MeshLambertMaterial({ color: 0x5f8a58 }));
  far.rotation.x = -Math.PI / 2;
  far.position.set(0, -7, 0);
  group.add(far);
  return { group, mesh, canvas: cv };
}
