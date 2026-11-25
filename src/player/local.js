// 내 캐릭터: 입력 → 이동(충돌·경사·무빙워크) → 점프·낙하 → 아바타 동작.
import * as THREE from 'three';
import { PLAYER, SPAWN } from '../config.js';
import { Avatar } from './avatar.js';

const tmp = { x: 0, z: 0 };

export function createLocalPlayer(engine, input, world, cam, profile) {
  const avatar = new Avatar(profile, 'me');
  engine.scene.add(avatar.group);
  const listeners = {};
  const p = {
    avatar,
    pos: new THREE.Vector3(),
    vy: 0,
    yaw: Math.PI,
    zone: 'campus',
    onGround: true,
    speed: 0,
    moving: false,
    running: false,
    stamina: 1,
    tired: false,
    frozen: false, // 패널·미니게임 중에는 멈춘다
    odometer: 0,
    on(name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
    },
    emit(name, arg) {
      for (const f of listeners[name] || []) f(arg);
    },
    /** 구역 이동 또는 순간이동 */
    place(zoneId, x, z, yaw) {
      if (zoneId !== p.zone || world.active.id !== zoneId) {
        world.setZone(zoneId);
        p.zone = zoneId;
        p.emit('zone', zoneId);
      }
      p.pos.set(x, world.active.heightAt(x, z), z);
      p.vy = 0;
      p.onGround = true;
      if (yaw != null) p.yaw = yaw;
      avatar.group.position.copy(p.pos);
      avatar.group.rotation.y = p.yaw;
    },
    update(dt) {
      const zone = world.active;
      const R = PLAYER.radius;
      let mx = input.moveX;
      let my = input.moveY;
      let mag = Math.hypot(mx, my);
      if (mag > 1) {
        mx /= mag;
        my /= mag;
        mag = 1;
      }
      const fx = cam.forward.x;
      const fz = cam.forward.z;
      let dx = fx * my - fz * mx;
      let dz = fz * my + fx * mx;
      const moving = mag > 0.05 && !p.frozen;
      const run = moving && input.run && !p.tired;
      let speed = 0;
      let sd = 0;
      if (moving) {
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl;
        dz /= dl;
        speed = (run ? PLAYER.run : PLAYER.walk) * Math.min(1, mag * 1.15);
        if (!zone.interior && p.onGround) {
          const s = zone.slopeAt(p.pos.x, p.pos.z);
          sd = s.dx * dx + s.dz * dz; // 진행 방향 경사(오르막 +)
          speed *= sd > 0 ? 1 / (1 + sd * 1.4) : Math.min(1.18, 1 - sd * 0.35);
        }
      }
      // 체력: 달리면 줄고(오르막은 더 빨리), 쉬면 찬다
      if (run) {
        p.stamina -= dt * (0.05 + Math.max(0, sd) * 0.4);
        if (p.stamina <= 0) {
          p.stamina = 0;
          p.tired = true;
          p.emit('tired');
        }
      } else p.stamina = Math.min(1, p.stamina + dt * (moving ? 0.11 : 0.3));
      if (p.tired && p.stamina > 0.35) p.tired = false;

      // 무빙워크·에스컬레이터 위에서는 실려 간다
      let vx = dx * speed;
      let vz = dz * speed;
      const cv = zone.conveyorAt && p.onGround && !p.frozen ? zone.conveyorAt(p.pos.x, p.pos.z) : null;
      if (cv) {
        vx += cv.dx * cv.speed;
        vz += cv.dz * cv.speed;
      }
      p.onConveyor = !!cv;

      const dist = Math.hypot(vx, vz) * dt;
      let moved = 0;
      if (dist > 1e-5) {
        const n = Math.max(1, Math.ceil(dist / 0.22));
        const sx = (vx * dt) / n;
        const sz = (vz * dt) / n;
        for (let i = 0; i < n; i++) {
          const ox = p.pos.x;
          const oz = p.pos.z;
          const feet = p.onGround ? zone.heightAt(ox, oz) : p.pos.y;
          const ok = (x, z) => {
            if (!zone.playable(x, z)) return false;
            if (zone.collider.solidAt(x, z)) return false;
            const gh = zone.heightAt(x, z);
            const st = Math.hypot(x - ox, z - oz);
            // 옹벽처럼 가파른 곳은 못 오른다
            return gh - feet <= (p.onGround ? st * 1.6 + 0.03 : 0.35);
          };
          tmp.x = ox + sx;
          tmp.z = oz + sz;
          zone.collider.resolve(tmp, R);
          if (!ok(tmp.x, tmp.z)) {
            // 축을 나눠 미끄러지듯 시도
            tmp.x = ox + sx;
            tmp.z = oz;
            zone.collider.resolve(tmp, R);
            if (!ok(tmp.x, tmp.z)) {
              tmp.x = ox;
              tmp.z = oz + sz;
              zone.collider.resolve(tmp, R);
              if (!ok(tmp.x, tmp.z)) break;
            }
          }
          moved += Math.hypot(tmp.x - ox, tmp.z - oz);
          p.pos.x = tmp.x;
          p.pos.z = tmp.z;
        }
      }

      // 수직: 점프·낙하
      const ground = zone.heightAt(p.pos.x, p.pos.z);
      if (p.onGround) {
        if (input.jump && !p.frozen) {
          p.vy = PLAYER.jump;
          p.onGround = false;
          p.emit('jump');
        } else if (p.pos.y - ground > 0.75) {
          p.onGround = false;
          p.vy = 0;
        } else p.pos.y = ground;
      }
      if (!p.onGround) {
        p.vy -= PLAYER.gravity * dt;
        p.pos.y += p.vy * dt;
        if (p.pos.y <= ground) {
          p.pos.y = ground;
          p.onGround = true;
          if (p.vy < -13) {
            cam.shake = Math.min(0.9, -p.vy * 0.03);
            p.emit('land', -p.vy);
          }
          p.vy = 0;
        }
      }

      if (moving) {
        let diff = Math.atan2(dx, dz) - p.yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        p.yaw += diff * Math.min(1, dt * 12);
      }
      p.moving = moved > 0.0005;
      p.running = run && p.moving;
      p.speed = dt > 0 ? moved / dt : 0;
      p.odometer += moved;
      avatar.group.position.copy(p.pos);
      avatar.group.rotation.y = p.yaw;
      avatar.update(dt, cv && !moving ? 0 : moved, cv && !moving ? 0 : p.speed, !p.onGround);
    },
  };
  p.place('campus', SPAWN.x, SPAWN.z, Math.PI);
  return p;
}
