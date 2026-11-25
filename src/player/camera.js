// 3인칭 카메라: 주인공 주위를 돌고, 지형·건물에 가리면 당겨 온다.
import * as THREE from 'three';

const _head = new THREE.Vector3();
const _dir = new THREE.Vector3();

export function createFollowCamera(engine, input) {
  const cam = {
    yaw: 0, // 0이면 카메라가 남쪽(+z)에서 북쪽을 본다
    pitch: 0.32,
    dist: 8.5,
    cur: 8.5,
    shake: 0,
    minDist: 1.6,
    maxDist: 70,
    forward: { x: 0, z: -1 },
    update(dt, pos, zone) {
      const sens = input.touch ? 0.0062 : 0.0048;
      cam.yaw -= input.lookDX * sens;
      cam.pitch += input.lookDY * sens * 0.8;
      cam.pitch = Math.max(zone.pitchMin, Math.min(zone.pitchMax, cam.pitch));
      if (input.zoom) cam.dist = Math.max(cam.minDist, Math.min(zone.interior ? 22 : cam.maxDist, cam.dist * Math.exp(input.zoom * 0.11)));
      if (zone.interior && cam.dist > 22) cam.dist = 22;

      _head.set(pos.x, pos.y + 1.55, pos.z);
      const cp = Math.cos(cam.pitch);
      _dir.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);

      // 머리에서 카메라까지 가는 길에 막힌 곳이 있으면 그 앞까지만
      let want = cam.dist;
      const steps = 14;
      for (let i = 1; i <= steps; i++) {
        const d = (cam.dist * i) / steps;
        if (zone.cameraBlocked(_head.x + _dir.x * d, _head.y + _dir.y * d, _head.z + _dir.z * d)) {
          want = Math.max(cam.minDist * 0.6, (cam.dist * (i - 1)) / steps - 0.2);
          break;
        }
      }
      // 당길 때는 빨리, 풀 때는 천천히
      const rate = want < cam.cur ? 18 : 3.5;
      cam.cur += (want - cam.cur) * Math.min(1, dt * rate);
      const c = engine.camera;
      c.position.set(_head.x + _dir.x * cam.cur, _head.y + _dir.y * cam.cur, _head.z + _dir.z * cam.cur);
      if (cam.shake > 0.001) {
        c.position.x += (Math.random() - 0.5) * cam.shake;
        c.position.y += (Math.random() - 0.5) * cam.shake;
        cam.shake *= Math.exp(-dt * 7);
      }
      c.lookAt(_head);
      cam.forward.x = -Math.sin(cam.yaw);
      cam.forward.z = -Math.cos(cam.yaw);
    },
  };
  return cam;
}
