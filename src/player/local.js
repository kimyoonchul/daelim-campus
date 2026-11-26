// 내 캐릭터: 입력 → 이동(충돌·경사·무빙워크·넉백) → 점프·낙하 → 아바타 동작. 차에 타면 차를 따라다닌다.
import * as THREE from 'three';
import { PLAYER, SPAWN } from '../config.js';
import { Avatar } from './avatar.js';

const tmp = { x: 0, z: 0 };
const MAX_KNOCK = 16; // 넉백 속도 상한(m/s). mayhem/rules.js의 LIMITS.maxKnock과 같은 값
const KNOCK_DECAY = 3.2; // 넉백이 줄어드는 빠르기(1/초): exp(-3.2·dt)
const KNOCK_STOP = 0.05; // 이보다 느려지면 넉백이 끝난 것으로 본다(m/s)

export function createLocalPlayer(engine, input, world, cam, profile) {
  const avatar = new Avatar(profile, 'me');
  engine.scene.add(avatar.group);
  const listeners = {};
  let riding = false; // 탑승 때문에 아바타를 숨겨 둔 상태인지
  let koShown = false; // 아바타에 마지막으로 알린 기절 상태
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
    knock: { x: 0, z: 0 }, // 넉백 속도(m/s). 입력과 따로 쌓였다가 서서히 줄어든다(impulse로 넣는다)
    ko: false, // 기절 중(mayhem이 설정): 입력을 받지 않고 쓰러져 있다
    mount: null, // 탑승 중이면 { x, y, z, yaw } — 차량 모듈이 넣고 매 프레임 갱신하며, 내릴 때 null로 되돌린다
    speedMul: 1, // 걷기·달리기 속도 배율(무거운 무기·감속 효과. mayhem이 설정)
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
      p.knock.x = p.knock.z = 0; // 옮겨 놓으면 밀려나던 것도 끝난다(탑승 상태 mount는 차량 모듈이 푼다)
      if (yaw != null) p.yaw = yaw;
      avatar.group.position.copy(p.pos);
      avatar.group.rotation.y = p.yaw;
    },
    /** 밀쳐 내기: 수평 속도(vx, vz)를 넉백에 더하고(크기는 MAX_KNOCK까지), vy가 양수면 공중으로 띄운다 */
    impulse(vx, vy, vz) {
      if (Number.isFinite(vx) && Number.isFinite(vz)) {
        let kx = p.knock.x + vx;
        let kz = p.knock.z + vz;
        const m = Math.hypot(kx, kz);
        if (m > MAX_KNOCK) {
          kx *= MAX_KNOCK / m;
          kz *= MAX_KNOCK / m;
        }
        p.knock.x = kx;
        p.knock.z = kz;
      }
      if (Number.isFinite(vy) && vy > 0) {
        p.vy = Math.min(MAX_KNOCK, Math.max(p.vy, vy));
        p.onGround = false;
      }
    },
    update(dt) {
      // 기절 상태가 바뀌면 아바타에 알린다(쓰러짐·일어남)
      if (!!p.ko !== koShown) {
        koShown = !!p.ko;
        avatar.setKO(koShown);
      }
      // 탑승 중: 차량 모듈이 알려 준 자리에 붙어 다닌다. 걷기·충돌·중력은 쉬고 체력만 회복한다.
      if (p.mount) {
        const m = p.mount;
        if (Number.isFinite(m.x) && Number.isFinite(m.z)) p.pos.set(m.x, Number.isFinite(m.y) ? m.y : world.active.heightAt(m.x, m.z), m.z);
        if (Number.isFinite(m.yaw)) p.yaw = m.yaw;
        p.vy = 0;
        p.onGround = true;
        p.knock.x = p.knock.z = 0;
        p.moving = false;
        p.running = false;
        p.speed = 0;
        p.onConveyor = false;
        p.stamina = Math.min(1, p.stamina + dt * 0.3);
        if (p.tired && p.stamina > 0.35) p.tired = false;
        riding = true;
        avatar.group.visible = false;
        avatar.group.position.copy(p.pos);
        avatar.group.rotation.y = p.yaw;
        avatar.update(dt, 0, 0, false); // 안 보여도 말풍선·번쩍임 타이머는 흐르게
        return;
      }
      if (riding) {
        // 내렸다: 숨겨 둔 아바타를 다시 보인다
        riding = false;
        avatar.group.visible = true;
      }
      const zone = world.active;
      const R = PLAYER.radius;
      const still = p.frozen || p.ko; // 패널·미니게임·기절: 입력을 받지 않는다(중력과 넉백은 그대로 받는다)
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
      const moving = mag > 0.05 && !still;
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
        speed *= p.speedMul >= 0 && p.speedMul <= 3 ? p.speedMul : 1; // 이상한 값이 들어오면 원래 속도로
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
      const cv = zone.conveyorAt && p.onGround && !still ? zone.conveyorAt(p.pos.x, p.pos.z) : null;
      if (cv) {
        vx += cv.dx * cv.speed;
        vz += cv.dz * cv.speed;
      }
      p.onConveyor = !!cv;

      // 넉백: 입력·무빙워크 속도에 얹어 아래의 같은 충돌 판정으로 움직인다(건물 안·옹벽 위로는 못 밀려 간다)
      const kn = p.knock;
      if (!Number.isFinite(kn.x) || !Number.isFinite(kn.z)) kn.x = kn.z = 0;
      const ks = Math.hypot(kn.x, kn.z);
      const os = ks > 0 ? Math.hypot(vx, vz) : 0; // 내 발(입력·무빙워크)로 내는 속력. 넉백 중일 때만 쓴다
      if (ks > 0) {
        // 이번 프레임에 밀리는 속도는 줄어드는 속도의 평균(적분)으로 잡는다 — 프레임 속도와 상관없이 모두 v/3.2 m 밀린다
        const a = KNOCK_DECAY * dt;
        const avg = a > 1e-6 ? -Math.expm1(-a) / a : 1;
        vx += kn.x * avg;
        vz += kn.z * avg;
        const decay = Math.exp(-a);
        const keep = ks * decay < KNOCK_STOP ? 0 : decay; // 충분히 느려지면 0으로 끊는다
        kn.x *= keep;
        kn.z *= keep;
      }

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
      // 밀려서 간 거리는 걸은 것이 아니다: 걷기 동작·속도·이동 거리(odometer)에는 내 발로 간 몫만 남긴다.
      // 실제로 간 비율(moved ÷ dist, 벽에 막히면 줄어든다)만큼 내 속력으로 걸은 셈이다.
      if (ks > 0) moved = dist > 1e-5 ? Math.min((moved / dist) * os * dt, os * dt) : 0;

      // 수직: 점프·낙하
      const ground = zone.heightAt(p.pos.x, p.pos.z);
      if (p.onGround) {
        if (input.jump && !still) {
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
