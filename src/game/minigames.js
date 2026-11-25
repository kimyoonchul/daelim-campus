// 동아리방 미니게임: 지공모 퀴즈, 모비딕 스네이크, COMMON 창업 아이템 뽑기.
import { el } from '../ui/ui.js';
import { QUIZ, IDEA_PARTS } from './content.js';
import { sfx } from '../core/sfx.js';

function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export function openQuiz({ ui, store, onDone }) {
  const N = 8;
  const qs = shuffle(QUIZ).slice(0, N);
  let i = 0;
  let score = 0;
  const box = el('div', { class: 'quiz' });
  const show = () => {
    if (i >= N) {
      const best = Math.max(store.data.quizBest || 0, score);
      store.set('quizBest', best);
      const msg = score === N ? '만점! 지공모 명예 회원 🎓' : score >= 6 ? '훌륭해요! 선배님 소리 듣겠는데요' : score >= 4 ? '절반은 넘었어요. 한 번 더?' : '괜찮아요, 지식은 나누면 늘어요';
      if (score >= 6) sfx.fanfare();
      box.replaceChildren(
        el('p', { class: 'q', text: `${N}문제 중 ${score}문제 정답!` }),
        el('p', { text: msg }),
        el('p', { class: 'muted', text: `내 최고 기록: ${best}/${N}` }),
        el('div', { class: 'btnrow' }, [
          el('button', { class: 'btn primary', text: '다시 도전', onclick: () => openQuiz({ ui, store, onDone }) }),
          el('button', { class: 'btn', text: '닫기', onclick: () => ui.panel.close() }),
        ]),
      );
      if (onDone) onDone(score, N);
      return;
    }
    const [q, answer, ...wrong] = qs[i];
    const opts = shuffle([answer, ...wrong]);
    let locked = false;
    const btns = opts.map((o) =>
      el('button', {
        type: 'button',
        text: o,
        onclick: (e) => {
          if (locked) return;
          locked = true;
          const ok = o === answer;
          if (ok) {
            score++;
            sfx.pick();
          } else sfx.wrong();
          e.currentTarget.classList.add(ok ? 'ok' : 'no');
          for (const b of btns) if (b.textContent === answer) b.classList.add('ok');
          setTimeout(() => {
            i++;
            show();
          }, 950);
        },
      }),
    );
    box.replaceChildren(el('p', { class: 'muted', text: `문제 ${i + 1} / ${N} · 맞힌 개수 ${score}` }), el('p', { class: 'q', text: q }), el('div', { class: 'opts' }, btns));
  };
  ui.panel.open('지공모 지식 나눔 퀴즈', box);
  show();
}

export function openSnake({ ui, store, onDone }) {
  const G = 19; // 칸 수
  const PX = 22;
  const cv = el('canvas', { class: 'gamecv', width: G * PX, height: G * PX });
  const g = cv.getContext('2d');
  const info = el('p', { class: 'muted', text: '' });
  let snake;
  let dir;
  let next;
  let food;
  let score;
  let alive;
  let timer = null;
  let started = false;

  const placeFood = () => {
    do {
      food = [Math.floor(Math.random() * G), Math.floor(Math.random() * G)];
    } while (snake.some((s) => s[0] === food[0] && s[1] === food[1]));
  };
  const reset = () => {
    snake = [
      [9, 9],
      [8, 9],
      [7, 9],
    ];
    dir = [1, 0];
    next = [1, 0];
    score = 0;
    alive = true;
    started = false;
    placeFood();
    draw();
    info.textContent = `방향키·WASD 또는 화면 쓸어넘기기로 시작 · 최고 ${store.data.snakeBest || 0}점`;
  };
  const draw = () => {
    g.fillStyle = '#0c1a12';
    g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = 'rgba(120,255,160,0.06)';
    for (let i = 1; i < G; i++) {
      g.beginPath();
      g.moveTo(i * PX, 0);
      g.lineTo(i * PX, cv.height);
      g.moveTo(0, i * PX);
      g.lineTo(cv.width, i * PX);
      g.stroke();
    }
    g.fillStyle = '#ffd23f';
    g.fillRect(food[0] * PX + 4, food[1] * PX + 4, PX - 8, PX - 8);
    snake.forEach((s, i) => {
      g.fillStyle = i === 0 ? '#b6ff9a' : '#5fd47a';
      g.fillRect(s[0] * PX + 1, s[1] * PX + 1, PX - 2, PX - 2);
    });
    if (!alive) {
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = '#fff';
      g.font = 'bold 30px "Jua", "Malgun Gothic", sans-serif';
      g.textAlign = 'center';
      g.fillText('게임 오버', cv.width / 2, cv.height / 2 - 8);
      g.font = 'bold 18px "Malgun Gothic", sans-serif';
      g.fillText(`${score}점 · 다시 하려면 방향키`, cv.width / 2, cv.height / 2 + 24);
    }
  };
  const step = () => {
    if (!alive) return;
    dir = next;
    const h = [snake[0][0] + dir[0], snake[0][1] + dir[1]];
    if (h[0] < 0 || h[1] < 0 || h[0] >= G || h[1] >= G || snake.some((s) => s[0] === h[0] && s[1] === h[1])) {
      alive = false;
      sfx.wrong();
      const best = Math.max(store.data.snakeBest || 0, score);
      store.set('snakeBest', best);
      info.textContent = `${score}점! 최고 ${best}점`;
      if (onDone) onDone(score);
      draw();
      return;
    }
    snake.unshift(h);
    if (h[0] === food[0] && h[1] === food[1]) {
      score++;
      sfx.pick();
      placeFood();
      info.textContent = `${score}점 · 최고 ${Math.max(store.data.snakeBest || 0, score)}점`;
      schedule();
    } else snake.pop();
    draw();
  };
  const schedule = () => {
    clearInterval(timer);
    timer = setInterval(step, Math.max(70, 150 - score * 4));
  };
  const turn = (dx, dy) => {
    if (!alive) {
      reset();
      return;
    }
    if (dx === -dir[0] && dy === -dir[1]) return;
    next = [dx, dy];
    if (!started) {
      started = true;
      schedule();
    }
  };
  const onKey = (e) => {
    const map = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
    const d = map[e.code];
    if (!d) return;
    e.preventDefault();
    turn(d[0], d[1]);
  };
  addEventListener('keydown', onKey);
  let sx = 0;
  let sy = 0;
  cv.addEventListener('pointerdown', (e) => {
    sx = e.clientX;
    sy = e.clientY;
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointerup', (e) => {
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.hypot(dx, dy) < 14) {
      if (!alive) reset();
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) turn(Math.sign(dx), 0);
    else turn(0, Math.sign(dy));
  });
  const pad = el('div', { class: 'btnrow', style: 'justify-content:center' }, [
    el('button', { class: 'btn', text: '◀', onclick: () => turn(-1, 0) }),
    el('button', { class: 'btn', text: '▲', onclick: () => turn(0, -1) }),
    el('button', { class: 'btn', text: '▼', onclick: () => turn(0, 1) }),
    el('button', { class: 'btn', text: '▶', onclick: () => turn(1, 0) }),
  ]);
  ui.panel.open('모비딕 피처폰 스네이크', [el('p', { class: 'muted', text: '모바일 콘텐츠 연구의 고전. 노란 먹이를 먹고 길어지세요.' }), cv, info, pad], {
    onClose() {
      clearInterval(timer);
      removeEventListener('keydown', onKey);
    },
  });
  reset();
}

export function openIdea({ ui, onShare }) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  let cur = null;
  const out = el('p', { class: 'q', style: 'font-size:20px;min-height:84px;margin:14px 0', text: '버튼을 눌러 오늘의 창업 아이템을 뽑아 보세요!' });
  const roll = () => {
    let n = 0;
    const t = setInterval(() => {
      cur = [pick(IDEA_PARTS.who), pick(IDEA_PARTS.tech), pick(IDEA_PARTS.what)];
      out.textContent = `💡 ${cur[0]}을(를) 위한 ${cur[1]} ${cur[2]}`;
      if (++n > 9) {
        clearInterval(t);
        sfx.pick();
      }
    }, 70);
  };
  ui.panel.open('COMMON 창업 아이템 뽑기', [
    el('p', { class: 'muted', text: '함께 배우고 함께 창업하는 COMMON의 아이디어 회의. 말이 되는지는 뽑은 사람이 책임집니다.' }),
    out,
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'btn primary', text: '🎲 뽑기', onclick: roll }),
      el('button', {
        class: 'btn',
        text: '💬 채팅에 공유',
        onclick: () => {
          if (cur && onShare) onShare(`💡 ${cur[0]}을(를) 위한 ${cur[1]} ${cur[2]}`);
        },
      }),
    ]),
  ]);
}
