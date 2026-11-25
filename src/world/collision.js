// 2D(XZ 평면) 충돌: 벽 선분과 원(캐릭터)을 다룬다. 선분은 격자에 넣어 빠르게 찾는다.
import { inPoly, bboxOf } from './geom.js';

export class Collider {
  constructor(cell = 8) {
    this.cell = cell;
    this.map = new Map();
    this.segs = []; // [ax,az,bx,bz] 평탄 배열
    this.circles = []; // [x,z,r]
    this.solids = []; // {poly, bb, top, base}
  }

  _key(i, k) {
    return i * 4096 + k;
  }

  _put(i0, k0, i1, k1, id) {
    for (let i = i0; i <= i1; i++) {
      for (let k = k0; k <= k1; k++) {
        const key = this._key(i, k);
        let a = this.map.get(key);
        if (!a) this.map.set(key, (a = []));
        a.push(id);
      }
    }
  }

  addSeg(ax, az, bx, bz) {
    const id = this.segs.length / 4;
    this.segs.push(ax, az, bx, bz);
    const c = this.cell;
    this._put(Math.floor((Math.min(ax, bx) - 1) / c), Math.floor((Math.min(az, bz) - 1) / c), Math.floor((Math.max(ax, bx) + 1) / c), Math.floor((Math.max(az, bz) + 1) / c), id);
  }

  /** 닫힌 다각형(건물 평면). top/base는 카메라 가림 판정에 쓴다. */
  addPoly(poly, top = Infinity, base = -Infinity) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      this.addSeg(a[0], a[1], b[0], b[1]);
    }
    this.solids.push({ poly, bb: bboxOf(poly), top, base });
  }

  addBox(x0, z0, x1, z1, top = Infinity) {
    this.addPoly(
      [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ],
      top,
    );
  }

  addCircle(x, z, r) {
    const id = -(this.circles.length / 3) - 1; // 음수 id = 원
    this.circles.push(x, z, r);
    const c = this.cell;
    this._put(Math.floor((x - r - 1) / c), Math.floor((z - r - 1) / c), Math.floor((x + r + 1) / c), Math.floor((z + r + 1) / c), id);
  }

  /** p={x,z}를 반지름 r인 원으로 보고 벽 밖으로 밀어낸다. 부딪혔으면 true */
  resolve(p, r) {
    let hit = false;
    const c = this.cell;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      const i0 = Math.floor((p.x - r) / c);
      const i1 = Math.floor((p.x + r) / c);
      const k0 = Math.floor((p.z - r) / c);
      const k1 = Math.floor((p.z + r) / c);
      for (let i = i0; i <= i1; i++) {
        for (let k = k0; k <= k1; k++) {
          const list = this.map.get(this._key(i, k));
          if (!list) continue;
          for (let q = 0; q < list.length; q++) {
            const id = list[q];
            if (id < 0) {
              const o = (-id - 1) * 3;
              const dx = p.x - this.circles[o];
              const dz = p.z - this.circles[o + 1];
              const rr = r + this.circles[o + 2];
              const d2 = dx * dx + dz * dz;
              if (d2 < rr * rr) {
                const d = Math.sqrt(d2) || 0.0001;
                p.x = this.circles[o] + (dx / d) * rr;
                p.z = this.circles[o + 1] + (dz / d) * rr;
                moved = hit = true;
              }
              continue;
            }
            const o = id * 4;
            const ax = this.segs[o];
            const az = this.segs[o + 1];
            const bx = this.segs[o + 2];
            const bz = this.segs[o + 3];
            const ex = bx - ax;
            const ez = bz - az;
            const l2 = ex * ex + ez * ez;
            let t = l2 ? ((p.x - ax) * ex + (p.z - az) * ez) / l2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = ax + t * ex;
            const qz = az + t * ez;
            const dx = p.x - qx;
            const dz = p.z - qz;
            const d2 = dx * dx + dz * dz;
            if (d2 < r * r) {
              const d = Math.sqrt(d2);
              if (d > 1e-5) {
                p.x = qx + (dx / d) * r;
                p.z = qz + (dz / d) * r;
              } else {
                const l = Math.sqrt(l2) || 1;
                p.x = qx + (ez / l) * r;
                p.z = qz - (ex / l) * r;
              }
              moved = hit = true;
            }
          }
        }
      }
      if (!moved) break;
    }
    return hit;
  }

  /** (x,z)가 들어 있는 건물(없으면 null) */
  solidAt(x, z) {
    for (let i = 0; i < this.solids.length; i++) {
      const s = this.solids[i];
      const bb = s.bb;
      if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue;
      if (inPoly(x, z, s.poly)) return s;
    }
    return null;
  }
}
