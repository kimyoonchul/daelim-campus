#!/usr/bin/env node
// OSM(Overpass JSON) + SRTM 고도 → data/campus-data.js
// 실행: node tools/build-campus.mjs
// 지도 자료 © OpenStreetMap contributors (ODbL), 고도 SRTM 30m.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN, DOMAIN, CAMPUS_WAY, BUILDINGS, UNNAMED_BUILDINGS, AREA_PADS, ROAD_WIDTH } from './campus-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/osm/campus_raw.json'), 'utf8'));
const demPts = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/osm/elev_srtm30m.json'), 'utf8'));

const MX = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const MY = 110540;
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
// 월드 좌표: x=동쪽, z=남쪽 (북이 -z)
const toXZ = (lat, lon) => [r1((lon - ORIGIN.lon) * MX), r1(-(lat - ORIGIN.lat) * MY)];

const { x0: X0, z0: Z0, step: STEP, nx: NX, nz: NZ } = DOMAIN;
const X1 = X0 + (NX - 1) * STEP;
const Z1 = Z0 + (NZ - 1) * STEP;

// ---------- 기하 도우미 ----------
function signedArea(p) {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return a / 2;
}
function centroid(p) {
  let x = 0;
  let z = 0;
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j][0] * p[i][1] - p[i][0] * p[j][1];
    x += (p[j][0] + p[i][0]) * f;
    z += (p[j][1] + p[i][1]) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-6) {
    let sx = 0;
    let sz = 0;
    for (const q of p) {
      sx += q[0];
      sz += q[1];
    }
    return [sx / p.length, sz / p.length];
  }
  return [x / (3 * a), z / (3 * a)];
}
function inPoly(x, z, p) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i];
    const b = p[j];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function distSeg(x, z, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = dx * dx + dz * dz;
  let t = l ? ((x - a[0]) * dx + (z - a[1]) * dz) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
}
function distPolyEdge(x, z, p) {
  let d = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) d = Math.min(d, distSeg(x, z, p[j], p[i]));
  return d;
}
function bbox(p) {
  let a = Infinity;
  let b = Infinity;
  let c = -Infinity;
  let d = -Infinity;
  for (const q of p) {
    a = Math.min(a, q[0]);
    b = Math.min(b, q[1]);
    c = Math.max(c, q[0]);
    d = Math.max(d, q[1]);
  }
  return [a, b, c, d];
}
const inDomain = (x, z, m = 0) => x >= X0 + m && x <= X1 - m && z >= Z0 + m && z <= Z1 - m;

// 선분을 월드 범위로 자른다 (Liang–Barsky)
function clipSeg(a, b) {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const p = [-dx, dx, -dz, dz];
  const q = [a[0] - X0, X1 - a[0], a[1] - Z0, Z1 - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [
    [r1(a[0] + t0 * dx), r1(a[1] + t0 * dz)],
    [r1(a[0] + t1 * dx), r1(a[1] + t1 * dz)],
    t0 > 0,
    t1 < 1,
  ];
}
function clipPolyline(pts) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const c = clipSeg(pts[i], pts[i + 1]);
    if (!c) {
      cur = null;
      continue;
    }
    if (!cur || c[2]) {
      cur = [c[0]];
      runs.push(cur);
    }
    cur.push(c[1]);
    if (c[3]) cur = null;
  }
  return runs.filter((r) => r.length >= 2);
}
// 다각형을 월드 사각형으로 자른다 (Sutherland–Hodgman)
function clipPoly(poly) {
  const edges = [
    [(p) => p[0] >= X0, (a, b) => [X0, a[1] + ((b[1] - a[1]) * (X0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= X1, (a, b) => [X1, a[1] + ((b[1] - a[1]) * (X1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= Z0, (a, b) => [a[0] + ((b[0] - a[0]) * (Z0 - a[1])) / (b[1] - a[1]), Z0]],
    [(p) => p[1] <= Z1, (a, b) => [a[0] + ((b[0] - a[0]) * (Z1 - a[1])) / (b[1] - a[1]), Z1]],
  ];
  let out = poly;
  for (const [inside, cut] of edges) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i];
      const b = inp[(i + 1) % inp.length];
      const ia = inside(a);
      const ib = inside(b);
      if (ia && ib) out.push(b);
      else if (ia && !ib) out.push(cut(a, b));
      else if (!ia && ib) {
        out.push(cut(a, b));
        out.push(b);
      }
    }
    if (out.length < 3) return null;
  }
  return out.map((p) => [r1(p[0]), r1(p[1])]);
}

// ---------- OSM 읽기 ----------
const nodes = new Map();
const ways = new Map();
const rels = [];
for (const e of raw.elements) {
  if (e.type === 'node') nodes.set(e.id, e);
  else if (e.type === 'way') ways.set(e.id, e);
  else if (e.type === 'relation') rels.push(e);
}
function wayPts(w) {
  const out = [];
  for (const id of w.nodes) {
    const n = nodes.get(id);
    if (n) out.push(toXZ(n.lat, n.lon));
  }
  return out;
}
function closedPoly(pts) {
  const n = pts.length;
  if (n > 3 && pts[0][0] === pts[n - 1][0] && pts[0][1] === pts[n - 1][1]) return pts.slice(0, -1);
  return null;
}
// 멀티폴리곤의 바깥 고리 조립 (끝점이 같은 way끼리 잇는다)
function assembleRings(rel, role = 'outer') {
  const segs = [];
  for (const m of rel.members || []) {
    if (m.type !== 'way' || (m.role || 'outer') !== role) continue;
    const w = ways.get(m.ref);
    if (w && w.nodes.length > 1) segs.push(w.nodes.slice());
  }
  const rings = [];
  while (segs.length) {
    let ring = segs.pop();
    let grew = true;
    while (ring[0] !== ring[ring.length - 1] && grew) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const end = ring[ring.length - 1];
        if (s[0] === end) ring = ring.concat(s.slice(1));
        else if (s[s.length - 1] === end) ring = ring.concat(s.slice(0, -1).reverse());
        else if (s[s.length - 1] === ring[0]) ring = s.concat(ring.slice(1));
        else if (s[0] === ring[0]) ring = s.slice(1).reverse().concat(ring);
        else continue;
        segs.splice(i, 1);
        grew = true;
        break;
      }
    }
    const pts = ring.map((id) => nodes.get(id)).filter(Boolean).map((n) => toXZ(n.lat, n.lon));
    if (pts.length >= 3) rings.push(pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.slice(0, -1) : pts);
  }
  return rings;
}

const campus = closedPoly(wayPts(ways.get(CAMPUS_WAY)));
if (!campus) throw new Error('캠퍼스 경계를 찾지 못함');

// ---------- 건물 ----------
const buildings = [];
function addBuilding(id, tags, poly) {
  if (!poly || poly.length < 3) return;
  if (signedArea(poly) < 0) poly.reverse(); // 방향 통일
  const c = centroid(poly);
  if (!poly.every((p) => inDomain(p[0], p[1], 2))) return;
  const name = tags.name || '';
  let cfg = UNNAMED_BUILDINGS[id] || null;
  if (!cfg && BUILDINGS[name] && inPoly(c[0], c[1], campus)) cfg = BUILDINGS[name];
  const levels = Number(tags['building:levels']) || (cfg ? 3 : 2);
  const b = { id, poly, levels, c: [r1(c[0]), r1(c[1])] };
  if (cfg) {
    b.key = cfg.key;
    b.name = cfg.name || name;
    b.letter = cfg.letter;
    b.floorH = cfg.floorH;
    b.cfg = cfg;
  } else {
    b.kind = tags.building === 'apartments' ? 'apt' : tags.building === 'church' ? 'church' : 'etc';
    b.h = Number(tags.height) || levels * (b.kind === 'apt' ? 2.9 : 3.3);
    if (name) b.label = name;
  }
  buildings.push(b);
}
for (const w of ways.values()) {
  if (w.tags && w.tags.building) addBuilding(w.id, w.tags, closedPoly(wayPts(w)));
}
for (const r of rels) {
  if (r.tags && r.tags.type === 'multipolygon' && r.tags.building) {
    for (const ring of assembleRings(r)) addBuilding(r.id, r.tags, ring);
  }
}

// ---------- 도로 ----------
const roads = [];
for (const w of ways.values()) {
  const t = w.tags;
  if (!t || !t.highway || !(t.highway in ROAD_WIDTH)) continue;
  const pts = wayPts(w);
  for (const run of clipPolyline(pts)) {
    const mid = run[Math.floor(run.length / 2)];
    const inCampus = inPoly(mid[0], mid[1], campus) || run.some((p) => inPoly(p[0], p[1], campus));
    const road = { id: w.id, kind: t.highway, w: ROAD_WIDTH[t.highway], pts: run, inCampus };
    if (t.conveying) road.conveying = 1;
    if (t.bridge === 'yes') road.bridge = 1;
    if (t.name) road.name = t.name;
    roads.push(road);
  }
}

// ---------- 면(운동장·주차장·숲 등) ----------
const areas = [];
function areaKind(t) {
  if (t.leisure === 'pitch') return t.sport === 'basketball' ? 'court' : 'field';
  if (t.amenity === 'parking' || t.amenity === 'parking_space') return 'parking';
  if (t.natural === 'wood') return 'wood';
  if (t.place === 'square') return 'square';
  if (t.leisure === 'park' || t.landuse === 'village_green') return 'park';
  if (t.leisure === 'golf_course') return 'golf';
  if (t.amenity === 'smoking_area') return 'smoking';
  if (t.leisure === 'playground') return 'playground';
  if (t.natural === 'water') return 'water';
  return null;
}
function addArea(id, kind, poly) {
  const cl = clipPoly(poly);
  if (!cl) return;
  if (Math.abs(signedArea(cl)) < 8) return;
  const c = centroid(cl);
  const a = { id, kind, poly: cl, inCampus: inPoly(c[0], c[1], campus) };
  if (AREA_PADS[id]) a.pad = AREA_PADS[id].pad;
  areas.push(a);
}
for (const w of ways.values()) {
  if (!w.tags) continue;
  const kind = areaKind(w.tags);
  if (!kind) continue;
  const poly = closedPoly(wayPts(w));
  if (poly) addArea(w.id, kind, poly);
}
for (const r of rels) {
  if (!r.tags || r.tags.type !== 'multipolygon') continue;
  const kind = areaKind(r.tags);
  if (!kind) continue;
  for (const ring of assembleRings(r)) addArea(r.id, kind, ring);
}

// ---------- 지점 ----------
const pois = [];
for (const n of nodes.values()) {
  if (!n.tags) continue;
  const [x, z] = toXZ(n.lat, n.lon);
  if (!inDomain(x, z, 4)) continue;
  if (n.tags.highway === 'bus_stop') pois.push({ kind: 'bus', name: n.tags.name || '', x, z });
  else if (n.tags.amenity === 'cafe') pois.push({ kind: 'cafe', name: n.tags.name || '', x, z });
}

function rayExit(poly, c, dirx, dirz) {
  // 중심에서 dir 방향으로 쏜 반직선이 다각형을 벗어나는 가장 먼 점
  let best = null;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const den = dirx * ez - dirz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - c[0]) * ez - (a[1] - c[1]) * ex) / den;
    const u = ((a[0] - c[0]) * dirz - (a[1] - c[1]) * dirx) / den;
    if (t > 0 && u >= 0 && u <= 1) {
      if (!best || t > best.t) {
        // 바깥쪽 법선
        let nx = ez;
        let nz = -ex;
        const nl = Math.hypot(nx, nz) || 1;
        nx /= nl;
        nz /= nl;
        if (nx * dirx + nz * dirz < 0) {
          nx = -nx;
          nz = -nz;
        }
        best = { t, x: c[0] + dirx * t, z: c[1] + dirz * t, nx, nz };
      }
    }
  }
  return best;
}
// ---------- 지형 ----------
const N = NX * NZ;
const H = new Float32Array(N);
const F = new Float32Array(N);
const LAM = new Float32Array(N);
const FIX = new Uint8Array(N); // 0 자유, 1 패드, 2 도로
const cx = (i) => X0 + i * STEP;
const cz = (k) => Z0 + k * STEP;

// DEM 격자(25m) → 쌍선형 보간
const demMap = new Map(demPts.map((p) => [p[0] + ',' + p[1], p[2]]));
const DEM_MIN = -300;
const DEM_MAX = 300;
const DEM_STEP = 25;
function demAt(x, z) {
  const yn = -z;
  const fx = (Math.max(DEM_MIN, Math.min(DEM_MAX - 0.001, x)) - DEM_MIN) / DEM_STEP;
  const fy = (Math.max(DEM_MIN, Math.min(DEM_MAX - 0.001, yn)) - DEM_MIN) / DEM_STEP;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const g = (a, b) => demMap.get(DEM_MIN + a * DEM_STEP + ',' + (DEM_MIN + b * DEM_STEP));
  return (g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx) * (1 - ty) + (g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx) * ty;
}
const STREET_ELEV = 34; // 임곡로(남쪽 도로)의 SRTM 높이 → 0m 기준
for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) F[k * NX + i] = Math.max(-6, demAt(cx(i), cz(k)) - STREET_ELEV);
// 건물·나무 때문에 울퉁불퉁한 표면 모델을 뭉갠다
function boxBlur(arr, rad) {
  const tmp = new Float32Array(N);
  for (let k = 0; k < NZ; k++) {
    for (let i = 0; i < NX; i++) {
      let s = 0;
      let n = 0;
      for (let d = -rad; d <= rad; d++) {
        const j = i + d;
        if (j < 0 || j >= NX) continue;
        s += arr[k * NX + j];
        n++;
      }
      tmp[k * NX + i] = s / n;
    }
  }
  for (let k = 0; k < NZ; k++) {
    for (let i = 0; i < NX; i++) {
      let s = 0;
      let n = 0;
      for (let d = -rad; d <= rad; d++) {
        const j = k + d;
        if (j < 0 || j >= NZ) continue;
        s += tmp[j * NX + i];
        n++;
      }
      arr[k * NX + i] = s / n;
    }
  }
}
boxBlur(F, 7);
boxBlur(F, 7);

// 캠퍼스 안과 주변 40m 띠는 패드 사이를 매끈하게 잇고(λ=0), 그 밖은 DEM을 따라간다
const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const campusBB = bbox(campus);
for (let k = 0; k < NZ; k++) {
  for (let i = 0; i < NX; i++) {
    const x = cx(i);
    const z = cz(k);
    const c = k * NX + i;
    H[c] = F[c];
    if (x > campusBB[0] - 100 && x < campusBB[2] + 100 && z > campusBB[1] - 100 && z < campusBB[3] + 100) {
      if (inPoly(x, z, campus)) LAM[c] = 0;
      else LAM[c] = 0.07 * smooth(30, 85, distPolyEdge(x, z, campus));
    } else LAM[c] = 0.07;
  }
}

function stampPad(poly, h, margin) {
  const bb = bbox(poly);
  const i0 = Math.max(0, Math.floor((bb[0] - margin - X0) / STEP));
  const i1 = Math.min(NX - 1, Math.ceil((bb[2] + margin - X0) / STEP));
  const k0 = Math.max(0, Math.floor((bb[1] - margin - Z0) / STEP));
  const k1 = Math.min(NZ - 1, Math.ceil((bb[3] + margin - Z0) / STEP));
  for (let k = k0; k <= k1; k++) {
    for (let i = i0; i <= i1; i++) {
      const x = cx(i);
      const z = cz(k);
      if (inPoly(x, z, poly) || distPolyEdge(x, z, poly) <= margin) {
        H[k * NX + i] = h;
        FIX[k * NX + i] = 1;
      }
    }
  }
}
for (const a of areas) if (a.pad != null) stampPad(a.poly, a.pad, 1.5);
for (const b of buildings) {
  if (!b.cfg) continue;
  const cfg = b.cfg;
  if (cfg.pad != null) stampPad(b.poly, cfg.pad, 1.2);
  // 문 위치: 건물 중심에서 bearing 방향으로 쏜 반직선이 평면을 벗어나는 점
  const rad = (cfg.bearing * Math.PI) / 180;
  b.doorHit = rayExit(b.poly, b.c, Math.sin(rad), -Math.cos(rad));
  if (b.doorHit && cfg.pad != null) {
    // 문 앞 평지(반지름 5m)
    const ax = b.doorHit.x + b.doorHit.nx * 3.5;
    const az = b.doorHit.z + b.doorHit.nz * 3.5;
    const ring = [];
    for (let i = 0; i < 12; i++) ring.push([ax + Math.cos((i / 12) * Math.PI * 2) * 5, az + Math.sin((i / 12) * Math.PI * 2) * 5]);
    stampPad(ring, cfg.pad, 0);
  }
}

function relax(iter) {
  const w = 1.9;
  for (let it = 0; it < iter; it++) {
    for (let k = 1; k < NZ - 1; k++) {
      for (let i = 1; i < NX - 1; i++) {
        const c = k * NX + i;
        if (FIX[c]) continue;
        const avg = (H[c - 1] + H[c + 1] + H[c - NX] + H[c + NX]) * 0.25;
        const lam = LAM[c];
        H[c] += w * ((avg + lam * F[c]) / (1 + lam) - H[c]);
      }
    }
  }
}
function heightAt(x, z) {
  const fx = Math.max(0, Math.min(NX - 1.001, (x - X0) / STEP));
  const fz = Math.max(0, Math.min(NZ - 1.001, (z - Z0) / STEP));
  const i = Math.floor(fx);
  const k = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - k;
  const c = k * NX + i;
  return (H[c] * (1 - tx) + H[c + 1] * tx) * (1 - tz) + (H[c + NX] * (1 - tx) + H[c + NX + 1] * tx) * tz;
}
relax(700);

// 도로: 중심선 종단을 매끈하게 다듬은 뒤 폭만큼 평평하게 찍는다
const stampH = new Float32Array(N).fill(NaN);
const stampD = new Float32Array(N).fill(Infinity);
for (const road of roads) {
  if (road.bridge) continue;
  // 2m 간격 표본
  const sx = [];
  const sz = [];
  for (let i = 0; i < road.pts.length - 1; i++) {
    const a = road.pts[i];
    const b = road.pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / 2));
    for (let s = 0; s < n; s++) {
      sx.push(a[0] + ((b[0] - a[0]) * s) / n);
      sz.push(a[1] + ((b[1] - a[1]) * s) / n);
    }
  }
  const last = road.pts[road.pts.length - 1];
  sx.push(last[0]);
  sz.push(last[1]);
  const n = sx.length;
  const sh = new Float32Array(n);
  const fx = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    sh[i] = heightAt(sx[i], sz[i]);
    const ci = Math.round((sx[i] - X0) / STEP);
    const ck = Math.round((sz[i] - Z0) / STEP);
    if (ci >= 0 && ci < NX && ck >= 0 && ck < NZ && FIX[ck * NX + ci] === 1) fx[i] = 1;
  }
  fx[0] = 1;
  fx[n - 1] = 1;
  for (let it = 0; it < 120; it++) for (let i = 1; i < n - 1; i++) if (!fx[i]) sh[i] = (sh[i - 1] + sh[i] * 2 + sh[i + 1]) / 4;
  road.prof = Array.from(sh, r2); // 디버그용(출력에서는 뺀다)
  const rad = road.w / 2 + 1.0;
  for (let i = 0; i < n - 1; i++) {
    const a = [sx[i], sz[i]];
    const b = [sx[i + 1], sz[i + 1]];
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - rad - X0) / STEP));
    const i1 = Math.min(NX - 1, Math.ceil((Math.max(a[0], b[0]) + rad - X0) / STEP));
    const k0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - rad - Z0) / STEP));
    const k1 = Math.min(NZ - 1, Math.ceil((Math.max(a[1], b[1]) + rad - Z0) / STEP));
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz || 1;
    for (let k = k0; k <= k1; k++) {
      for (let ii = i0; ii <= i1; ii++) {
        const x = cx(ii);
        const z = cz(k);
        let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
        const c = k * NX + ii;
        if (d <= rad && d < stampD[c]) {
          stampD[c] = d;
          stampH[c] = sh[i] * (1 - t) + sh[i + 1] * t;
        }
      }
    }
  }
}
for (let c = 0; c < N; c++) {
  if (FIX[c] === 1 || Number.isNaN(stampH[c])) continue;
  H[c] = stampH[c];
  FIX[c] = 2;
}
{
  const free = [];
  for (let k = 2; k < NZ - 2; k++) {
    for (let i = 2; i < NX - 2; i++) {
      const c = k * NX + i;
      if (FIX[c] !== 2) continue;
      let cliff = false;
      for (let dk = -2; dk <= 2 && !cliff; dk++) {
        for (let di = -2; di <= 2; di++) {
          const o = c + dk * NX + di;
          if (FIX[o] === 1 && Math.abs(H[o] - H[c]) > 0.7) {
            cliff = true;
            break;
          }
        }
      }
      if (cliff) free.push(c);
    }
  }
  for (const c of free) FIX[c] = 0;
  console.log('경사로로 푼 도로 칸', free.length);
}
relax(600);

// ---------- 건물 마무리: 바닥 높이, 문 위치 ----------
const outBuildings = [];
for (const b of buildings) {
  const o = { poly: b.poly, levels: b.levels };
  let minH = Infinity;
  let maxH = -Infinity;
  for (let i = 0, j = b.poly.length - 1; i < b.poly.length; j = i++) {
    const a = b.poly[j];
    const q = b.poly[i];
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - a[0], q[1] - a[1]) / 2));
    for (let s = 0; s < n; s++) {
      const h = heightAt(a[0] + ((q[0] - a[0]) * s) / n, a[1] + ((q[1] - a[1]) * s) / n);
      minH = Math.min(minH, h);
      maxH = Math.max(maxH, h);
    }
  }
  if (b.cfg) {
    const cfg = b.cfg;
    o.key = b.key;
    o.name = b.name;
    o.letter = b.letter;
    o.floorH = cfg.floorH;
    o.base = cfg.base != null ? cfg.base : cfg.pad;
    o.floors = b.levels + (cfg.extra || 0);
    o.top = r1(cfg.top != null ? cfg.top : o.base + o.floors * cfg.floorH);
    o.low = r1(Math.min(minH, o.base));
    const ex = b.doorHit;
    if (ex) {
      o.door = { x: r1(ex.x), z: r1(ex.z), nx: r2(ex.nx), nz: r2(ex.nz), y: r1(cfg.pad != null ? cfg.pad : heightAt(ex.x + ex.nx * 2, ex.z + ex.nz * 2)) };
    }
    o.c = b.c;
    o.campus = 1;
  } else {
    o.kind = b.kind;
    o.base = r1(minH);
    o.top = r1(maxH + b.h);
    if (b.label) o.label = b.label;
  }
  outBuildings.push(o);
}

// ---------- 출력 ----------
const q = new Int16Array(N);
let hMin = Infinity;
let hMax = -Infinity;
for (let c = 0; c < N; c++) {
  q[c] = Math.round(H[c] * 20);
  hMin = Math.min(hMin, H[c]);
  hMax = Math.max(hMax, H[c]);
}
const b64 = Buffer.from(q.buffer).toString('base64');

const data = {
  origin: ORIGIN,
  credit: '지도 자료 © OpenStreetMap contributors (ODbL) · 고도 SRTM',
  domain: { x0: X0, z0: Z0, step: STEP, nx: NX, nz: NZ },
  campus,
  buildings: outBuildings,
  roads: roads.map((r) => {
    const o = { kind: r.kind, w: r.w, pts: r.pts };
    if (r.inCampus) o.inCampus = 1;
    if (r.conveying) o.conveying = 1;
    if (r.bridge) o.bridge = 1;
    if (r.name) o.name = r.name;
    return o;
  }),
  areas: areas.map((a) => {
    const o = { kind: a.kind, poly: a.poly };
    if (a.inCampus) o.inCampus = 1;
    if (a.pad != null) o.pad = a.pad;
    return o;
  }),
  pois,
  heights: b64,
};
const outFile = path.join(ROOT, 'data/campus-data.js');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(
  outFile,
  '// 자동 생성 파일 — 직접 고치지 말 것 (node tools/build-campus.mjs)\n// 지도 자료 © OpenStreetMap contributors (ODbL), 고도 SRTM\nexport default ' + JSON.stringify(data) + ';\n',
);

const campusB = outBuildings.filter((b) => b.campus);
console.log('건물', outBuildings.length, '(캠퍼스', campusB.length + ')', '도로', roads.length, '면', areas.length, '지점', pois.length);
console.log('지형', NX + 'x' + NZ, '높이', hMin.toFixed(1), '~', hMax.toFixed(1), 'm');
for (const b of campusB) console.log(' ', b.letter, b.name.padEnd(6), 'base', b.base, 'top', b.top, 'low', b.low, 'door', b.door ? `${b.door.x},${b.door.z} y${b.door.y}` : '-');
console.log('출력', path.relative(ROOT, outFile), (fs.statSync(outFile).size / 1024).toFixed(0) + 'KB');
