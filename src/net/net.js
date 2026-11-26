// 실시간 통신: 가입 없이 쓰는 공개 MQTT 브로커(WSS)에 발행/구독한다.
// 누구나 같은 주제에 글을 쓸 수 있으므로, 받은 메시지는 전부 형식·길이·범위를 검사하고 보낸 사람별로 속도를 제한한다.
// 보내는 쪽도 초당 8건(상태 5 + 이벤트류 3)을 넘기지 않는다. 공개 브로커는 그보다 훨씬 빠르게 보내면 메시지를 흘려 버린다.
// 같은 브라우저의 다른 탭끼리는 BroadcastChannel로도 이어진다(오프라인 확인용).
//
// 상태 메시지(14칸): [seq, x, y, z, yaw, flags, zone, emote, hp, wpn, atk, car, ax, az]
//   flags 비트: 1 공중, 2 달리기, 4 기절 · hp 0~100 · wpn 0~4 · atk 0~65535(공격할 때마다 +1)
//   car -1 또는 주차 차량 번호(0~399) · ax, az 마지막 공격의 겨냥점(정수 m)
//   옛 클라이언트가 보내는 8칸짜리도 받는다(없는 칸은 기본값). 옛 클라이언트는 뒤의 6칸을 무시한다.
import { MqttLite } from './mqtt-lite.js';
import { createLimiter } from './limiter.js';
import { NET, CLUBS, ZONES } from '../config.js';
import { grid } from '../world/heightfield.js';

const ZONE_CODES = Object.values(ZONES); // 통신에 쓰는 구역 코드 목록(맨 앞이 기본 구역)
const OUTDOOR = ZONE_CODES[0]; // 지형 격자 위에 있는 야외 구역의 코드(나머지는 멀리 떨어진 곳에 지은 실내)
const ID_RE = /^[a-z0-9]{6,16}$/;
const COL_RE = /^#[0-9a-fA-F]{6}$/;
const CLUB_IDS = new Set([...CLUBS.map((c) => c.id), 'etc', '']);
const PAYLOAD_MAX = 700; // 이보다 긴 메시지는 받는 쪽이 버린다(보낼 때도 같은 기준으로 막는다)
const QUEUE_MAX = 24; // 발신 제한에 걸려 기다리는 이벤트류의 최대 건수
const FX_RUN = 5; // 전투 묶음(fx)을 이만큼 연달아 보냈으면 기다리는 다른 이벤트에 한 번 양보한다(예산 2.5 : 0.5)
// 드물지만 늦으면 받는 쪽이 받아 주지 않는 이벤트. 대기열에서 가장 먼저 나가고, 넘칠 때도 버리지 않는다.
// (기절 알림은 깨어나 무기를 넣기 전에, 건물 붕괴 알림은 무너뜨린 사람이 자리를 뜨기 전에 닿아야 한다)
const URGENT = new Set(['ko', 'bd', 'boss']);
const CHAT_WAIT_MAX = 3; // 기다리는 채팅이 이만큼 쌓였으면 더 받지 않는다(전투 중 도배로 채팅이 한참 뒤에 가는 것을 막는다)
const HI_REPLY_MS = 3000; // hi 응답 사이의 최소 간격
const SEEN_MAX = 256; // 보낸 사람별로 기억하는 이벤트 순번 수(다른 브로커로 늦게 온 같은 메시지 거르기)

const r2 = (v) => Math.round(v * 100) / 100;
/** 정수로 반올림해 범위 안으로 자른다. 숫자가 아니면 기본값 */
const intIn = (v, lo, hi, def) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : def);
const atkOf = (v) => (Number.isFinite(v) ? Math.round(v) & 65535 : 0);
// 구역별 좌표 범위: 야외는 지형 격자 안, 실내는 월드에서 멀리 떨어진 곳에 지어 두었으므로 넉넉하게
const clampX = (zone, x) => (zone === OUTDOOR ? Math.max(grid.X0, Math.min(grid.X1, x)) : Math.max(-5000, Math.min(5000, x)));
const clampZ = (zone, z) => (zone === OUTDOOR ? Math.max(grid.Z0, Math.min(grid.Z1, z)) : Math.max(-5000, Math.min(5000, z)));

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
  let seq = Date.now(); // 새로고침 뒤에도 순번이 항상 커지도록 시각에서 시작한다
  let chan = null;
  let stopped = false;
  let lastHi = 0;
  let hiTimer = null; // 예약해 둔 hi 응답(한 건만)
  let lastHiReply = -Infinity; // 마지막으로 hi에 응답한 시각(ms)
  let sinceSend = 0;
  let sinceProfile = 0;
  let myProfile = cleanProfile(profile);
  // 내 상태: cur는 이번에 보내려는 값, lastState는 마지막으로 실제로 나간 값(매번 새로 만들지 않고 고쳐 쓴다)
  const cur = { x: 0, y: 0, z: 0, yaw: 0, flags: 0, zone: ZONE_CODES[0], emote: 0, hp: 100, wpn: 0, atk: 0, car: -1, ax: 0, az: 0 };
  const lastState = { ...cur };
  let hasState = false;
  const wire = new Array(14);

  const net = {
    id,
    peers,
    online: false,
    on(name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
    },
    connectedCount() {
      let n = 0;
      for (const c of clients) if (c.state === 'up') n++;
      return n;
    },
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
  // 발신 예산(초당 8건): 상태가 항상 먼저(초당 5건까지), 이벤트류(이벤트·채팅·프로필)는 초당 3건까지.
  // 제한에 걸린 이벤트류는 대기열에서 기다렸다가 tick에서 나간다.
  // 차례: 급한 것(URGENT) → 전투 묶음(fx) → 그 밖(먼저 온 순서) → 프로필.
  const limiter = createLimiter();
  const queue = []; // {kind, k, payload, urgent, sent}
  let profileWaiting = false; // 프로필은 한 건만 기다린다(나갈 때의 최신 프로필을 보낸다)
  let fxRun = 0; // 연달아 보낸 fx 수
  let warned = false;
  const sentAt = new Float64Array(32).fill(-Infinity); // 시험용: 실제로 내보낸 시각들
  let sentI = 0;

  /** 연결된 모든 브로커와 같은 브라우저의 다른 탭으로 실제로 내보낸다 */
  function transmit(kind, payload) {
    const topic = base + kind + '/' + id;
    for (const c of clients) if (c.state === 'up') c.mq.publish(topic, payload);
    if (chan) {
      try {
        chan.postMessage({ k: kind, i: id, p: payload });
      } catch (e) {
        /* 무시 */
      }
    }
    sentAt[sentI] = performance.now();
    sentI = (sentI + 1) % sentAt.length;
  }

  // 대기열에서 다음에 보낼 것의 위치. 프로필 차례면 -1, 보낼 것이 없으면 -2
  function nextInLine() {
    let fx = -1;
    let other = -1;
    for (let i = 0; i < queue.length; i++) {
      const it = queue[i];
      if (it.urgent) return i;
      if (it.k === 'fx') {
        if (fx < 0) fx = i;
      } else if (other < 0) other = i;
    }
    const rest = other >= 0 ? other : profileWaiting ? -1 : -2;
    return fx >= 0 && (fxRun < FX_RUN || rest === -2) ? fx : rest;
  }

  /** 제한이 허락하는 만큼 대기열을 흘려보낸다 */
  function pump(now) {
    while (queue.length || profileWaiting) {
      if (!limiter.take('e', now)) return;
      const i = nextInLine();
      if (i < 0) {
        profileWaiting = false;
        fxRun = 0;
        transmit('p', JSON.stringify(myProfile));
      } else {
        const it = queue[i];
        queue.splice(i, 1);
        it.sent = true;
        // 급한 것은 fx와 그 밖 사이의 차례 계산에 끼지 않는다
        if (!it.urgent) fxRun = it.k === 'fx' ? fxRun + 1 : 0;
        transmit(it.kind, it.payload);
      }
    }
  }

  // 대기열이 넘쳤을 때 버릴 것: 가장 오래된 fx → 급한 것(ko 등)·채팅이 아닌 가장 오래된 것 → (그 둘뿐이면) 방금 온 것.
  // 방금 온 것이 급한 것이면 대신 가장 오래된 채팅을 버린다.
  function overflowVictim() {
    let other = -1;
    let chat = -1;
    for (let i = 0; i < queue.length; i++) {
      const it = queue[i];
      if (it.k === 'fx') return i;
      if (it.kind === 'c') {
        if (chat < 0) chat = i;
      } else if (!it.urgent && other < 0) other = i;
    }
    if (other >= 0) return other;
    const last = queue.length - 1;
    return queue[last].urgent && chat >= 0 ? chat : last;
  }

  function dropQueue() {
    queue.length = 0;
    profileWaiting = false;
  }

  /**
   * 한 번 부를 때마다 발신 한 건으로 친다(연결된 브로커 수나 BroadcastChannel과 무관).
   * 'sent' 바로 나감 · 'queued' 제한에 걸려 대기열에서 기다림 · 'dropped' 버려짐
   * 기다리는 것도 나중에 대기열이 넘치거나 연결이 모두 끊기면 버려질 수 있다.
   * kind가 'p'면 obj는 쓰지 않는다(나갈 때의 내 프로필을 보낸다).
   */
  function publish(kind, obj) {
    const now = performance.now();
    if (kind === 's') {
      // 상태는 기다리지 않는다. 못 나가면 다음 tick이 최신 값으로 다시 시도한다.
      if (!limiter.take('s', now)) return 'dropped';
      transmit('s', JSON.stringify(obj));
      return 'sent';
    }
    let it = null;
    if (kind === 'p') profileWaiting = true;
    else {
      const payload = JSON.stringify(obj);
      const k = kind === 'e' && obj ? obj.k : undefined;
      if (k === 'bye') {
        // 나간다는 인사는 제한을 거치지 않고 바로 보낸다
        transmit(kind, payload);
        return 'sent';
      }
      if (payload.length > PAYLOAD_MAX) {
        if (!warned) {
          warned = true;
          console.warn(`메시지가 너무 길어 보내지 않았어요(${payload.length}자, 한도 ${PAYLOAD_MAX}자)`, kind, k);
        }
        return 'dropped';
      }
      it = { kind, k, payload, urgent: URGENT.has(k), sent: false };
      queue.push(it);
    }
    pump(now);
    if (it ? it.sent : !profileWaiting) return 'sent';
    if (!net.connectedCount()) {
      // 연결된 브로커가 없으면 쌓아 두지 않는다(다시 연결됐을 때 묵은 이벤트가 몰려 나가지 않게)
      dropQueue();
      return 'dropped';
    }
    if (queue.length > QUEUE_MAX) {
      const vi = overflowVictim();
      const v = queue[vi];
      queue.splice(vi, 1);
      if (v === it) return 'dropped';
    }
    return 'queued';
  }

  // 보낼 상태를 cur에 담는다. s에 없는 칸은 기본값(hp 100, 평화, atk 0, 차 없음, 겨냥점은 내 위치).
  // zone은 통신 코드(ZONES의 값)로 받는다. 내부 구역 id를 넘겨도 코드로 바꿔 보낸다.
  function fill(s) {
    cur.x = s.x;
    cur.y = s.y;
    cur.z = s.z;
    cur.yaw = s.yaw;
    cur.flags = s.flags | 0;
    cur.zone = ZONE_CODES.includes(s.zone) ? s.zone : Object.hasOwn(ZONES, s.zone) ? ZONES[s.zone] : ZONE_CODES[0];
    cur.emote = s.emote | 0;
    // 체력은 올림: 조금이라도 남아 있으면 1 이상으로 보낸다(0은 기절했을 때만)
    cur.hp = Number.isFinite(s.hp) ? Math.max(0, Math.min(100, Math.ceil(s.hp))) : 100;
    cur.wpn = intIn(s.wpn, 0, 4, 0);
    cur.atk = atkOf(s.atk);
    cur.car = intIn(s.car, -1, 399, -1);
    cur.ax = Math.round(Number.isFinite(s.ax) ? s.ax : s.x);
    cur.az = Math.round(Number.isFinite(s.az) ? s.az : s.z);
  }
  const differs = () =>
    !hasState ||
    Math.abs(cur.x - lastState.x) > 0.02 ||
    Math.abs(cur.z - lastState.z) > 0.02 ||
    Math.abs(cur.y - lastState.y) > 0.03 ||
    Math.abs(cur.yaw - lastState.yaw) > 0.03 ||
    cur.zone !== lastState.zone ||
    cur.emote !== lastState.emote ||
    cur.flags !== lastState.flags ||
    cur.hp !== lastState.hp ||
    cur.wpn !== lastState.wpn ||
    cur.atk !== lastState.atk ||
    cur.car !== lastState.car ||
    cur.ax !== lastState.ax ||
    cur.az !== lastState.az;
  function sendCur() {
    wire[0] = seq + 1;
    wire[1] = r2(cur.x);
    wire[2] = r2(cur.y);
    wire[3] = r2(cur.z);
    wire[4] = r2(cur.yaw);
    wire[5] = cur.flags;
    wire[6] = cur.zone;
    wire[7] = cur.emote;
    wire[8] = cur.hp;
    wire[9] = cur.wpn;
    wire[10] = cur.atk;
    wire[11] = cur.car;
    wire[12] = cur.ax;
    wire[13] = cur.az;
    const r = publish('s', wire);
    if (r !== 'sent') return r;
    seq++;
    Object.assign(lastState, cur);
    hasState = true;
    sinceSend = 0;
    return r;
  }

  /**
   * 지금 상태를 한 건 보낸다: {x, y, z, yaw, flags, zone(통신 코드), emote, hp, wpn, atk, car, ax, az}.
   * 발신 제한에 걸리면 'dropped'를 돌려주고 아무것도 기억하지 않는다(다음 tick이 다시 시도한다).
   */
  net.sendState = (s) => {
    fill(s);
    return sendCur();
  };
  net.sendProfile = () => {
    sinceProfile = 0;
    return publish('p');
  };
  net.setProfile = (p) => {
    myProfile = cleanProfile(p);
    net.sendProfile();
  };
  let lastChatAt = 0;
  /** 채팅 한 줄. 너무 빨리 보냈거나, 발신 제한 때문에 보낼 수 없으면 false(화면에도 찍지 말 것) */
  net.sendChat = (text) => {
    const t = cleanText(text, NET.chatMax);
    if (!t) return false;
    const now = Date.now();
    if (now - lastChatAt < 700) return false;
    // 앞서 보낸 채팅이 아직 여러 건 기다리고 있으면 더 쌓지 않는다
    let waiting = 0;
    for (const it of queue) if (it.kind === 'c') waiting++;
    if (waiting >= CHAT_WAIT_MAX) return false;
    if (publish('c', { q: ++seq, t }) === 'dropped') return false;
    lastChatAt = now;
    return true;
  };
  /** 이벤트 한 건(q 순번은 여기서 붙인다). 돌려주는 값은 publish와 같다: 'sent' | 'queued' | 'dropped' */
  net.sendEvent = (k, extra = {}) => publish('e', { q: ++seq, k, ...extra });

  /** 시험용: 최근 1초 동안 실제로 내보낸 건수(초당 8건을 넘으면 안 된다) */
  net.sentLastSecond = () => {
    const now = performance.now();
    let n = 0;
    for (let i = 0; i < sentAt.length; i++) if (now - sentAt[i] < 1000) n++;
    return n;
  };
  /** 시험용: 발신 제한에 걸려 기다리는 건수(프로필 포함) */
  net.queued = () => queue.length + (profileWaiting ? 1 : 0);

  /** 매 프레임: 상태 전송 주기 관리 + 기다리던 이벤트 흘려보내기 + 끊긴 사람 정리 */
  net.tick = (dt, s) => {
    sinceSend += dt;
    sinceProfile += dt;
    // 상태가 항상 먼저
    if (s) {
      fill(s);
      if ((differs() && sinceSend >= 1 / NET.sendHz) || sinceSend >= NET.idleSec) sendCur();
    }
    if (sinceProfile >= NET.profileSec) net.sendProfile();
    const now = performance.now();
    // 남는 몫으로 대기열을 흘려보낸다. 연결이 모두 끊겼으면 비운다.
    if (queue.length || profileWaiting) {
      if (net.connectedCount()) pump(now);
      else dropQueue();
    }
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
    if (p.seen.length > SEEN_MAX) p.seen.shift();
    return false;
  }

  function receive(kind, pid, payload) {
    if (pid === id || !ID_RE.test(pid) || typeof payload !== 'string' || payload.length > PAYLOAD_MAX) return;
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
      if (![q, x, y, z, yaw].every(Number.isFinite) || !ZONE_CODES.includes(zone)) return;
      if (q <= p.stateSeq && p.stateSeq - q < 100000) return; // 다른 브로커로 온 같은 메시지·늦게 온 메시지
      p.stateSeq = q;
      // 뒤의 6칸(난투)은 각각 범위로 자르고, 옛 클라이언트처럼 없으면 기본값을 쓴다
      const sx = clampX(zone, x);
      const sz = clampZ(zone, z);
      const st = {
        x: sx,
        y: Math.max(-20, Math.min(400, y)),
        z: sz,
        yaw: yaw % (Math.PI * 2),
        flags: flags | 0,
        zone,
        emote: Number.isFinite(emote) ? Math.max(0, Math.min(9, emote | 0)) : 0,
        hp: intIn(msg[8], 0, 100, 100),
        wpn: intIn(msg[9], 0, 4, 0),
        atk: atkOf(msg[10]),
        car: intIn(msg[11], -1, 399, -1),
        ax: Number.isFinite(msg[12]) ? clampX(zone, msg[12]) : sx,
        az: Number.isFinite(msg[13]) ? clampZ(zone, msg[13]) : sz,
        at: p.last, // 받은 시각(ms, performance.now 기준)
      };
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
        // 새로 온 사람에게 내 프로필·상태를 알려 준다(한꺼번에 몰리지 않게 조금 흩어서).
        // 응답은 한 건만 예약하고, 방금 응답했으면 건너뛴다. hi가 아무리 몰려와도 3초에 한 번만 답한다.
        if (hiTimer !== null || performance.now() - lastHiReply < HI_REPLY_MS) return;
        hiTimer = setTimeout(
          () => {
            hiTimer = null;
            if (stopped) return;
            lastHiReply = performance.now();
            net.sendProfile();
            // 상태는 따로 보내지 않고 다음 tick이 지금 값으로 보내게 한다
            sinceSend = Math.max(sinceSend, NET.idleSec);
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
            if (stopped) return;
            net.sendEvent('hi');
            net.sendProfile();
            // 상태는 다음 tick이 지금 값으로 보낸다
            sinceSend = Math.max(sinceSend, NET.idleSec);
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

  /** 시험용: 브로커 연결을 강제로 끊어 재연결을 확인한다 */
  net.debugDrop = () => {
    for (const c of clients) if (c.mq && c.mq.ws) c.mq.ws.close();
  };

  net.stop = () => {
    stopped = true;
    if (hiTimer !== null) clearTimeout(hiTimer);
    hiTimer = null;
    dropQueue();
    net.sendEvent('bye');
    for (const c of clients) if (c.mq) c.mq.close();
    if (chan) chan.close();
  };

  return net;
}
