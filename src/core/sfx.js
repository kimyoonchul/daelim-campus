// 효과음: 음원 파일 없이 WebAudio로 짧은 소리를 합성한다. 첫 사용자 입력 뒤에만 켜진다.
let ctx = null;
let enabled = true;

function ac() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch (e) {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, t0, dur, type = 'sine', vol = 0.12, slide = 0) {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  const t = c.currentTime + t0;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  unlock: () => ac(),
  setEnabled(v) {
    enabled = v;
  },
  isEnabled: () => enabled,
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
};
