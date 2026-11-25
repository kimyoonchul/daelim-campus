// 기하 도우미: 다각형 연산과, 여러 조각을 한 메시로 모으는 빌더.
import * as THREE from 'three';

export function signedArea(p) {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return a / 2;
}

export function centroid(p) {
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

export function inPoly(x, z, p) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i];
    const b = p[j];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

export function distSeg(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l = dx * dx + dz * dz;
  let t = l ? ((x - ax) * dx + (z - az) * dz) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

export function distPolyEdge(x, z, p) {
  let d = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) d = Math.min(d, distSeg(x, z, p[j][0], p[j][1], p[i][0], p[i][1]));
  return d;
}

export function bboxOf(p) {
  let a = Infinity;
  let b = Infinity;
  let c = -Infinity;
  let d = -Infinity;
  for (const q of p) {
    if (q[0] < a) a = q[0];
    if (q[1] < b) b = q[1];
    if (q[0] > c) c = q[0];
    if (q[1] > d) d = q[1];
  }
  return [a, b, c, d];
}

/** 다각형을 안쪽으로 d만큼 줄인다(모서리 이등분선 방향). 넓이가 양수인 다각형 기준. */
export function insetPoly(p, d) {
  const n = p.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i + n - 1) % n];
    const b = p[i];
    const c = p[(i + 1) % n];
    // 변의 바깥 법선 (dz, -dx)
    let n1x = b[1] - a[1];
    let n1z = -(b[0] - a[0]);
    let n2x = c[1] - b[1];
    let n2z = -(c[0] - b[0]);
    const l1 = Math.hypot(n1x, n1z) || 1;
    const l2 = Math.hypot(n2x, n2z) || 1;
    n1x /= l1;
    n1z /= l1;
    n2x /= l2;
    n2z /= l2;
    let mx = n1x + n2x;
    let mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-4) {
      mx = n1x;
      mz = n1z;
    } else {
      mx /= ml;
      mz /= ml;
    }
    const cos = Math.max(0.35, mx * n1x + mz * n1z);
    out.push([b[0] - (mx * d) / cos, b[1] - (mz * d) / cos]);
  }
  return out;
}

/** 폴리라인을 일정 간격으로 다시 찍는다. [x,z,누적거리] 배열 */
export function resample(pts, step) {
  const out = [];
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / step));
    for (let s = 0; s < n; s++) out.push([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n, acc + (len * s) / n]);
    acc += len;
  }
  const l = pts[pts.length - 1];
  out.push([l[0], l[1], acc]);
  return out;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();

/** 여러 면을 모아 BufferGeometry 하나로 만든다. 색을 쓰면 정점 색이 들어간다. */
export class Geo {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.cr = 1;
    this.cg = 1;
    this.cb = 1;
    this.useColor = false;
  }

  color(hex) {
    this.useColor = true;
    const c = new THREE.Color(hex);
    this.cr = c.r;
    this.cg = c.g;
    this.cb = c.b;
    return this;
  }

  _v(x, y, z, nx, ny, nz, u, v) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(this.cr, this.cg, this.cb);
    return this.p.length / 3 - 1;
  }

  /** a,b,c,d: 앞에서 봤을 때 반시계 방향인 [x,y,z] 네 점 */
  quad(a, b, c, d, uvs) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    _n.crossVectors(_a, _b).normalize();
    const u = uvs || [0, 0, 1, 0, 1, 1, 0, 1];
    const i0 = this._v(a[0], a[1], a[2], _n.x, _n.y, _n.z, u[0], u[1]);
    this._v(b[0], b[1], b[2], _n.x, _n.y, _n.z, u[2], u[3]);
    this._v(c[0], c[1], c[2], _n.x, _n.y, _n.z, u[4], u[5]);
    this._v(d[0], d[1], d[2], _n.x, _n.y, _n.z, u[6], u[7]);
    this.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    return this;
  }

  tri(a, b, c) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_a, _b).normalize();
    const i0 = this._v(a[0], a[1], a[2], _n.x, _n.y, _n.z, 0, 0);
    this._v(b[0], b[1], b[2], _n.x, _n.y, _n.z, 1, 0);
    this._v(c[0], c[1], c[2], _n.x, _n.y, _n.z, 0.5, 1);
    this.idx.push(i0, i0 + 1, i0 + 2);
    return this;
  }

  /** 중심 (cx,cy,cz), 크기 (sx,sy,sz), y축 회전 rot 인 상자 */
  box(cx, cy, cz, sx, sy, sz, rot = 0) {
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const P = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
    this.quad(v[4], v[5], v[6], v[7]); // +z
    this.quad(v[1], v[0], v[3], v[2]); // -z
    this.quad(v[5], v[1], v[2], v[6]); // +x
    this.quad(v[0], v[4], v[7], v[3]); // -x
    this.quad(v[7], v[6], v[2], v[3]); // 위
    this.quad(v[0], v[1], v[5], v[4]); // 아래
    return this;
  }

  /**
   * 다각형 둘레를 따라 벽을 세운다. poly는 넓이가 양수인 [x,z] 배열.
   * bay: 창 한 칸의 가로 길이(m), v0/v1: 세로 UV 범위.
   */
  walls(poly, y0, y1, bay = 4, v0 = 0, v1 = 1) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.05) continue;
      const u1 = Math.max(1, Math.round(len / bay));
      this.quad([b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], [u1, v0, 0, v0, 0, v1, u1, v1]);
    }
    return this;
  }

  /** 다각형을 수평 뚜껑으로 덮는다(위를 향함). */
  cap(poly, y, uvScale = 0.25) {
    const contour = poly.map((q) => new THREE.Vector2(q[0], q[1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const base = this.p.length / 3;
    for (const q of poly) this._v(q[0], y, q[1], 0, 1, 0, q[0] * uvScale, q[1] * uvScale);
    for (const t of tris) {
      // (x,z) 평면에서 넓이 부호에 따라 위를 보도록 뒤집는다
      const a = poly[t[0]];
      const b = poly[t[1]];
      const c = poly[t[2]];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross > 0) this.idx.push(base + t[0], base + t[2], base + t[1]);
      else this.idx.push(base + t[0], base + t[1], base + t[2]);
    }
    return this;
  }

  /** 바깥 다각형(y0)에서 안쪽으로 줄인 다각형(y1)까지 경사 지붕 + 뚜껑 */
  hipRoof(poly, y0, inset, rise) {
    const inner = insetPoly(poly, inset);
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const ia = inner[i];
      const ib = inner[(i + 1) % n];
      this.quad([b[0], y0, b[1]], [a[0], y0, a[1]], [ia[0], y0 + rise, ia[1]], [ib[0], y0 + rise, ib[1]]);
    }
    this.cap(inner, y0 + rise);
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.useColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
