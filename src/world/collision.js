// 2D(XZ 평면) 충돌: 벽 선분과 원(캐릭터)을 다룬다. 선분은 격자에 넣어 빠르게 찾는다.
import { inPoly, bboxOf } from './geom.js';

export class Collider {
  constructor(cell = 8) {
    this.cell = cell;
    this.map = new Map();
    this.segs = []; // [ax,az,bx,bz] 평탄 배열
    this.segSolid = []; // 선분마다 그 선분이 속한 solid 번호(어느 solid 것도 아니면 -1)
    this.circles = []; // [x,z,r]
    this.circleOn = []; // 원마다 1(켜짐)·0(꺼짐). 꺼진 원은 resolve가 건너뛴다
    this.solids = []; // {poly, bb, top, base, tag, index}
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

  addSeg(ax, az, bx, bz, solid = -1) {
    const id = this.segs.length / 4;
    this.segs.push(ax, az, bx, bz);
    this.segSolid.push(solid);
    const c = this.cell;
    this._put(Math.floor((Math.min(ax, bx) - 1) / c), Math.floor((Math.min(az, bz) - 1) / c), Math.floor((Math.max(ax, bx) + 1) / c), Math.floor((Math.max(az, bz) + 1) / c), id);
  }

  /**
   * 닫힌 다각형(건물 평면). top/base는 카메라 가림 판정에 쓴다.
   * tag는 이 덩어리가 무엇인지 알려 주는 이름표(캠퍼스 건물은 건물 key, 그 밖은 null).
   * 만든 solid 객체를 돌려준다(solids 배열에 든 바로 그 객체).
   */
  addPoly(poly, top = Infinity, base = -Infinity, tag = null) {
    const index = this.solids.length;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      this.addSeg(a[0], a[1], b[0], b[1], index);
    }
    const solid = { poly, bb: bboxOf(poly), top, base, tag, index };
    this.solids.push(solid);
    return solid;
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

  /** 원(나무·기둥·주차 차량 등). 원 번호(0부터)를 돌려준다. */
  addCircle(x, z, r) {
    const ci = this.circles.length / 3;
    const id = -ci - 1; // 음수 id = 원
    this.circles.push(x, z, r);
    this.circleOn.push(1);
    const c = this.cell;
    this._put(Math.floor((x - r - 1) / c), Math.floor((z - r - 1) / c), Math.floor((x + r + 1) / c), Math.floor((z + r + 1) / c), id);
    return ci;
  }

  /** 원을 켜고 끈다. 꺼진 원은 resolve에서 없는 것으로 친다(주차 차량이 사라졌다 돌아올 때). */
  setCircleEnabled(ci, on) {
    if (Number.isInteger(ci) && ci >= 0 && ci < this.circleOn.length) this.circleOn[ci] = on ? 1 : 0;
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
              const ci = -id - 1;
              if (!this.circleOn[ci]) continue;
              const o = ci * 3;
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

  /**
   * 선분 a→b가 가장 먼저 만나는 벽 선분을 찾는다(원은 보지 않는다).
   * 돌려주는 값: { t, x, z, solid } — t는 a에서 b까지의 비율(0~1), solid는 그 벽이 속한 solid(없으면 null).
   * 만나는 벽이 없으면 null. 선분이 지나는 격자 칸만 차례로 훑는다.
   */
  raycast(ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (!(len2 > 0) || len2 === Infinity) return null; // 길이 0이거나 수가 아닌 입력
    const c = this.cell;
    let i = Math.floor(ax / c);
    let k = Math.floor(az / c);
    const si = dx > 0 ? 1 : -1;
    const sk = dz > 0 ? 1 : -1;
    // 한 칸을 건너는 데 드는 t와, 다음 격자선을 넘는 t
    const di = dx !== 0 ? c / Math.abs(dx) : Infinity;
    const dk = dz !== 0 ? c / Math.abs(dz) : Infinity;
    let ti = dx !== 0 ? (dx > 0 ? (i + 1) * c - ax : ax - i * c) / Math.abs(dx) : Infinity;
    let tk = dz !== 0 ? (dz > 0 ? (k + 1) * c - az : az - k * c) / Math.abs(dz) : Infinity;
    let best = Infinity;
    let hit = -1;
    // 칸 수 상한: 아주 긴 선분이 들어와도 멈춘다(8m 칸이면 30km 남짓)
    for (let guard = 0; guard < 4096; guard++) {
      const list = this.map.get(this._key(i, k));
      if (list) {
        for (let q = 0; q < list.length; q++) {
          const id = list[q];
          if (id < 0) continue;
          const o = id * 4;
          const px = this.segs[o];
          const pz = this.segs[o + 1];
          const ex = this.segs[o + 2] - px;
          const ez = this.segs[o + 3] - pz;
          const den = dx * ez - dz * ex;
          if (den === 0) continue; // 나란한 벽
          const wx = px - ax;
          const wz = pz - az;
          const t = (wx * ez - wz * ex) / den;
          if (!(t >= 0 && t <= 1) || t >= best) continue;
          const u = (wx * dz - wz * dx) / den;
          if (u < -1e-9 || u > 1 + 1e-9) continue; // 모서리 틈으로 새지 않게 아주 조금 넉넉히
          best = t;
          hit = id;
        }
      }
      // 이 칸을 벗어나기 전에 맞았으면 더 가까운 벽은 없다(벽 선분은 닿는 칸마다 들어 있다)
      const out = ti < tk ? ti : tk;
      if (best <= out || out > 1) break;
      if (ti < tk) {
        i += si;
        ti += di;
      } else {
        k += sk;
        tk += dk;
      }
    }
    if (hit < 0) return null;
    const s = this.segSolid[hit];
    return { t: best, x: ax + dx * best, z: az + dz * best, solid: s >= 0 ? this.solids[s] : null };
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
