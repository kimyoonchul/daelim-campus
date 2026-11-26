// 다른 접속자 아바타: 받은 위치를 0.24초 늦게 따라가며 부드럽게 보간한다.
// 체력·무기·공격 횟수·탑승·기절은 보간하지 않고 마지막으로 받은 값 그대로 둔다(난투 모듈이 읽는다).
import { Avatar } from '../player/avatar.js';
import { ZONES, NET } from '../config.js';

// 상태가 초당 5건이라 도착 간격의 1.44배만큼 늦게 그려야 멈칫하지 않는다
const DELAY = 1.44 / NET.sendHz;
// 통신 코드 → 내부 구역 id (config의 ZONES를 뒤집은 것)
const ZONE_ID = Object.fromEntries(Object.entries(ZONES).map(([zid, code]) => [code, zid]));
const DEFAULT_ZONE = Object.keys(ZONES)[0];
const num = (v, def) => (Number.isFinite(v) ? v : def);

export function createRemotes(engine, net, getZone) {
  // id → 레코드
  //   보간값: x, y, z, yaw (화면에 그리는 위치) · zone(내부 구역 id) · emote
  //   원본값: hp, wpn, atk, car, ko · raw {x, z}(마지막으로 받은 위치) · stateAt(그 상태를 받은 시각 ms)
  //   prevWpn·wpnChangedAt(직전 무기와 바꾼 시각 ms) · atkPose(마지막 공격 때의 자세) · atkEvents(받은 공격 횟수 누계)
  //   시각은 모두 performance.now() 기준이다.
  const map = new Map();
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
      r = {
        id,
        avatar,
        snaps: [],
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        zone: DEFAULT_ZONE,
        emote: 0,
        placed: false,
        peer,
        // 난투: 마지막으로 받은 상태의 원본 값
        hp: 100,
        wpn: 0,
        atk: 0,
        car: -1,
        ko: false,
        raw: { x: 0, z: 0 },
        stateAt: -1e9, // 아직 상태를 받은 적이 없다
        prevWpn: 0,
        wpnChangedAt: -1e9,
        atkPose: null, // {x, y, z, yaw, ax, az, w, zone}: 공격이 실린 스냅샷의 원본 값(w는 그때 든 무기)
        atkEvents: 0, // 공격을 받을 때마다 늘어난다(스냅샷 하나에 최대 2). 무기 모듈이 늘어난 만큼 재현한다
        hpShown: null, // 체력 막대에 표시 중인 값(무기를 안 들면 null)
        fresh: true, // 첫 스냅샷을 아직 받지 않았다
      };
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

  // 난투 값 반영: 보간 없이 받은 그대로 두고, 바뀐 것만 아바타에 알린다.
  // 첫 스냅샷은 기준값만 잡는다(공격 동작·번쩍임 없음).
  function combat(r, st) {
    const first = r.fresh;
    const wpn = num(st.wpn, 0);
    const hp = num(st.hp, 100);
    const atk = num(st.atk, 0);
    const ko = !!(st.flags & 4);
    const shown = wpn > 0 ? hp : null; // 체력 막대는 무기를 든 사람만 보인다
    const wpnChanged = wpn !== r.wpn;
    const koChanged = ko !== r.ko;
    const hpChanged = shown !== r.hpShown;
    const hurt = !first && hp < r.hp;
    // 무기를 안 든 사람은 공격할 수 없다. 평화 상태에서 숫자만 바뀐 것(새로고침으로 0이 됐거나 위조)은 공격으로 치지 않는다.
    const attacked = !first && atk !== r.atk && wpn > 0;

    // 기록을 먼저 모두 고친 다음 아바타에 알린다
    r.fresh = false;
    r.stateAt = num(st.at, performance.now());
    r.raw.x = st.x;
    r.raw.z = st.z;
    r.car = num(st.car, -1);
    if (first || wpnChanged) {
      r.prevWpn = first ? wpn : r.wpn;
      r.wpnChangedAt = r.stateAt;
    }
    r.wpn = wpn;
    r.ko = ko;
    r.hp = hp;
    r.hpShown = shown;
    if (attacked) {
      // 상태가 초당 5건이라 그 사이에 여러 번 쐈을 수 있다. 한 스냅샷에서 두 번까지만 센다.
      r.atkPose = { x: st.x, y: st.y, z: st.z, yaw: st.yaw, ax: num(st.ax, st.x), az: num(st.az, st.z), w: wpn, zone: r.zone };
      r.atkEvents += Math.min((atk - r.atk) & 65535, 2);
    }
    r.atk = atk;

    const av = r.avatar;
    if (wpnChanged) av.setWeapon(wpn);
    if (koChanged) av.setKO(ko);
    if (hpChanged) av.setHP(shown);
    if (hurt) av.flash();
    if (attacked) av.attack(wpn);
  }

  function push(r, st) {
    const t = performance.now() / 1000;
    const zone = Object.hasOwn(ZONE_ID, st.zone) ? ZONE_ID[st.zone] : DEFAULT_ZONE;
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
    combat(r, st);
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
      // 차에 탄 사람은 차량 모듈이 차째로 그린다
      g.visible = r.zone === myZone && r.car < 0;
      r.avatar.update(dt, moved, dt > 0 ? moved / dt : 0, air);
    }
  };
  return api;
}
