// 지형 높이 격자: campus-data.js의 base64(Int16, 5cm 단위)를 풀고 쌍선형 보간으로 높이를 돌려준다.
import data from '../../data/campus-data.js';

const { x0: X0, z0: Z0, step: STEP, nx: NX, nz: NZ } = data.domain;

function decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const q = new Int16Array(bytes.buffer);
  const h = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) h[i] = q[i] / 20;
  return h;
}

export const H = decode(data.heights);
export const grid = { X0, Z0, STEP, NX, NZ, X1: X0 + (NX - 1) * STEP, Z1: Z0 + (NZ - 1) * STEP };

/** 지면 높이(m). 범위를 벗어나면 가장자리 값. */
export function heightAt(x, z) {
  let fx = (x - X0) / STEP;
  let fz = (z - Z0) / STEP;
  if (fx < 0) fx = 0;
  else if (fx > NX - 1.001) fx = NX - 1.001;
  if (fz < 0) fz = 0;
  else if (fz > NZ - 1.001) fz = NZ - 1.001;
  const i = fx | 0;
  const k = fz | 0;
  const tx = fx - i;
  const tz = fz - k;
  const c = k * NX + i;
  return (H[c] * (1 - tx) + H[c + 1] * tx) * (1 - tz) + (H[c + NX] * (1 - tx) + H[c + NX + 1] * tx) * tz;
}

/** 지면 법선의 기울기(수평 1m당 높이 변화) */
export function slopeAt(x, z) {
  const e = 1.0;
  const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
  const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  return { dx, dz, mag: Math.hypot(dx, dz) };
}
