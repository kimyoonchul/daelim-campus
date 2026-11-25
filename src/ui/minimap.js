// 미니맵(북쪽이 위, 내 위치 중심)과 전체 지도.
import data from '../../data/campus-data.js';
import { grid } from '../world/heightfield.js';
import { bboxOf } from '../world/geom.js';

const S = 2; // 정적 지도 해상도(px/m)

export function createMinimap(world, cv) {
  const { X0, Z0, X1, Z1 } = grid;
  const stat = document.createElement('canvas');
  stat.width = (X1 - X0) * S;
  stat.height = (Z1 - Z0) * S;
  const g = stat.getContext('2d');
  g.drawImage(world.terrain.canvas, 0, 0, stat.width, stat.height);
  const px = (x) => (x - X0) * S;
  const pz = (z) => (z - Z0) * S;
  for (const b of data.buildings) {
    g.beginPath();
    b.poly.forEach((v, i) => (i ? g.lineTo(px(v[0]), pz(v[1])) : g.moveTo(px(v[0]), pz(v[1]))));
    g.closePath();
    g.fillStyle = b.campus ? '#f4f6fa' : 'rgba(150,158,168,0.9)';
    g.fill();
    g.strokeStyle = b.campus ? '#33475e' : 'rgba(60,70,80,0.7)';
    g.lineWidth = b.campus ? 2 : 1;
    g.stroke();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const b of data.buildings) {
    if (!b.campus || b.key === 'gate') continue;
    g.font = 'bold 15px "Malgun Gothic", sans-serif';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.strokeText(b.name, px(b.c[0]), pz(b.c[1]));
    g.fillStyle = '#1c2c40';
    g.fillText(b.name, px(b.c[0]), pz(b.c[1]));
  }

  const c = cv.getContext('2d');
  const W = cv.width;
  const VIEW = 82; // 반경(m)
  let frame = 0;

  const api = {
    /** markers: [{x,z,color,r}], others: [{x,z,color}] */
    draw(player, zone, others, markers) {
      if (frame++ % 3) return;
      c.clearRect(0, 0, W, W);
      if (zone.interior) {
        c.fillStyle = '#26303f';
        c.fillRect(0, 0, W, W);
        c.fillStyle = '#dfe8f5';
        c.font = 'bold 30px "Jua", "Malgun Gothic", sans-serif';
        c.textAlign = 'center';
        c.fillText('전산관', W / 2, W / 2 - 8);
        c.font = 'bold 24px "Malgun Gothic", sans-serif';
        c.fillStyle = '#7fd0ff';
        c.fillText(zone.name, W / 2, W / 2 + 30);
        return;
      }
      const k = W / (VIEW * 2);
      const sx = (player.pos.x - VIEW - X0) * S;
      const sz = (player.pos.z - VIEW - Z0) * S;
      c.fillStyle = '#35523a';
      c.fillRect(0, 0, W, W);
      c.drawImage(stat, sx, sz, VIEW * 2 * S, VIEW * 2 * S, 0, 0, W, W);
      const mx = (x) => (x - player.pos.x + VIEW) * k;
      const mz = (z) => (z - player.pos.z + VIEW) * k;
      for (const m of markers) {
        let x = mx(m.x);
        let z = mz(m.z);
        // 화면 밖 목표는 가장자리에 붙인다
        const dx = x - W / 2;
        const dz = z - W / 2;
        const d = Math.hypot(dx, dz);
        const lim = W / 2 - 16;
        if (d > lim) {
          x = W / 2 + (dx / d) * lim;
          z = W / 2 + (dz / d) * lim;
        }
        c.beginPath();
        c.arc(x, z, m.r || 8, 0, 7);
        c.fillStyle = m.color;
        c.fill();
        c.lineWidth = 3;
        c.strokeStyle = '#fff';
        c.stroke();
      }
      for (const o of others) {
        c.beginPath();
        c.arc(mx(o.x), mz(o.z), 8, 0, 7);
        c.fillStyle = o.color;
        c.fill();
        c.lineWidth = 3;
        c.strokeStyle = '#fff';
        c.stroke();
      }
      // 나: 바라보는 방향 화살표
      c.save();
      c.translate(W / 2, W / 2);
      c.rotate(Math.PI - player.yaw);
      c.beginPath();
      c.moveTo(0, -17);
      c.lineTo(12, 13);
      c.lineTo(0, 6);
      c.lineTo(-12, 13);
      c.closePath();
      c.fillStyle = '#ffd23f';
      c.fill();
      c.lineWidth = 3.5;
      c.strokeStyle = '#1b2433';
      c.stroke();
      c.restore();
      // 북쪽 표시
      c.fillStyle = 'rgba(16,24,38,0.75)';
      c.beginPath();
      c.arc(W / 2, 20, 15, 0, 7);
      c.fill();
      c.fillStyle = '#fff';
      c.font = 'bold 19px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('N', W / 2, 21);
    },
    /** 전체 지도 캔버스(패널용) */
    big(player, others, markers) {
      const bb = bboxOf(data.campus);
      const pad = 26;
      const x0 = bb[0] - pad;
      const z0 = bb[1] - pad;
      const w = bb[2] - bb[0] + pad * 2;
      const h = bb[3] - bb[1] + pad * 2;
      const out = document.createElement('canvas');
      out.width = Math.round(w * S);
      out.height = Math.round(h * S);
      out.className = 'bigmap';
      const b = out.getContext('2d');
      b.drawImage(stat, (x0 - X0) * S, (z0 - Z0) * S, w * S, h * S, 0, 0, out.width, out.height);
      const bx = (x) => (x - x0) * S;
      const bz = (z) => (z - z0) * S;
      const dot = (x, z, color, r) => {
        b.beginPath();
        b.arc(bx(x), bz(z), r, 0, 7);
        b.fillStyle = color;
        b.fill();
        b.lineWidth = 3;
        b.strokeStyle = '#fff';
        b.stroke();
      };
      for (const m of markers) dot(m.x, m.z, m.color, 9);
      for (const o of others) dot(o.x, o.z, o.color, 9);
      if (player) {
        dot(player.pos.x, player.pos.z, '#ffd23f', 12);
        b.font = 'bold 20px "Malgun Gothic", sans-serif';
        b.textAlign = 'center';
        b.lineWidth = 5;
        b.strokeStyle = '#1b2433';
        b.strokeText('나', bx(player.pos.x), bz(player.pos.z) - 20);
        b.fillStyle = '#ffd23f';
        b.fillText('나', bx(player.pos.x), bz(player.pos.z) - 20);
      }
      return out;
    },
  };
  return api;
}
