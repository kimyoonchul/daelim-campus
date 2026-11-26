// 시험용 봇: 두 번째 접속자 흉내를 낸다(같은 프로토콜로 걷고, 채팅하고, 나간다).
// 실행: ROOM=test node tools/bot.mjs [초=40] [이름=봇돌이] [x=-3] [z=140] [y=10]
//   아래 환경변수 없이 돌리면 옛 클라이언트처럼 8칸짜리 상태만 보낸다(옛 클라이언트와의 호환 확인용).
//
// 난투 시험 — 환경변수를 하나라도 주면 14칸 상태(체력·무기·공격 횟수·겨냥점)를 초당 5건 보낸다:
//   WPN=0~4       들고 있는 무기(기본 1 주먹. 0은 평화)
//   HP=1~100      처음 체력(기본 100)
//   ATK=숫자      초당 공격 횟수 — 상태의 공격 횟수(atk)를 그만큼씩 올린다(기본: HIT를 주면 무기 쿨다운에 맞춰, 아니면 0)
//   HIT=<id>|any  그 접속자를 맞혔다는 주장(fx.h)을 보낸다. any는 처음 보이는 사람. 브라우저 콘솔에서 __dl.net.id 로 내 id를 본다
//   MODE=normal   무기에 맞는 정상 피해(기본) → 무기를 든 대상은 맞아야 하고, 무기를 넣은(평화) 대상은 아무 일도 없어야 한다
//        oversize 피해량 9999 → 받는 쪽이 무기별 상한으로 잘라야 한다
//        far      200m 떨어진 곳에 서서 주장 → 받는 쪽이 사거리 밖이라 거부해야 한다
//        flood    0.2초마다 12건씩 주장 → 받는 쪽이 1초에 6건·피해 120까지만 받아야 한다
//        peace    봇 자신은 평화(상태의 wpn 0)인 채로 주장 → 받는 쪽이 무기 불일치로 거부해야 한다
//   나를 맞혔다는 주장을 받으면(봇이 무기를 들고 있을 때만) 체력을 깎고, 0이 되면 ko를 보낸 뒤 3.5초 기절했다가
//   체력 100으로 다시 일어난다(실제 접속자와 달리 무기는 그대로 들고 있다 — 계속 시험할 수 있게).
//   평화인 대상이 맞지 않는지 보려면 MODE=normal로 두고 브라우저 쪽에서 무기를 넣으면 된다.
// 예: ROOM=test WPN=2 HIT=any node tools/bot.mjs 60 물총봇 -3 146
import { MqttLite } from '../src/net/mqtt-lite.js';
import { NET, ZONES } from '../src/config.js';
import { MAX_HP, hitSpec } from '../src/mayhem/rules.js';

const secs = Number(process.argv[2] || 40);
const name = process.argv[3] || '봇돌이';
const cx = Number(process.argv[4] || -3);
const cz = Number(process.argv[5] || 140);
const id = 'bot' + Math.random().toString(36).slice(2, 9);
const room = process.env.ROOM || NET.room; // 시험할 때는 ROOM=test 처럼 다른 방을 쓴다
const base = `${NET.prefix}/${room}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 1;

// ----- 난투 설정 -----
const env = process.env;
const fight = ['WPN', 'HP', 'ATK', 'HIT', 'MODE'].some((k) => env[k] !== undefined && env[k] !== '');
const MODES = ['normal', 'oversize', 'far', 'flood', 'peace'];
const mode = MODES.includes(env.MODE) ? env.MODE : 'normal';
if (env.MODE && mode !== env.MODE) console.log(`모르는 MODE '${env.MODE}' — normal로 돌립니다 (${MODES.join(' · ')})`);
const intIn = (v, lo, hi, def) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : def);
const ZONE = Object.values(ZONES)[0]; // 야외 구역의 통신 코드(설정의 맨 앞)
const claimW = intIn(env.WPN, 1, 4, 1); // 주장에 적는 무기
const claimSpec = hitSpec(claimW);
const myWpn = mode === 'peace' ? 0 : intIn(env.WPN, 0, 4, 1); // 상태에 싣는 무기
const hitWho = env.HIT || '';
const atkPerSec = env.ATK !== undefined && env.ATK !== '' && Number.isFinite(Number(env.ATK)) ? Math.max(0, Math.min(8, Number(env.ATK))) : hitWho ? Math.min(2.5, 1 / claimSpec.cd) : 0;
// far: 말한 자리에서 200m 떨어진 곳(지도 안쪽으로)에 선다
const farX = mode === 'far' ? (cx > 0 ? -200 : 200) : 0;
const me = { hp: intIn(env.HP, 1, MAX_HP, MAX_HP), atk: 0, koUntil: 0, ax: cx, az: cz };
let target = hitWho && hitWho !== 'any' ? hitWho : '';
const where = new Map(); // 접속자 id → 마지막으로 본 위치 { x, z }
const claims = []; // 다음 fx에 실을 주장들
const handled = new Set(); // 처리한 이벤트(보낸 사람:순번) — 브로커 두 곳으로 같은 것이 두 번 오므로 한 번만 처리한다

const clients = [];
const seen = new Set();
const pub = (kind, obj) => {
  for (const c of clients) c.publish(base + kind + '/' + id, JSON.stringify(obj));
};
for (const url of NET.brokers.slice(0, NET.want)) {
  const mq = new MqttLite(url, { clientId: 'dlc' + id, will: { topic: base + 'e/' + id, payload: '{"q":0,"k":"bye"}' } });
  try {
    await mq.connect();
    mq.subscribe(base + '#');
    mq.onmessage = (topic, text) => {
      const rest = topic.slice(base.length);
      if (rest.endsWith('/' + id)) return;
      if (rest[0] === 'c') console.log('[채팅 수신]', rest.slice(2), text);
      else if (rest[0] === 'p') console.log('[프로필 수신]', rest.slice(2), text);
      else if (rest[0] === 'e') {
        console.log('[이벤트 수신]', rest.slice(2), text);
        if (fight) onEvent(rest.slice(2), text);
      } else if (rest[0] === 's') {
        if (!seen.has(rest)) {
          seen.add(rest);
          console.log('[위치 수신 시작]', rest.slice(2), text);
        }
        if (fight) onState(rest.slice(2), text);
      }
    };
    clients.push(mq);
    console.log('연결됨', url);
  } catch (e) {
    console.log('연결 실패', url, e.message);
  }
}
if (!clients.length) process.exit(1);

// ----- 난투: 받은 것 처리 -----
// 다른 사람의 상태: 위치를 기억해 둔다(겨냥점·주장의 맞은 자리에 쓴다). HIT=any면 처음 보이는 사람이 대상
function onState(from, text) {
  let m;
  try {
    m = JSON.parse(text);
  } catch (e) {
    return;
  }
  if (!Array.isArray(m) || !Number.isFinite(m[1]) || !Number.isFinite(m[3])) return;
  where.set(from, { x: m[1], z: m[3] });
  if (!target && hitWho === 'any' && !from.startsWith('bot')) {
    target = from;
    console.log('[대상]', target);
  }
}
// 나를 맞혔다는 주장: 무기를 들고 있을 때만 받는다(규칙 1). 피해는 무기별 상한으로 자른다(거리·빈도 검사는 하지 않는다)
function onEvent(from, text) {
  let m;
  try {
    m = JSON.parse(text);
  } catch (e) {
    return;
  }
  if (!m || m.k !== 'fx' || !Array.isArray(m.h)) return;
  const key = from + ':' + m.q;
  if (handled.has(key)) return;
  if (handled.size > 4000) handled.clear();
  handled.add(key);
  for (const h of m.h) {
    if (!Array.isArray(h) || h[0] !== id) continue;
    const spec = hitSpec(h[2]);
    if (!spec || !Number.isFinite(h[1]) || h[1] < 1) continue;
    if (myWpn === 0 || Date.now() < me.koUntil) {
      console.log('[맞음 — 무시]', from, myWpn === 0 ? '평화 상태' : '기절 중');
      continue;
    }
    me.hp = Math.max(0, me.hp - Math.min(h[1], spec.maxHit));
    console.log('[맞음]', from, '무기', h[2], '피해', Math.min(h[1], spec.maxHit), '→ 체력', me.hp);
    if (me.hp <= 0) {
      me.koUntil = Date.now() + 3500;
      pub('e', { q: ++seq, k: 'ko', by: from, w: h[2] });
      console.log('[기절]', from, '에게 당함. 3.5초 뒤 다시 일어납니다');
    }
  }
}

pub('e', { q: ++seq, k: 'hi' });
pub('p', { n: name, y: '11', m: '모바일인터넷과', c: 'common', t: '시험용 봇입니다', col: '#ff9f43' });
if (fight) console.log(`난투 시험: 무기 ${myWpn}${mode === 'peace' ? `(주장은 ${claimW})` : ''} · 체력 ${me.hp} · 초당 공격 ${atkPerSec.toFixed(2)} · 대상 ${hitWho || '없음'} · MODE ${mode} · 내 id ${id}`);

const t0 = Date.now();
let said = false;
let emoted = false;
let lastAtk = 0; // 마지막으로 공격한 시각(초)
let lastFx = 0; // 마지막으로 fx를 보낸 시각(초)
let wasDown = false;
while (Date.now() - t0 < secs * 1000) {
  const t = (Date.now() - t0) / 1000;
  // 반지름 5m 원을 그리며 걷는다
  const a = t * 0.8;
  const x = cx + farX + Math.cos(a) * 5;
  const z = cz + Math.sin(a) * 5;
  const yaw = Math.atan2(-Math.sin(a), Math.cos(a));
  // 높이는 받는 쪽에서 검증만 하므로 대략값(실제 클라이언트는 지형 높이를 보낸다)
  const y = Number(process.argv[6] || 10);
  const emote = t > 12 && t < 16 ? 1 : 0;
  if (!fight) pub('s', [++seq, +x.toFixed(2), y, +z.toFixed(2), +yaw.toFixed(2), 0, ZONE, emote]);
  else {
    const down = Date.now() < me.koUntil;
    if (wasDown && !down) {
      me.hp = MAX_HP;
      console.log('[일어남] 체력', me.hp);
    }
    wasDown = down;
    // 공격: 공격 횟수를 올리고 겨냥점을 대상 쪽으로. 대상이 보이면 맞혔다는 주장도 쌓는다
    if (!down && atkPerSec > 0 && t - lastAtk >= 1 / atkPerSec) {
      lastAtk = t;
      me.atk = (me.atk + 1) & 65535;
      const p = target ? where.get(target) : null;
      me.ax = p ? p.x : x + Math.cos(yaw) * 8;
      me.az = p ? p.z : z + Math.sin(yaw) * 8;
      if (p && mode !== 'flood') claims.push([target, mode === 'oversize' ? 9999 : claimSpec.dmg, claimW, +p.x.toFixed(1), +p.z.toFixed(1)]);
    }
    if (!down && mode === 'flood' && target && where.has(target)) {
      const p = where.get(target);
      claims.length = 0;
      for (let i = 0; i < 12; i++) claims.push([target, claimSpec.dmg, claimW, +p.x.toFixed(1), +p.z.toFixed(1)]);
    }
    pub('s', [++seq, +x.toFixed(2), y, +z.toFixed(2), +yaw.toFixed(2), down ? 4 : 0, ZONE, emote, Math.ceil(me.hp), myWpn, me.atk, -1, Math.round(me.ax), Math.round(me.az)]);
    // 주장은 0.4초에 한 묶음(flood는 0.2초마다), 한 묶음에 12건까지
    if (claims.length && t - lastFx >= (mode === 'flood' ? 0.15 : 0.39)) {
      lastFx = t;
      pub('e', { q: ++seq, k: 'fx', h: claims.splice(0, 12) });
    }
  }
  if (!said && t > 5) {
    said = true;
    pub('c', { q: ++seq, t: '안녕하세요! 전산관 가는 길인가요?' });
  }
  if (!emoted && t > 20) {
    emoted = true;
    pub('p', { n: name, y: '11', m: '모바일인터넷과', c: 'common', t: '시험용 봇입니다', col: '#ff9f43' });
  }
  // 난투 시험은 실제 클라이언트처럼 상태를 초당 5건, 옛 방식은 예전 그대로 초당 6건
  await sleep(fight ? 200 : 166);
}
pub('e', { q: ++seq, k: 'bye' });
await sleep(300);
for (const c of clients) c.close();
console.log('끝');
process.exit(0);
