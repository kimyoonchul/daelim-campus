// 실시간 통신: 가입 없이 쓰는 공개 MQTT 브로커(WSS)에 발행/구독한다.
// 누구나 같은 주제에 글을 쓸 수 있으므로, 받은 메시지는 전부 형식·길이·범위를 검사하고 보낸 사람별로 속도를 제한한다.
// 같은 브라우저의 다른 탭끼리는 BroadcastChannel로도 이어진다(오프라인 확인용).
import { MqttLite } from './mqtt-lite.js';
import { NET, CLUBS } from '../config.js';
import { grid } from '../world/heightfield.js';

const ZONES = ['c', 'j4', 'j5'];
const ID_RE = /^[a-z0-9]{6,16}$/;
const COL_RE = /^#[0-9a-fA-F]{6}$/;
const CLUB_IDS = new Set([...CLUBS.map((c) => c.id), 'etc', '']);

function randomId() {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  const r = new Uint8Array(10);
  crypto.getRandomValues(r);
  for (let i = 0; i < 10; i++) s += a[r[i] % a.length];
  return s;
}

/** 제어문자·보이지 않는 문자 제거 + 길이 제한 */
export function cleanText(s, max) {
  if (typeof s !== 'string') return '';
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    const bad = c < 32 || c === 127 || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202f) || c === 0xfeff;
    out += bad ? ' ' : ch;
    if (out.length > max * 4) break;
  }
  return out.split(' ').filter(Boolean).join(' ').slice(0, max);
}

export function cleanProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const o = {
    n: cleanText(p.n, 12) || '손님',
    y: typeof p.y === 'string' && /^[0-9]{2}$/.test(p.y) ? p.y : '',
    m: cleanText(p.m, 12),
    c: CLUB_IDS.has(p.c) ? p.c : '',
    ct: cleanText(p.ct, 8),
    t: cleanText(p.t, 30),
    col: typeof p.col === 'string' && COL_RE.test(p.col) ? p.col : '#2e86de',
    g: p.g ? 1 : 0,
  };
  return o;
}

export function createNet(profile) {
  let id = null;
  try {
    id = sessionStorage.getItem('dlc.id');
  } catch (e) {
    /* 저장소 차단 */
  }
  if (!id || !ID_RE.test(id)) {
    id = randomId();
    try {
      sessionStorage.setItem('dlc.id', id);
    } catch (e) {
      /* 무시 */
    }
  }
  const base = `${NET.prefix}/${NET.room}/`;
  const listeners = {};
  const peers = new Map(); // id → {profile, last, stateSeq, seen[], tokens, chats[], joined}
  const clients = []; // {url, mq, state, fails}
  let seq = Math.floor(Date.now() / 1000) % 100000; // 새로고침 뒤에도 순번이 뒤로 가지 않게
  let chan = null;
  let stopped = false;
  let lastHi = 0;
  let lastState = null;
  let sinceSend = 0;
  let sinceProfile = 0;
  let myProfile = cleanProfile(profile);

  const net = {
    id,
    peers,
    online: false,
    on(name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
    },
    connectedCount: () => clients.filter((c) => c.state === 'up').length,
    status() {
      const up = net.connectedCount();
      return { up, trying: clients.some((c) => c.state === 'connecting'), local: !!chan };
    },
  };
  const emit = (name, ...a) => {
    for (const f of listeners[name] || []) {
      try {
        f(...a);
      } catch (e) {
        console.error(e);
      }
    }
  };

  // ---------- 보내기 ----------
  function publish(kind, obj) {
    const payload = JSON.stringify(obj);
    const topic = base + kind + '/' + id;
    for (const c of clients) if (c.state === 'up') c.mq.publish(topic, payload);
    if (chan) {
      try {
        chan.postMessage({ k: kind, i: id, p: payload });
      } catch (e) {
        /* 무시 */
      }
    }
  }
  const r2 = (v) => Math.round(v * 100) / 100;

  net.sendState = (s) => {
    lastState = s;
    publish('s', [++seq, r2(s.x), r2(s.y), r2(s.z), r2(s.yaw), s.flags | 0, s.zone, s.emote | 0]);
    sinceSend = 0;
  };
  net.sendProfile = () => {
    publish('p', myProfile);
    sinceProfile = 0;
  };
  net.setProfile = (p) => {
    myProfile = cleanProfile(p);
    net.sendProfile();
  };
  let lastChatAt = 0;
  net.sendChat = (text) => {
    const t = cleanText(text, NET.chatMax);
    if (!t) return false;
    const now = Date.now();
    if (now - lastChatAt < 700) return false;
    lastChatAt = now;
    publish('c', { q: ++seq, t });
    return true;
  };
  net.sendEvent = (k, extra = {}) => publish('e', { q: ++seq, k, ...extra });

  /** 매 프레임: 위치 전송 주기 관리 + 끊긴 사람 정리 */
  net.tick = (dt, s) => {
    sinceSend += dt;
    sinceProfile += dt;
    const changed = !lastState || Math.abs(s.x - lastState.x) > 0.02 || Math.abs(s.z - lastState.z) > 0.02 || Math.abs(s.y - lastState.y) > 0.03 || Math.abs(s.yaw - lastState.yaw) > 0.03 || s.zone !== lastState.zone || s.emote !== lastState.emote || s.flags !== lastState.flags;
    if ((changed && sinceSend >= 1 / NET.sendHz) || sinceSend >= NET.idleSec) net.sendState({ ...s });
    if (sinceProfile >= NET.profileSec) net.sendProfile();
    const now = performance.now();
    for (const [pid, p] of peers) {
      if (now - p.last > NET.timeoutSec * 1000) {
        peers.delete(pid);
        if (p.joined) emit('leave', pid, p);
      }
    }
  };

  // ---------- 받기 ----------
  function peerOf(pid) {
    let p = peers.get(pid);
    if (!p) {
      if (peers.size >= NET.maxPlayers) return null;
      p = { id: pid, profile: null, last: performance.now(), stateSeq: -1, seen: [], tokens: 40, tokenAt: performance.now(), chats: [], joined: false };
      peers.set(pid, p);
    }
    return p;
  }
  function allow(p) {
    // 보낸 사람별 토큰 버킷: 초당 30건까지
    const now = performance.now();
    p.tokens = Math.min(60, p.tokens + ((now - p.tokenAt) / 1000) * 30);
    p.tokenAt = now;
    if (p.tokens < 1) return false;
    p.tokens -= 1;
    return true;
  }
  function dup(p, q) {
    if (!Number.isFinite(q)) return true;
    if (p.seen.includes(q)) return true;
    p.seen.push(q);
    if (p.seen.length > 40) p.seen.shift();
    return false;
  }

  function receive(kind, pid, payload) {
    if (pid === id || !ID_RE.test(pid) || typeof payload !== 'string' || payload.length > 700) return;
    let msg;
    try {
      msg = JSON.parse(payload);
    } catch (e) {
      return;
    }
    if (kind === 'e' && msg && msg.k === 'bye') {
      const p = peers.get(pid);
      if (p) {
        peers.delete(pid);
        if (p.joined) emit('leave', pid, p);
      }
      return;
    }
    const p = peerOf(pid);
    if (!p || !allow(p)) return;
    p.last = performance.now();

    if (kind === 's') {
      if (!Array.isArray(msg) || msg.length < 7) return;
      const [q, x, y, z, yaw, flags, zone, emote] = msg;
      if (![q, x, y, z, yaw].every(Number.isFinite) || !ZONES.includes(zone)) return;
      if (q <= p.stateSeq && p.stateSeq - q < 5000) return; // 다른 브로커로 온 같은 메시지·늦게 온 메시지
      p.stateSeq = q;
      const st = {
        x: Math.max(grid.X0, Math.min(grid.X1, x)),
        y: Math.max(-20, Math.min(400, y)),
        z: Math.max(grid.Z0, Math.min(grid.Z1, z)),
        yaw: yaw % (Math.PI * 2),
        flags: flags | 0,
        zone,
        emote: Number.isFinite(emote) ? Math.max(0, Math.min(9, emote | 0)) : 0,
      };
      if (zone !== 'c') {
        // 실내는 범위가 다르다(월드에서 멀리 떨어진 곳에 지어 둠)
        st.x = Math.max(-5000, Math.min(5000, x));
        st.z = Math.max(-5000, Math.min(5000, z));
      }
      p.state = st;
      if (!p.profile) {
        // 프로필을 아직 못 받은 사람: 인사를 다시 보내 프로필을 받는다
        const now = performance.now();
        if (now - lastHi > 5000) {
          lastHi = now;
          net.sendEvent('hi');
        }
        return;
      }
      emit('state', pid, st, p);
    } else if (kind === 'p') {
      const prof = cleanProfile(msg);
      if (!prof) return;
      const changed = JSON.stringify(prof) !== JSON.stringify(p.profile);
      p.profile = prof;
      if (!p.joined) {
        p.joined = true;
        emit('join', pid, p);
      } else if (changed) emit('profile', pid, p);
      if (p.state && changed) emit('state', pid, p.state, p);
    } else if (kind === 'c') {
      if (!msg || dup(p, msg.q)) return;
      const t = cleanText(msg.t, NET.chatMax);
      if (!t || !p.profile) return;
      const now = performance.now();
      p.chats = p.chats.filter((x) => now - x < 6000);
      if (p.chats.length >= 5) return; // 도배 방지
      p.chats.push(now);
      emit('chat', pid, t, p);
    } else if (kind === 'e') {
      if (!msg || typeof msg.k !== 'string' || dup(p, msg.q)) return;
      if (msg.k === 'hi') {
        // 새로 온 사람에게 내 프로필·위치를 알려 준다(한꺼번에 몰리지 않게 조금 흩어서)
        setTimeout(
          () => {
            if (stopped) return;
            net.sendProfile();
            if (lastState) net.sendState({ ...lastState });
          },
          150 + Math.random() * 500,
        );
      } else if (p.profile) emit('event', pid, msg, p);
    }
  }

  // ---------- 브로커 연결 ----------
  function startClient(firstUrl) {
    const c = { url: firstUrl, mq: null, state: 'connecting', fails: 0 };
    clients.push(c);
    const connect = () => {
      if (stopped) return;
      c.state = 'connecting';
      emit('status', net.status());
      const mq = new MqttLite(c.url, {
        clientId: 'dlc' + id + Math.random().toString(36).slice(2, 5),
        keepAlive: 50,
        will: { topic: base + 'e/' + id, payload: JSON.stringify({ q: 0, k: 'bye' }) },
        connectTimeout: 12000,
      });
      c.mq = mq;
      mq.onmessage = (topic, text) => {
        if (!topic.startsWith(base)) return;
        const rest = topic.slice(base.length);
        const kind = rest[0];
        if (rest[1] !== '/' || !'spce'.includes(kind)) return;
        receive(kind, rest.slice(2), text);
      };
      mq.onclose = () => {
        if (stopped) return;
        c.state = 'down';
        emit('status', net.status());
        setTimeout(connect, 2500 + Math.random() * 2000);
      };
      mq.connect().then(
        () => {
          c.state = 'up';
          c.fails = 0;
          mq.subscribe(base + '#');
          net.online = true;
          emit('status', net.status());
          setTimeout(() => {
            net.sendEvent('hi');
            net.sendProfile();
            if (lastState) net.sendState({ ...lastState });
          }, 250);
        },
        () => {
          c.state = 'down';
          c.fails++;
          emit('status', net.status());
          if (stopped) return;
          // 이 브로커가 계속 안 되면 다음 후보로 바꾼다
          if (c.fails >= 2) {
            const used = new Set(clients.map((x) => x.url));
            const next = NET.brokers.find((u) => !used.has(u));
            if (next) {
              c.url = next;
              c.fails = 0;
            }
          }
          setTimeout(connect, Math.min(30000, 3000 * c.fails + 1500));
        },
      );
    };
    connect();
  }

  net.start = () => {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        chan = new BroadcastChannel(`${NET.prefix}-${NET.room}`);
        chan.onmessage = (ev) => {
          const d = ev.data;
          if (d && typeof d.k === 'string' && typeof d.i === 'string') receive(d.k, d.i, d.p);
        };
      } catch (e) {
        chan = null;
      }
    }
    for (const url of NET.brokers.slice(0, NET.want)) startClient(url);
    // 창을 닫을 때 바로 나갔다고 알린다(못 보내도 유언 메시지·시간 초과로 정리된다)
    addEventListener('pagehide', () => {
      net.sendEvent('bye');
    });
  };

  net.stop = () => {
    stopped = true;
    net.sendEvent('bye');
    for (const c of clients) if (c.mq) c.mq.close();
    if (chan) chan.close();
  };

  return net;
}
