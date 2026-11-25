// 화면 효과: 축제 불꽃, 수집 반짝임.
import * as THREE from 'three';

function dotTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(cv);
}

export function createFx(engine) {
  const MAX = 2400;
  const pos = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 3);
  const vel = new Float32Array(MAX * 3);
  const base = new Float32Array(MAX * 3);
  const life = new Float32Array(MAX);
  const dur = new Float32Array(MAX);
  const grav = new Float32Array(MAX);
  let head = 0;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ map: dotTexture(), size: 2.6, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  pts.frustumCulled = false;
  pts.renderOrder = 30;
  engine.scene.add(pts);
  for (let i = 0; i < MAX; i++) pos[i * 3 + 1] = -9999;

  const rockets = []; // {x,y,z,vy,t,color}
  const c = new THREE.Color();

  function spawn(x, y, z, vx, vy, vz, color, d, g = 6) {
    const i = head;
    head = (head + 1) % MAX;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    vel[i * 3] = vx;
    vel[i * 3 + 1] = vy;
    vel[i * 3 + 2] = vz;
    base[i * 3] = color.r;
    base[i * 3 + 1] = color.g;
    base[i * 3 + 2] = color.b;
    life[i] = d;
    dur[i] = d;
    grav[i] = g;
  }

  function burst(x, y, z, hue, n = 210, speed = 15) {
    for (let i = 0; i < n; i++) {
      // 구면에 고르게
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const sp = speed * (0.75 + Math.random() * 0.35);
      c.setHSL((hue + Math.random() * 0.06) % 1, 1, 0.6);
      spawn(x, y, z, Math.cos(a) * s * sp, u * sp, Math.sin(a) * s * sp, c, 1.3 + Math.random() * 0.9);
    }
  }

  const api = {
    onBoom: null,
    /** 불꽃 한 발: 땅에서 솟아 터진다 */
    firework(x, y, z, hue = Math.random()) {
      for (let k = 0; k < 3; k++) rockets.push({ x: x + (Math.random() - 0.5) * 14, y, z: z + (Math.random() - 0.5) * 14, vy: 30 + Math.random() * 6, t: -k * 0.45, top: y + 38 + Math.random() * 14, hue: (hue + k * 0.17) % 1 });
    },
    /** 수집·스탬프 반짝임 */
    sparkle(x, y, z, hex = 0xffd23f, n = 26) {
      c.setHex(hex);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        spawn(x, y, z, Math.cos(a) * (1 + Math.random() * 3), 2 + Math.random() * 4, Math.sin(a) * (1 + Math.random() * 3), c, 0.6 + Math.random() * 0.5, 9);
      }
    },
    update(dt) {
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.t += dt;
        if (r.t < 0) continue;
        r.y += r.vy * dt;
        c.setHSL(0.12, 1, 0.75);
        spawn(r.x, r.y, r.z, (Math.random() - 0.5) * 1.5, -2, (Math.random() - 0.5) * 1.5, c, 0.35, 2);
        if (r.y >= r.top) {
          burst(r.x, r.y, r.z, r.hue);
          rockets.splice(i, 1);
          if (api.onBoom) api.onBoom();
        }
      }
      for (let i = 0; i < MAX; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        const o = i * 3;
        if (life[i] <= 0) {
          pos[o + 1] = -9999;
          continue;
        }
        vel[o + 1] -= grav[i] * dt;
        const drag = Math.exp(-dt * 1.6);
        vel[o] *= drag;
        vel[o + 1] *= drag;
        vel[o + 2] *= drag;
        pos[o] += vel[o] * dt;
        pos[o + 1] += vel[o + 1] * dt;
        pos[o + 2] += vel[o + 2] * dt;
        const k = Math.min(1, (life[i] / dur[i]) * 1.6);
        col[o] = base[o] * k;
        col[o + 1] = base[o + 1] * k;
        col[o + 2] = base[o + 2] * k;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
  return api;
}
