// 시험용 봇: 두 번째 접속자 흉내를 낸다(같은 프로토콜로 걷고, 채팅하고, 나간다).
// 실행: node tools/bot.mjs [초=40] [이름=봇돌이] [x=-3] [z=140]
import { MqttLite } from '../src/net/mqtt-lite.js';
import { NET } from '../src/config.js';

const secs = Number(process.argv[2] || 40);
const name = process.argv[3] || '봇돌이';
const cx = Number(process.argv[4] || -3);
const cz = Number(process.argv[5] || 140);
const id = 'bot' + Math.random().toString(36).slice(2, 9);
const base = `${NET.prefix}/${NET.room}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 1;

const clients = [];
const seen = new Set();
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
      else if (rest[0] === 'e') console.log('[이벤트 수신]', rest.slice(2), text);
      else if (rest[0] === 's' && !seen.has(rest)) {
        seen.add(rest);
        console.log('[위치 수신 시작]', rest.slice(2), text);
      }
    };
    clients.push(mq);
    console.log('연결됨', url);
  } catch (e) {
    console.log('연결 실패', url, e.message);
  }
}
if (!clients.length) process.exit(1);
const pub = (kind, obj) => {
  for (const c of clients) c.publish(base + kind + '/' + id, JSON.stringify(obj));
};

pub('e', { q: ++seq, k: 'hi' });
pub('p', { n: name, y: '11', m: '모바일인터넷과', c: 'common', t: '시험용 봇입니다', col: '#ff9f43' });

const t0 = Date.now();
let said = false;
let emoted = false;
while (Date.now() - t0 < secs * 1000) {
  const t = (Date.now() - t0) / 1000;
  // 반지름 5m 원을 그리며 걷는다
  const a = t * 0.8;
  const x = cx + Math.cos(a) * 5;
  const z = cz + Math.sin(a) * 5;
  const yaw = Math.atan2(-Math.sin(a), Math.cos(a));
  // 높이는 받는 쪽에서 검증만 하므로 대략값(실제 클라이언트는 지형 높이를 보낸다)
  pub('s', [++seq, +x.toFixed(2), Number(process.argv[6] || 10), +z.toFixed(2), +yaw.toFixed(2), 0, 'c', t > 12 && t < 16 ? 1 : 0]);
  if (!said && t > 5) {
    said = true;
    pub('c', { q: ++seq, t: '안녕하세요! 전산관 가는 길인가요?' });
  }
  if (!emoted && t > 20) {
    emoted = true;
    pub('p', { n: name, y: '11', m: '모바일인터넷과', c: 'common', t: '시험용 봇입니다', col: '#ff9f43' });
  }
  await sleep(166);
}
pub('e', { q: ++seq, k: 'bye' });
await sleep(300);
for (const c of clients) c.close();
console.log('끝');
process.exit(0);
