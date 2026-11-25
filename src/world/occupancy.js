// 지면 용도 격자(2m): 나무·소품·수집품을 놓을 자리를 고를 때 쓴다.
import data from '../../data/campus-data.js';
import { grid } from './heightfield.js';
import { inPoly, distPolyEdge, bboxOf, resample } from './geom.js';

export const OCC = { GRASS: 0, BUILDING: 1, ROAD: 2, PARKING: 3, PAD: 4, WOOD: 5, WATER: 6 };

const { X0, Z0, STEP, NX, NZ } = grid;
export const occ = new Uint8Array(NX * NZ);
/** 캠퍼스 경계 안이면 1, 경계 밖 가까운 띠(걸어 다닐 수 있음)는 2, 그 밖은 0 */
export const zoneMask = new Uint8Array(NX * NZ);

function fillPoly(poly, value, margin = 0, only = null) {
  const bb = bboxOf(poly);
  const i0 = Math.max(0, Math.floor((bb[0] - margin - X0) / STEP));
  const i1 = Math.min(NX - 1, Math.ceil((bb[2] + margin - X0) / STEP));
  const k0 = Math.max(0, Math.floor((bb[1] - margin - Z0) / STEP));
  const k1 = Math.min(NZ - 1, Math.ceil((bb[3] + margin - Z0) / STEP));
  for (let k = k0; k <= k1; k++) {
    for (let i = i0; i <= i1; i++) {
      const x = X0 + i * STEP;
      const z = Z0 + k * STEP;
      const c = k * NX + i;
      if (only != null && occ[c] !== only) continue;
      if (inPoly(x, z, poly) || (margin > 0 && distPolyEdge(x, z, poly) <= margin)) occ[c] = value;
    }
  }
}

const WALK_MARGIN = 26; // 캠퍼스 경계 밖으로 나갈 수 있는 거리(m)

(function build() {
  for (const a of data.areas) if (a.kind === 'wood') fillPoly(a.poly, OCC.WOOD);
  for (const a of data.areas) if (a.kind === 'water') fillPoly(a.poly, OCC.WATER);
  for (const a of data.areas) if (a.kind === 'parking') fillPoly(a.poly, OCC.PARKING);
  for (const a of data.areas) if (a.kind === 'field' || a.kind === 'court' || a.kind === 'square' || a.kind === 'golf') fillPoly(a.poly, OCC.PAD);
  for (const r of data.roads) {
    if (r.bridge) continue;
    const rad = r.w / 2 + 0.6;
    for (const s of resample(r.pts, 1)) {
      const i0 = Math.max(0, Math.floor((s[0] - rad - X0) / STEP));
      const i1 = Math.min(NX - 1, Math.ceil((s[0] + rad - X0) / STEP));
      const k0 = Math.max(0, Math.floor((s[1] - rad - Z0) / STEP));
      const k1 = Math.min(NZ - 1, Math.ceil((s[1] + rad - Z0) / STEP));
      for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) if (Math.hypot(X0 + i * STEP - s[0], Z0 + k * STEP - s[1]) <= rad) occ[k * NX + i] = OCC.ROAD;
    }
  }
  for (const b of data.buildings) fillPoly(b.poly, OCC.BUILDING, 2.5);

  const cb = bboxOf(data.campus);
  for (let k = 0; k < NZ; k++) {
    for (let i = 0; i < NX; i++) {
      const x = X0 + i * STEP;
      const z = Z0 + k * STEP;
      if (x < cb[0] - WALK_MARGIN || x > cb[2] + WALK_MARGIN || z < cb[1] - WALK_MARGIN || z > cb[3] + WALK_MARGIN) continue;
      if (inPoly(x, z, data.campus)) zoneMask[k * NX + i] = 1;
      else if (distPolyEdge(x, z, data.campus) <= WALK_MARGIN) zoneMask[k * NX + i] = 2;
    }
  }
})();

export function occAt(x, z) {
  const i = Math.round((x - X0) / STEP);
  const k = Math.round((z - Z0) / STEP);
  if (i < 0 || k < 0 || i >= NX || k >= NZ) return OCC.WOOD;
  return occ[k * NX + i];
}

export function zoneAt(x, z) {
  const i = Math.round((x - X0) / STEP);
  const k = Math.round((z - Z0) / STEP);
  if (i < 0 || k < 0 || i >= NX || k >= NZ) return 0;
  return zoneMask[k * NX + i];
}
