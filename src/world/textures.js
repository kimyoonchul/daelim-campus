// 캔버스로 그리는 절차적 텍스처: 건물 외벽(창 한 칸×한 층 타일), 글자 간판 등.
// 학교 사진은 모양·색 참고만 하고, 여기서는 모두 직접 그린다.
import * as THREE from 'three';
import { makeRng } from '../core/rng.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(cv, repeat = true) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

function bricks(g, S, color, rnd) {
  g.fillStyle = color;
  g.fillRect(0, 0, S, S);
  const rows = 16;
  const rh = S / rows;
  const bw = S / 4;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let c = -1; c < 5; c++) {
      const f = 0.86 + rnd() * 0.26;
      g.fillStyle = shade(color, f);
      g.fillRect(c * bw + off + 1, r * rh + 1, bw - 2, rh - 2);
    }
  }
  g.fillStyle = 'rgba(0,0,0,0.10)';
  for (let r = 0; r <= rows; r++) g.fillRect(0, r * rh - 0.5, S, 1.2);
}

function glass(g, x, y, w, h, color, rnd) {
  const gr = g.createLinearGradient(x, y, x + w * 0.4, y + h);
  gr.addColorStop(0, shade(color, 1.35));
  gr.addColorStop(0.5, color);
  gr.addColorStop(1, shade(color, 0.75));
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
  // 비스듬한 반사 줄
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = 'rgba(255,255,255,0.13)';
  const k = rnd() * w * 0.3;
  g.beginPath();
  g.moveTo(x + k, y + h);
  g.lineTo(x + k + w * 0.22, y + h);
  g.lineTo(x + k + w * 0.62, y);
  g.lineTo(x + k + w * 0.4, y);
  g.fill();
  g.restore();
}

/** 창 영역(0..1 좌표) 목록을 스타일별로 돌려준다 — 외벽과 야간 불빛 타일이 같은 자리를 쓰도록. */
function windowRects(style) {
  switch (style) {
    case 'punch':
      return [[0.2, 0.26, 0.6, 0.5]];
    case 'punch2':
      return [
        [0.09, 0.28, 0.34, 0.46],
        [0.57, 0.28, 0.34, 0.46],
      ];
    case 'ribbon':
      return [[0.0, 0.3, 1.0, 0.42]];
    case 'curtain':
      return [[0.0, 0.0, 1.0, 1.0]];
    case 'fins':
      return [
        [0.1, 0.1, 0.13, 0.8],
        [0.43, 0.1, 0.13, 0.8],
        [0.77, 0.1, 0.13, 0.8],
      ];
    case 'arch':
      return [[0.22, 0.2, 0.56, 0.58]];
    case 'apt':
      return [
        [0.08, 0.3, 0.5, 0.45],
        [0.68, 0.36, 0.22, 0.32],
      ];
    default:
      return [];
  }
}

/**
 * 외벽 타일. opts: { style, wall, glass, frame, brick, band, ivy, seed }
 * 타일 하나 = 가로 한 칸(bay) × 세로 한 층.
 */
export function facadeTexture(opts) {
  const S = 256;
  const cv = canvas(S, S);
  const g = cv.getContext('2d');
  const rnd = makeRng(opts.seed || 7);
  const wall = opts.wall || '#cccccc';
  const gl = opts.glass || '#3c5f7a';
  const frame = opts.frame || '#f0eee8';

  if (opts.brick) bricks(g, S, wall, rnd);
  else {
    g.fillStyle = wall;
    g.fillRect(0, 0, S, S);
    // 살짝 얼룩
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${rnd() > 0.5 ? 255 : 0},${rnd() > 0.5 ? 255 : 0},${rnd() > 0.5 ? 255 : 0},0.025)`;
      g.fillRect(rnd() * S, rnd() * S, 20 + rnd() * 60, 6 + rnd() * 30);
    }
  }

  const style = opts.style || 'punch';
  if (style === 'curtain') {
    glass(g, 0, 0, S, S, gl, rnd);
    g.fillStyle = opts.mullion || 'rgba(235,240,245,0.9)';
    g.fillRect(0, 0, S, 5); // 층 슬래브
    g.fillRect(0, S - 3, S, 3);
    g.fillStyle = opts.mullion || 'rgba(220,228,235,0.85)';
    g.fillRect(S / 2 - 1.5, 0, 3, S);
    g.fillRect(0, 0, 2, S);
    g.fillRect(S - 2, 0, 2, S);
    g.fillRect(0, S * 0.62, S, 2);
  } else if (style === 'fins') {
    // 세로 루버(핀) 사이로 좁은 창
    for (const r of windowRects('fins')) glass(g, r[0] * S, r[1] * S, r[2] * S, r[3] * S, gl, rnd);
    g.fillStyle = shade(wall, 1.12);
    for (let i = 0; i < 6; i++) g.fillRect((i / 6) * S + S / 12 - 3, 0, 6, S);
    g.fillStyle = shade(wall, 0.8);
    g.fillRect(0, 0, S, 6);
  } else {
    for (const r of windowRects(style)) {
      const x = r[0] * S;
      const y = r[1] * S;
      const w = r[2] * S;
      const h = r[3] * S;
      if (style === 'arch') {
        // 아치 창(정보통신관)
        g.save();
        g.beginPath();
        g.moveTo(x, y + h);
        g.lineTo(x, y + w * 0.3);
        g.quadraticCurveTo(x + w / 2, y - w * 0.22, x + w, y + w * 0.3);
        g.lineTo(x + w, y + h);
        g.closePath();
        g.clip();
        glass(g, x, y - 20, w, h + 20, gl, rnd);
        g.restore();
        g.strokeStyle = frame;
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(x, y + h);
        g.lineTo(x, y + w * 0.3);
        g.quadraticCurveTo(x + w / 2, y - w * 0.22, x + w, y + w * 0.3);
        g.lineTo(x + w, y + h);
        g.closePath();
        g.stroke();
        g.fillStyle = frame;
        g.fillRect(x + w / 2 - 1.5, y, 3, h);
        g.fillRect(x, y + h * 0.5, w, 3);
      } else {
        g.fillStyle = frame;
        g.fillRect(x - 4, y - 4, w + 8, h + 8);
        glass(g, x, y, w, h, gl, rnd);
        g.fillStyle = frame;
        if (style === 'ribbon') {
          for (let i = 0; i <= 3; i++) g.fillRect((i / 3) * S - 2, y, 4, h);
        } else {
          g.fillRect(x + w / 2 - 1.5, y, 3, h);
          g.fillRect(x, y + h * 0.36, w, 3);
        }
        // 창턱 그림자
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(x - 4, y + h + 4, w + 8, 4);
      }
    }
  }

  if (opts.band) {
    // 층마다 도는 콘크리트 띠(전산관의 흰 띠)
    g.fillStyle = opts.band;
    g.fillRect(0, 0, S, S * 0.085);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(0, S * 0.085, S, 3);
  }
  if (opts.pilaster) {
    g.fillStyle = opts.pilaster;
    g.fillRect(0, 0, S * 0.05, S);
    g.fillRect(S * 0.95, 0, S * 0.05, S);
  }
  if (opts.ivy) {
    // 담쟁이: 잎 덩어리를 겹쳐 찍는다
    const n = Math.floor(900 * opts.ivy);
    for (let i = 0; i < n; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      // 창 위는 덜 덮는다
      const inWin = windowRects(style).some((r) => x > r[0] * S && x < (r[0] + r[2]) * S && y > r[1] * S && y < (r[1] + r[3]) * S);
      if (inWin && rnd() < 0.85) continue;
      const v = 0.55 + rnd() * 0.6;
      g.fillStyle = `rgba(${Math.floor(40 * v)},${Math.floor(120 * v)},${Math.floor(50 * v)},0.9)`;
      const r = 3 + rnd() * 6;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.8, rnd() * 3, 0, 7);
      g.fill();
    }
  }
  return tex(cv);
}

/** 밤에 켜지는 창 불빛(4×4칸 타일, 일부만 켜짐). 외벽 타일과 창 위치가 같다. */
export function windowLightTexture(style, seed = 3, litRatio = 0.55) {
  const N = 4;
  const S = 64;
  const cv = canvas(S * N, S * N);
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S * N, S * N);
  const rnd = makeRng(seed);
  const rects = windowRects(style);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (rnd() > litRatio) continue;
      const warm = rnd();
      g.fillStyle = warm > 0.3 ? `rgb(255,${200 + Math.floor(rnd() * 40)},${120 + Math.floor(rnd() * 60)})` : 'rgb(210,230,255)';
      g.globalAlpha = 0.55 + rnd() * 0.45;
      for (const w of rects) g.fillRect((c + w[0]) * S + 1, (r + w[1]) * S + 1, w[2] * S - 2, w[3] * S - 2);
    }
  }
  g.globalAlpha = 1;
  const t = tex(cv);
  t.repeat.set(1 / N, 1 / N);
  return t;
}

/** 글자가 적힌 투명 텍스처(간판·이름표). 줄바꿈은 \n. */
export function textTexture(text, opts = {}) {
  const font = opts.font || 'bold 64px "Jua", "Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const pad = opts.pad != null ? opts.pad : 16;
  const lines = String(text).split('\n');
  const m = canvas(8, 8).getContext('2d');
  m.font = font;
  const size = parseInt(/(\d+)px/.exec(font)[1], 10);
  const lh = size * 1.22;
  let w = 8;
  for (const l of lines) w = Math.max(w, m.measureText(l).width);
  const cv = canvas(Math.ceil(w + pad * 2), Math.ceil(lh * lines.length + pad * 2));
  const g = cv.getContext('2d');
  if (opts.bg) {
    g.fillStyle = opts.bg;
    const r = opts.radius != null ? opts.radius : 18;
    g.beginPath();
    g.roundRect(0, 0, cv.width, cv.height, r);
    g.fill();
    if (opts.border) {
      g.strokeStyle = opts.border;
      g.lineWidth = opts.borderWidth || 4;
      g.beginPath();
      g.roundRect(2, 2, cv.width - 4, cv.height - 4, r);
      g.stroke();
    }
  }
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    const y = pad + lh * (i + 0.5);
    if (opts.stroke) {
      g.strokeStyle = opts.stroke;
      g.lineWidth = opts.strokeWidth || 8;
      g.lineJoin = 'round';
      g.strokeText(l, cv.width / 2, y);
    }
    g.fillStyle = opts.color || '#ffffff';
    g.fillText(l, cv.width / 2, y);
  });
  const t = tex(cv, false);
  t.userData = { w: cv.width, h: cv.height, aspect: cv.width / cv.height };
  return t;
}

/** 글자판 메시(가로 width m). 양면. */
export function textPlane(text, width, opts = {}) {
  const t = textTexture(text, opts);
  const h = width / t.userData.aspect;
  const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, side: opts.oneSided ? THREE.FrontSide : THREE.DoubleSide, depthWrite: false, toneMapped: false, fog: true });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, h), mat);
  mesh.userData.h = h;
  return mesh;
}

/** 항상 카메라를 보는 글자(이름표·말풍선) */
export function textSprite(text, heightM, opts = {}) {
  const t = textTexture(text, opts);
  const mat = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: opts.depthTest !== false, toneMapped: false, fog: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(heightM * t.userData.aspect, heightM, 1);
  return s;
}

/** 단순 무늬 타일: 벽돌 포장, 격자 타일 등 */
export function patternTexture(kind, a = '#b98a6c', b = '#a97a5e') {
  const S = 128;
  const cv = canvas(S, S);
  const g = cv.getContext('2d');
  const rnd = makeRng(11);
  g.fillStyle = a;
  g.fillRect(0, 0, S, S);
  if (kind === 'paver') {
    const n = 8;
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        g.fillStyle = rnd() > 0.5 ? a : b;
        g.globalAlpha = 0.6 + rnd() * 0.4;
        g.fillRect((c + (r % 2) * 0.5) * (S / n) + 1, r * (S / n) + 1, S / n - 2, S / n - 2);
      }
    g.globalAlpha = 1;
  } else if (kind === 'tile') {
    g.strokeStyle = b;
    g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      g.beginPath();
      g.moveTo((i * S) / 4, 0);
      g.lineTo((i * S) / 4, S);
      g.moveTo(0, (i * S) / 4);
      g.lineTo(S, (i * S) / 4);
      g.stroke();
    }
  } else if (kind === 'wood') {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? a : b;
      g.fillRect(0, (i * S) / 8, S, S / 8 - 1);
    }
  } else if (kind === 'belt') {
    // 무빙워크 바닥(움직이는 줄무늬)
    g.fillStyle = a;
    g.fillRect(0, 0, S, S);
    g.fillStyle = b;
    for (let i = 0; i < 8; i++) g.fillRect(0, (i * S) / 8, S, S / 16);
  }
  return tex(cv);
}
