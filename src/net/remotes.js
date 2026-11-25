// 다른 접속자 아바타: 받은 위치를 0.24초 늦게 따라가며 부드럽게 보간한다.
import { Avatar } from '../player/avatar.js';

const DELAY = 0.24;
const ZONE_ID = { c: 'campus', j4: 'js4', j5: 'js5' };

export function createRemotes(engine, net, getZone) {
  const map = new Map(); // id → {avatar, snaps[], x,y,z,yaw, zone, emote}
  const api = {
    map,
    count: () => map.size,
    get: (id) => map.get(id),
    /** 화면 좌표 근처의 아바타를 찾는다(클릭으로 프로필 보기) */
    list: () => [...map.values()],
  };

  function ensure(id, peer) {
    let r = map.get(id);
    if (!r) {
      const avatar = new Avatar(peer.profile, id);
      avatar.group.visible = false;
      engine.scene.add(avatar.group);
      r = { id, avatar, snaps: [], x: 0, y: 0, z: 0, yaw: 0, zone: 'campus', emote: 0, placed: false, peer };
      map.set(id, r);
    }
    return r;
  }

  net.on('join', (id, peer) => {
    const r = ensure(id, peer);
    if (peer.state) push(r, peer.state);
  });
  net.on('profile', (id, peer) => {
    const r = map.get(id);
    if (r) r.avatar.setProfile(peer.profile);
  });
  net.on('leave', (id) => {
    const r = map.get(id);
    if (!r) return;
    engine.scene.remove(r.avatar.group);
    r.avatar.dispose();
    map.delete(id);
  });
  net.on('state', (id, st, peer) => {
    const r = ensure(id, peer);
    push(r, st);
  });
  net.on('chat', (id, text) => {
    const r = map.get(id);
    if (r) r.avatar.say(text);
  });

  function push(r, st) {
    const t = performance.now() / 1000;
    const zone = ZONE_ID[st.zone] || 'campus';
    const s = { t, x: st.x, y: st.y, z: st.z, yaw: st.yaw, air: !!(st.flags & 1), zone, emote: st.emote };
    const last = r.snaps[r.snaps.length - 1];
    // 구역이 바뀌었거나 순간이동이면 바로 옮긴다
    if (!r.placed || !last || last.zone !== zone || Math.hypot(last.x - s.x, last.z - s.z) > 25) {
      r.snaps.length = 0;
      r.x = s.x;
      r.y = s.y;
      r.z = s.z;
      r.yaw = s.yaw;
      r.placed = true;
    }
    r.snaps.push(s);
    if (r.snaps.length > 12) r.snaps.shift();
    r.zone = zone;
    if (s.emote !== r.emote) {
      r.emote = s.emote;
      r.avatar.playEmote(s.emote);
    }
  }

  api.update = (dt) => {
    const rt = performance.now() / 1000 - DELAY;
    const myZone = getZone();
    for (const r of map.values()) {
      const sn = r.snaps;
      if (!sn.length) continue;
      while (sn.length > 2 && sn[1].t <= rt) sn.shift();
      const a = sn[0];
      const b = sn[1];
      let x = a.x;
      let y = a.y;
      let z = a.z;
      let yaw = a.yaw;
      let air = a.air;
      if (b) {
        let t0 = a.t;
        const t1 = b.t;
        if (t1 - t0 > 0.5) t0 = t1 - 0.3; // 오래 쉬다 움직인 경우: 마지막 0.3초 동안만 이동
        const k = Math.max(0, Math.min(1, (rt - t0) / (t1 - t0 || 1)));
        x = a.x + (b.x - a.x) * k;
        y = a.y + (b.y - a.y) * k;
        z = a.z + (b.z - a.z) * k;
        let dy = b.yaw - a.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        yaw = a.yaw + dy * k;
        air = k > 0.5 ? b.air : a.air;
      }
      const moved = Math.hypot(x - r.x, z - r.z);
      r.x = x;
      r.y = y;
      r.z = z;
      r.yaw = yaw;
      const g = r.avatar.group;
      g.position.set(x, y, z);
      g.rotation.y = yaw;
      g.visible = r.zone === myZone;
      r.avatar.update(dt, moved, dt > 0 ? moved / dt : 0, air);
    }
  };
  return api;
}
