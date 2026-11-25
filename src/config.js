// 전역 설정값
export const VERSION = '1.0.1';

// 주소에 ?room=이름 을 붙이면 그 이름을 아는 사람끼리만 만나는 방이 된다(영소문자·숫자 16자 이내).
function roomFromUrl() {
  try {
    if (typeof location === 'undefined') return 'main';
    const r = new URLSearchParams(location.search).get('room');
    if (r && /^[a-z0-9]{1,16}$/.test(r)) return r;
  } catch (e) {
    /* 무시 */
  }
  return 'main';
}

export const NET = {
  // 주제 접두어에 프로토콜 버전을 넣는다. 메시지 형식을 바꾸면 숫자를 올릴 것.
  prefix: 'dlc1',
  room: roomFromUrl(),
  // 가입 없이 쓸 수 있는 공개 MQTT 브로커(WSS). 앞에서부터 want개까지 동시에 붙는다.
  brokers: ['wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/', 'wss://mqtt-dashboard.com:8884/mqtt'],
  want: 2,
  sendHz: 6, // 움직일 때 초당 위치 전송 횟수 (공개 브로커 제한 때문에 8 이하로 유지)
  idleSec: 2.5, // 가만히 있을 때 생존 신호 간격
  timeoutSec: 9, // 이 시간 동안 소식이 없으면 나간 것으로 본다
  profileSec: 25, // 프로필 재전송 간격
  maxPlayers: 60,
  chatMax: 120,
};

export const PLAYER = {
  radius: 0.4,
  walk: 4.4,
  run: 7.8,
  jump: 6.8,
  gravity: 20,
  height: 1.7,
};

export const SPAWN = { x: -3, z: 152, yaw: 0 }; // 정문 아래 진입로

export const CLUBS = [
  { id: 'jigongmo', name: '지공모', color: '#2fbf71' },
  { id: 'common', name: 'COMMON', color: '#ff8a3d' },
  { id: 'mobidic', name: '모비딕', color: '#3d8bff' },
];

export const MAJORS = ['모바일인터넷과', '컴퓨터정보계열', '컴퓨터정보학부', '소프트웨어학부', '컴퓨터소프트웨어과', '전자계산과', '다른 학과', '손님'];

export const AVATAR_COLORS = ['#ff6b6b', '#ff9f43', '#feca57', '#1dd1a1', '#10ac84', '#48dbfb', '#2e86de', '#5f27cd', '#f368e0', '#8395a7', '#f5f6fa', '#2d3436'];
