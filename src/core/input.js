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
    fire: false, // 공격을 누르고 있는 동안 true(F 또는 터치 공격 버튼) — poll()이 매 프레임 계산한다
    brake: false, // 브레이크를 누르고 있는 동안 true(Space 또는 터치 점프 버튼) — 운전할 때 쓴다
    fireTouch: false, // 터치 버튼이 누르는 동안 켜 둔다(ui.js)
    brakeTouch: false,
    armed: false, // 무기를 들었는지(mayhem이 설정). true면 화면 탭이 'tap' 대신 'aimtap'(찍은 곳으로 발사)이 된다
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
        releaseHeld();
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
      // 누르고 있는 입력: 이벤트가 아니라 지금 눌려 있는지로 판단한다
      input.fire = keys.has('KeyF') || input.fireTouch;
      input.brake = keys.has('Space') || input.brakeTouch;
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
  /** 누르고 있던 공격·브레이크를 뗀 것으로 친다(패널이 뜸, 창이 가려짐 — 터치 버튼 상태도 함께 푼다) */
  const releaseHeld = () => {
    input.fire = input.brake = false;
    input.fireTouch = input.brakeTouch = false;
  };
  const releaseAll = () => {
    keys.clear();
    releaseHeld();
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
    } else if (c === 'KeyE') {
      if (!e.repeat) input.emit('interact');
    } else if (c === 'KeyQ') {
      if (!e.repeat) input.emit('weapon'); // 무기 바꾸기(순환)
    } else if (c === 'KeyF') {
      if (!e.repeat) input.emit('fire'); // 첫 눌림(경적 등). 누르고 있는 동안은 poll()의 input.fire
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
  addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', releaseAll);

  // ----- 마우스/터치로 시점 돌리기 -----
  const ptrs = new Map();
  let pinch = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    // 입력창에 포커스가 있는 채로 화면을 누른 것은 "입력 끝내기"다. blur()로 포커스가 풀리기 전에 봐 두고, 이 포인터는 탭으로 치지 않는다.
    const wasTyping = typing();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      sx: e.clientX,
      sy: e.clientY,
      t: performance.now(),
      moved: false,
      noTap: wasTyping,
      left: e.pointerType !== 'mouse' || e.button === 0, // 마우스는 왼쪽 버튼으로 누른 것만 발사 탭
      slop: e.pointerType === 'touch' ? 12 : 6, // 탭으로 봐 줄 이동 허용치(px): 손가락은 더 흔들린다
    });
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
    // 손가락 두 개는 확대·축소 동작이다 — 어느 쪽도 탭이 아니다(손가락을 떼다가 발사되지 않게)
    if (ptrs.size > 1) for (const q of ptrs.values()) q.noTap = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > p.slop) p.moved = true;
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
  const drop = (e) => {
    const p = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    pinch = 0;
    return p;
  };
  canvas.addEventListener('pointerup', (e) => {
    const p = drop(e);
    // 탭: 짧게, 거의 안 움직이고 뗀 것. 무기를 들었으면 그 자리로 발사(aimtap), 아니면 기존 탭(프로필 보기).
    if (!p || p.moved || p.noTap || performance.now() - p.t >= 350) return;
    if (!input.armed) input.emit('tap', { x: e.clientX, y: e.clientY });
    else if (p.left && input.enabled) input.emit('aimtap', { x: e.clientX, y: e.clientY });
  });
  // 취소된 포인터(시스템 동작이 가로챔 등)는 정리만 한다 — 탭이 아니다
  canvas.addEventListener('pointercancel', drop);
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
