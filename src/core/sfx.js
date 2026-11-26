// 효과음: 음원 파일 없이 WebAudio로 짧은 소리를 합성한다. 첫 사용자 입력 뒤에만 켜진다.
// 쓰는 법: sfx.이름() — 내 곁에서 난 소리 / sfx.at('이름', 거리m) — 떨어진 곳에서 난 소리(멀수록 작게, 60m 밖은 생략)
//   기존: pick stamp fanfare jump beep(hi) chat door wrong boom tired
//   난투: punch squirt launch(big) hurt ko horn crash(big) build jam bossRoar bossDown
//   big = true면 launch는 대포의 "뻥", crash는 건물이 주저앉는 "와르르". sfx.at에서는 세 번째 인자로 넘긴다.
// 제한: 모든 소리는 마스터 게인 하나를 거친다. 같은 이름은 60ms 안에 다시 내지 않고, 동시에 10음까지만 내며,
//   겹치는 음의 음량 합이 한도를 넘으면 늦게 온 음을 줄이거나 버린다(여럿이 한꺼번에 쏴도 소리가 깨지지 않게).
let ctx = null;
let master = null; // 모든 소리가 모이는 곳(마스터 게인)
let noiseBuf = null; // 1초짜리 백색 잡음: 타격·바람·무너지는 소리의 재료
let enabled = true;
let volMul = 1; // sfx.at()이 거리 감쇠를 거는 동안만 1보다 작다

const MASTER_GAIN = 1; // 기존 소리의 크기를 그대로 둔다(전체 음량을 바꾸려면 이 값만 고친다)
const MAX_VOICES = 10;
const MIX_BUDGET = 0.9; // 겹치는 음의 음량 합 한도(1을 넘으면 출력이 찌그러진다). 스탬프·팡파르·불꽃 같은 평소 소리는 겹쳐도 이 안에 든다
const MIN_GAP_MS = 60;
const HEAR_DIST = 60; // 이 거리(m) 밖에서 난 소리는 내지 않는다
// 음 장부: 아직 끝나지 않은 음(조금 뒤에 울리도록 예약해 둔 음 포함)마다
// 시작 시각, 음량이 줄기 시작하는 시각, 끝 시각(오디오 시계, 초)과 음량을 적어 둔다.
const VOICE_RECS = 48;
const voiceStart = new Float64Array(VOICE_RECS);
const voiceHold = new Float64Array(VOICE_RECS);
const voiceEnd = new Float64Array(VOICE_RECS);
const voiceVol = new Float64Array(VOICE_RECS);

function ac() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = typeof window === 'undefined' ? null : window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch (e) {
      return null;
    }
    master = ctx.destination;
    try {
      const m = ctx.createGain();
      m.gain.value = MASTER_GAIN;
      m.connect(ctx.destination);
      master = m;
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseBuf = buf;
    } catch (e) {
      /* 잡음을 못 만들어도 삑 소리는 난다 */
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// 시각 t에 울리고 있는 음들의 음량 합을 돌려주고, 그 수를 mixCount에 적는다.
// 음량이 줄어드는 구간은 직선으로 어림한다(실제로는 더 빨리 줄어드므로 넉넉하게 세는 셈이다).
let mixCount = 0;
function mixAt(t) {
  let n = 0;
  let sum = 0;
  for (let i = 0; i < VOICE_RECS; i++) {
    const end = voiceEnd[i];
    if (end <= t || voiceStart[i] > t) continue;
    n++;
    const hold = voiceHold[i];
    sum += t > hold ? (voiceVol[i] * (end - t)) / (end - hold) : voiceVol[i];
  }
  mixCount = n;
  return sum;
}

// 동시 발음·음량 합 제한: 새 음을 장부에 올리고 실제로 낼 음량을 돌려준다. 0이면 그 음은 내지 않는다.
// now는 지금 시각, t0~t1은 그 음이 울리는 구간, tHold는 음량이 줄기 시작하는 때.
// 가장 붐비는 순간은 어떤 음이 막 시작할 때이므로, 새 음이 시작할 때와 새 음이 울리는 동안 다른 예약된 음이
// 시작할 때만 따져 보면 된다. 그중 한 번이라도 이미 10음이 울리거나, 음량 한도가 차서 4분의 1도 못 내면 버린다.
function takeVoice(now, t0, tHold, t1, vol) {
  let slot = -1;
  for (let i = 0; i < VOICE_RECS; i++) {
    if (voiceEnd[i] <= now) {
      slot = i; // 다 끝난 음의 칸은 다시 쓴다
      break;
    }
  }
  if (slot < 0) return 0;
  let room = MIX_BUDGET - mixAt(t0);
  if (mixCount >= MAX_VOICES) return 0;
  for (let i = 0; i < VOICE_RECS; i++) {
    const s = voiceStart[i];
    if (s <= t0 || s >= t1) continue;
    const sum = mixAt(s);
    if (mixCount >= MAX_VOICES) return 0;
    // 그때 새 음은 이만큼(w) 남아 있다
    const w = s > tHold ? (t1 - s) / (t1 - tHold) : 1;
    const r = (MIX_BUDGET - sum) / w;
    if (r < room) room = r;
  }
  if (room < vol * 0.25) return 0;
  const v = Math.max(0.0002, Math.min(vol, room));
  voiceStart[slot] = t0;
  voiceHold[slot] = tHold;
  voiceEnd[slot] = t1;
  voiceVol[slot] = v;
  return v;
}

/** 발진기 한 음. slide는 끝 주파수 배율, hold는 음량을 유지하는 시간(초 — 경적처럼 끄는 소리용) */
function tone(freq, t0, dur, type = 'sine', vol = 0.12, slide = 0, hold = 0) {
  const c = ac();
  if (!c) return;
  const now = c.currentTime;
  const t = now + t0;
  const v = takeVoice(now, t, t + 0.012 + hold, t + dur + 0.02, vol * volMul);
  if (!v) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.012);
  if (hold > 0) g.gain.setValueAtTime(v, t + 0.012 + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** 걸러 낸 잡음 한 줄기. f1을 주면 거르는 주파수가 f0에서 f1로 미끄러진다 */
function noise(t0, dur, vol = 0.12, type = 'lowpass', f0 = 1200, f1 = 0, q = 0.8) {
  const c = ac();
  if (!c || !noiseBuf) return;
  const now = c.currentTime;
  const t = now + t0;
  const v = takeVoice(now, t, t + 0.008, t + dur + 0.02, vol * volMul);
  if (!v) return;
  const s = c.createBufferSource();
  const f = c.createBiquadFilter();
  const g = c.createGain();
  s.buffer = noiseBuf;
  s.loop = true;
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random() * 0.9);
  s.stop(t + dur + 0.02);
}

// 소리 목록. 바깥에서는 sfx.이름()으로 부른다(아래에서 빈도 제한을 씌워 내보낸다).
const SOUNDS = {
  pick() {
    tone(988, 0, 0.09, 'square', 0.06);
    tone(1319, 0.07, 0.16, 'square', 0.06);
  },
  stamp() {
    tone(180, 0, 0.12, 'triangle', 0.2, 0.5);
    tone(784, 0.1, 0.12, 'triangle', 0.1);
    tone(1047, 0.2, 0.22, 'triangle', 0.1);
  },
  fanfare() {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.12, i === 5 ? 0.5 : 0.14, 'square', 0.07));
  },
  jump() {
    tone(320, 0, 0.14, 'sine', 0.07, 1.9);
  },
  beep(hi = false) {
    tone(hi ? 1175 : 587, 0, hi ? 0.4 : 0.14, 'square', 0.07);
  },
  chat() {
    tone(880, 0, 0.05, 'sine', 0.05);
  },
  door() {
    tone(260, 0, 0.1, 'triangle', 0.12, 0.7);
    tone(390, 0.1, 0.14, 'triangle', 0.08);
  },
  wrong() {
    tone(196, 0, 0.25, 'sawtooth', 0.06, 0.7);
  },
  boom() {
    tone(90, 0, 0.5, 'triangle', 0.22, 0.4);
    tone(1400, 0.02, 0.35, 'sawtooth', 0.025, 0.3);
  },
  tired() {
    tone(240, 0, 0.18, 'sine', 0.06, 0.6);
  },

  // ----- 난투: 장난감·만화 느낌의 짧은 합성음 -----
  /** 주먹 "퍽" */
  punch() {
    tone(170, 0, 0.1, 'sine', 0.2, 0.35);
    noise(0, 0.07, 0.14, 'lowpass', 1100, 300);
  },
  /** 물총 "찍" */
  squirt() {
    tone(720, 0, 0.07, 'sine', 0.055, 2.6);
    noise(0, 0.06, 0.03, 'highpass', 2600);
  },
  /** 발사 "슈웅". big이면 대포의 낮은 "뻥"을 깐다 */
  launch(big = false) {
    if (big) {
      tone(130, 0, 0.22, 'triangle', 0.2, 0.4);
      noise(0, 0.3, 0.09, 'bandpass', 300, 1400, 1.2);
    } else {
      tone(260, 0, 0.3, 'sine', 0.045, 2.4);
      noise(0, 0.38, 0.11, 'bandpass', 500, 2600, 1.4);
    }
  },
  /** 맞았을 때 "아얏" */
  hurt() {
    tone(560, 0, 0.13, 'square', 0.055, 0.45);
    noise(0, 0.05, 0.05, 'lowpass', 1500, 500);
  },
  /** 기절: 휘청 미끄러진 뒤 머리 위에 별이 돈다 */
  ko() {
    tone(900, 0, 0.48, 'sine', 0.09, 0.2, 0.2);
    [1568, 1319, 1568, 1319].forEach((f, i) => tone(f, 0.5 + i * 0.09, 0.08, 'triangle', 0.05));
  },
  /** 경적 "빵" */
  horn() {
    tone(392, 0, 0.26, 'square', 0.045, 0, 0.18);
    tone(494, 0, 0.26, 'square', 0.045, 0, 0.18);
  },
  /** 충돌 "쿵". big이면 건물이 주저앉는 "와르르" */
  crash(big = false) {
    if (big) {
      tone(70, 0, 0.9, 'triangle', 0.2, 0.5, 0.25);
      noise(0, 1.1, 0.18, 'lowpass', 1600, 120);
      [0.14, 0.32, 0.48, 0.66, 0.82].forEach((t, i) => noise(t, 0.09, 0.08, 'bandpass', 700 + i * 260, 0, 3));
    } else {
      tone(110, 0, 0.22, 'triangle', 0.2, 0.4);
      noise(0, 0.28, 0.16, 'lowpass', 2200, 260);
      tone(1250, 0.02, 0.05, 'square', 0.03);
    }
  },
  /** 다시 짓기 "뚝딱뚝딱" */
  build() {
    [620, 880, 620, 880].forEach((f, i) => tone(f, i * 0.12, 0.06, 'triangle', 0.1, 0.7));
  },
  /** 무기 고장 "삑삑" */
  jam() {
    tone(1480, 0, 0.07, 'square', 0.05, 0, 0.04);
    tone(1480, 0.11, 0.07, 'square', 0.05, 0, 0.04);
  },
  /** 보스가 깨어나거나 큰 기술을 쓸 때 "으르렁" */
  bossRoar() {
    tone(98, 0, 0.7, 'sawtooth', 0.08, 0.62, 0.35);
    tone(104, 0, 0.7, 'sawtooth', 0.08, 0.6, 0.35);
    noise(0, 0.6, 0.06, 'lowpass', 700, 250);
  },
  /** 보스 격파: 바람이 빠진 뒤 짧은 승리 가락 */
  bossDown() {
    tone(520, 0, 0.6, 'sawtooth', 0.06, 0.15, 0.2);
    noise(0.05, 0.5, 0.09, 'lowpass', 900, 150);
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.62 + i * 0.09, i === 4 ? 0.45 : 0.1, 'square', 0.06));
  },
};

// 이름별 최소 간격: 같은 소리가 60ms 안에 또 오면 버린다.
// 다만 직전 것보다 두 배 넘게 큰 소리는 낸다(멀리서 난 남의 소리 때문에 내 소리가 묻히지 않게).
const gates = new Map();
for (const name of Object.keys(SOUNDS)) gates.set(name, { t: -1e9, k: 0 });

// k는 음량 배율(1 = 제 음량), opt는 그 소리의 선택 인자(beep의 hi, launch·crash의 big)
function play(name, k, opt) {
  if (!enabled) return false;
  const g = gates.get(name);
  const now = performance.now();
  if (now - g.t < MIN_GAP_MS && k <= g.k * 2) return false;
  g.t = now;
  g.k = k;
  volMul = k;
  try {
    SOUNDS[name](opt);
  } finally {
    volMul = 1;
  }
  return true;
}

export const sfx = {
  unlock: () => ac(),
  setEnabled(v) {
    enabled = v;
  },
  isEnabled: () => enabled,
  /**
   * 떨어진 곳에서 난 소리(남의 발사·폭발): 거리(m)에 따라 줄이고 60m 밖은 내지 않는다.
   * 예: sfx.at('boom', 25), sfx.at('launch', 40, true). 모르는 이름·숫자가 아닌 거리는 조용히 무시한다.
   */
  at(name, dist, opt) {
    if (typeof dist !== 'number' || !(dist < HEAR_DIST) || !Object.hasOwn(SOUNDS, name)) return false;
    const k = 1 - Math.max(0, dist) / HEAR_DIST;
    const v = k * k;
    if (v < 0.01) return false; // 들리지 않을 만큼 작으면 음 칸을 쓰지 않는다
    return play(name, v, opt);
  },
};
// 소리마다 sfx.이름(opt)을 만든다. 낸 경우 true, 빈도 제한·소리 끔으로 건너뛴 경우 false
for (const name of Object.keys(SOUNDS)) sfx[name] = (opt) => play(name, 1, opt);
