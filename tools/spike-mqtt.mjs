// 공개 MQTT 브로커(WSS) 사전 점검: 접속, 왕복 지연, 초당 전송 허용량, 유언 메시지.
// 실행: node tools/spike-mqtt.mjs
import { MqttLite } from '../src/net/mqtt-lite.js';

const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/',
  'wss://mqtt.eclipseprojects.io:443/mqtt',
  'wss://public.mqtthq.com:8084/mqtt',
  'wss://broker-cn.emqx.io:8084/mqtt',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const room = 'dlc-spike/' + Math.random().toString(36).slice(2, 10);

async function probe(url) {
  const res = { url };
  const t0 = Date.now();
  const a = new MqttLite(url, { clientId: 'spkA' + Math.random().toString(36).slice(2, 8) });
  const b = new MqttLite(url, {
    clientId: 'spkB' + Math.random().toString(36).slice(2, 8),
    will: { topic: room + '/bye/b', payload: 'gone' },
  });
  try {
    await a.connect();
    res.connectMs = Date.now() - t0;
    await b.connect();
  } catch (e) {
    res.error = String(e.message || e);
    return res;
  }
  const lat = [];
  let got = 0;
  let will = false;
  a.onmessage = (topic, text) => {
    if (topic.endsWith('/bye/b')) {
      will = true;
      return;
    }
    got++;
    const sent = Number(text.split('|')[0]);
    if (sent) lat.push(Date.now() - sent);
  };
  a.subscribe(room + '/#');
  await sleep(700);
  // 초당 10개씩 6초 = 60개
  const N = 60;
  for (let i = 0; i < N; i++) {
    b.publish(room + '/s/b', Date.now() + '|' + 'x'.repeat(80));
    await sleep(100);
  }
  await sleep(1200);
  res.sent = N;
  res.got = got;
  lat.sort((x, y) => x - y);
  res.latMedian = lat[Math.floor(lat.length / 2)];
  res.latP95 = lat[Math.floor(lat.length * 0.95)];
  // 유언: DISCONNECT 없이 소켓만 끊는다
  b.drop();
  for (let i = 0; i < 40 && !will; i++) await sleep(250);
  res.will = will;
  a.close();
  return res;
}

const results = await Promise.all(BROKERS.map((u) => probe(u).catch((e) => ({ url: u, error: String(e) }))));
for (const r of results) console.log(JSON.stringify(r));
process.exit(0);
