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
  sendHz: 5, // 움직일 때 초당 상태 전송 횟수. 발신 예산은 초당 8건(상태 5 + 이벤트류 3)이고 net/limiter.js가 지킨다
  idleSec: 2.5, // 가만히 있을 때 생존 신호 간격
  timeoutSec: 9, // 이 시간 동안 소식이 없으면 나간 것으로 본다
  profileSec: 25, // 프로필 재전송 간격
  maxPlayers: 60,
  chatMax: 120,
};

// 내부 구역 id → 통신 코드. main.js·remotes.js·net.js가 함께 쓴다(구역 코드를 코드에 직접 적지 않는다).
// 맨 앞이 기본 구역(야외)이다. 코드를 바꾸면 옛 접속자와 서로 안 보이므로 NET.prefix의 숫자도 올릴 것.
export const ZONES = { campus: 'c', js4: 'j4', js5: 'j5' };

// 난투 모드 설정. 같은 코드를 다른 장소 버전에서 쓸 때는 여기 값만 바꾼다.
export const GAME = {
  id: 'daelim',
  storeKey: 'dlc.v1', // store.js가 이 키로 저장한다
  pvp: true, // false면 사람끼리는 피해를 주고받지 않는다(주장을 보내지도, 받아들이지도 않음)
  combatZones: ['campus'], // 무기를 들 수 있는 구역 id 목록. null이면 모든 구역
  respawn: { zone: 'campus', sign: 'imgok', out: 4.5 }, // 기절 뒤 깨어나는 곳: 그 건물 안내판 원에서 문 바깥 방향으로 out 미터
  respawnName: '보건실(임곡관)',
  dummies: { anchor: 'field', count: 4 }, // 연습용 과녁. null이면 세우지 않는다
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
