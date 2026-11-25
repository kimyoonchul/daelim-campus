// 입력: 키보드(event.code 기준 — 한글 입력 상태에서도 WASD가 먹도록), 마우스 드래그, 터치 조이스틱.
export function createInput(canvas) {
  const keys = new Set();
  const listeners = {};
  const input = {
    moveX: 0, // 오른쪽 +
    moveY: 0, // 앞 +
    run: false,
    runToggle: false,
    lookDX: 0,
    lookDY: 0,
    zoom: 0,
    jump: false,
    enabled: true, // false면 이동 입력을 무시(패널이 떠 있을 때)
    touch: matchMedia('(pointer: coarse)').matches,
    on(name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
    },
    emit(name, arg) {
      for (const f of listeners[name] || []) f(arg);
    },
    /** 프레임마다 한 번 호출: 키 상태를 축 값으로 바꾼다 */
    poll() {
      if (!input.enabled) {
        input.moveX = input.moveY = 0;
        input.run = false;
        input.jump = false;
        return;
      }
      let x = 0;
      let y = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
      if (joy.active) {
        x = joy.x;
        y = joy.y;
      }
      input.moveX = x;
      input.moveY = y;
      const mag = Math.hypot(x, y);
      input.run = keys.has('ShiftLeft') || keys.has('ShiftRight') || input.runToggle || (joy.active && mag > 0.92);
      if (keys.has('KeyQ')) input.lookDX -= 9;
      if (keys.has('KeyR')) input.lookDX += 9;
    },
    /** 한 프레임 소비 후 누적값 초기화 */
    endFrame() {
      input.lookDX = 0;
      input.lookDY = 0;
      input.zoom = 0;
      input.jump = false;
    },
  };

  const typing = () => {
    const el = document.activeElement;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  };

  addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중
    if (typing()) {
      if (e.code === 'Escape') document.activeElement.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const c = e.code;
    if (c === 'Enter' || c === 'NumpadEnter' || c === 'Slash') {
      e.preventDefault();
      input.emit('chat');
      return;
    }
    if (c === 'Escape') {
      input.emit('escape');
      return;
    }
    if (!input.enabled) return;
    if (c === 'Space') {
      e.preventDefault();
      if (!e.repeat) input.jump = true;
    } else if (c === 'KeyE' || c === 'KeyF') {
      if (!e.repeat) input.emit('interact');
    } else if (c === 'KeyM') {
      if (!e.repeat) input.emit('map');
    } else if (c === 'Tab') {
      e.preventDefault();
      if (!e.repeat) input.emit('players');
    } else if (c === 'KeyB') {
      if (!e.repeat) input.emit('stamps');
    } else if (c === 'KeyH') {
      if (!e.repeat) input.emit('help');
    } else if (/^Digit[1-6]$/.test(c)) {
      if (!e.repeat) input.emit('emote', Number(c.slice(5)));
    } else if (c.startsWith('Arrow')) e.preventDefault();
    keys.add(c);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => keys.clear());

  // ----- 마우스/터치로 시점 돌리기 -----
  const ptrs = new Map();
  let pinch = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false });
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > 6) p.moved = true;
    if (ptrs.size === 1) {
      input.lookDX += dx;
      input.lookDY += dy;
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) input.zoom += (pinch - d) * 0.02;
      pinch = d;
    }
  });
  const up = (e) => {
    const p = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    pinch = 0;
    if (p && !p.moved && performance.now() - p.t < 350) input.emit('tap', { x: e.clientX, y: e.clientY });
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      input.zoom += Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 60);
    },
    { passive: false },
  );

  // ----- 터치 조이스틱 -----
  const joy = { active: false, x: 0, y: 0, id: null, cx: 0, cy: 0 };
  input.bindJoystick = (base, knob) => {
    const R = 52;
    const set = (e) => {
      let dx = e.clientX - joy.cx;
      let dy = e.clientY - joy.cy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      joy.x = dx / R;
      joy.y = -dy / R;
      if (Math.hypot(joy.x, joy.y) < 0.12) joy.x = joy.y = 0;
    };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      base.setPointerCapture(e.pointerId);
      const r = base.getBoundingClientRect();
      joy.cx = r.left + r.width / 2;
      joy.cy = r.top + r.height / 2;
      joy.id = e.pointerId;
      joy.active = true;
      set(e);
    });
    base.addEventListener('pointermove', (e) => {
      if (joy.active && e.pointerId === joy.id) set(e);
    });
    const end = (e) => {
      if (e.pointerId !== joy.id) return;
      joy.active = false;
      joy.x = joy.y = 0;
      knob.style.transform = '';
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  };

  return input;
}
