// 화면 UI: 입장 폼, 채팅, 알림, 상호작용 안내, 패널, 난투 HUD(체력·무기·차량·보스). 사용자 입력은 항상 textContent로만 넣는다.
import { CLUBS, MAJORS, AVATAR_COLORS } from '../config.js';

const $ = (id) => document.getElementById(id);

/** 작은 DOM 생성기: el('div', {class:'x', text:'..'}, [children]) */
export function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const k in props) {
    const v = props[k];
    if (k === 'text') e.textContent = v;
    else if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c != null) e.append(c);
  return e;
}

export function createUI(input) {
  const ui = {};
  if (input.touch) document.body.classList.add('touch');

  // ---------- 불러오기 ----------
  ui.loading = (msg, pct) => {
    if (msg) $('loadmsg').textContent = msg;
    if (pct != null) $('loadbar').style.width = Math.round(pct * 100) + '%';
  };
  ui.hideLoading = () => $('loading').classList.add('hidden');

  // ---------- 입장 폼 ----------
  ui.askProfile = (saved) =>
    new Promise((resolve) => {
      const s = saved || {};
      const state = { c: s.c || '', col: s.col || AVATAR_COLORS[6] };
      const major = $('fMajor');
      major.replaceChildren(...MAJORS.map((m) => el('option', { value: m, text: m })));
      if (s.m && MAJORS.includes(s.m)) major.value = s.m;
      $('fName').value = s.n || '';
      $('fYear').value = s.y || '';
      $('fTag').value = s.t || '';
      $('fClubText').value = s.ct || '';

      const clubBox = $('fClub');
      const options = [...CLUBS.map((c) => ({ id: c.id, name: c.name, color: c.color })), { id: 'etc', name: '기타', color: '#8395a7' }, { id: '', name: '없음', color: '#55657a' }];
      const drawClubs = () => {
        clubBox.replaceChildren(
          ...options.map((o) =>
            el('button', {
              type: 'button',
              text: o.name,
              class: state.c === o.id ? 'on' : '',
              style: `--c:${o.color}`,
              onclick: () => {
                state.c = o.id;
                drawClubs();
              },
            }),
          ),
        );
        $('fClubText').classList.toggle('hidden', state.c !== 'etc');
      };
      drawClubs();

      const colBox = $('fColors');
      const drawColors = () => {
        colBox.replaceChildren(
          ...AVATAR_COLORS.map((c) =>
            el('button', {
              type: 'button',
              class: state.col === c ? 'on' : '',
              style: `background:${c}`,
              'aria-label': '색 ' + c,
              onclick: () => {
                state.col = c;
                drawColors();
              },
            }),
          ),
        );
      };
      drawColors();

      $('join').classList.remove('hidden');
      // 입장 폼이 아직 떠 있을 때만(아주 빨리 입장하면 이 타이머가 입장 뒤에 돌아 게임 키 입력을 이름 칸이 가로챌 수 있다)
      if (!input.touch) setTimeout(() => !$('join').classList.contains('hidden') && $('fName').focus(), 50);
      $('joinForm').onsubmit = (e) => {
        e.preventDefault();
        const n = $('fName').value.trim();
        if (!n) return;
        const y = $('fYear').value.trim();
        const profile = {
          n,
          y: /^\d{2}$/.test(y) ? y : '',
          m: major.value,
          c: state.c,
          ct: state.c === 'etc' ? $('fClubText').value.trim() : '',
          t: $('fTag').value.trim(),
          col: state.col,
        };
        $('join').classList.add('hidden');
        if (document.activeElement) document.activeElement.blur();
        resolve(profile);
      };
    });

  ui.showHud = () => $('hud').classList.remove('hidden');

  // ---------- 알림 ----------
  ui.toast = (text, ms = 3200) => {
    const t = el('div', { class: 'toast', text });
    $('toasts').append(t);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 450);
  };
  let bannerT = 0;
  ui.banner = (title, sub = '', gold = false, ms = 2600) => {
    const b = $('banner');
    b.querySelector('b').textContent = title;
    const sp = b.querySelector('span');
    sp.textContent = sub;
    sp.style.display = sub ? '' : 'none';
    b.classList.toggle('gold', gold);
    b.classList.remove('hidden');
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    clearTimeout(bannerT);
    bannerT = setTimeout(() => b.classList.add('hidden'), ms);
  };

  // ---------- 상호작용 안내 ----------
  let promptFn = null;
  ui.setPrompt = (text, fn) => {
    const p = $('prompt');
    promptFn = fn || null;
    if (!text) {
      p.classList.add('hidden');
      $('bAct').classList.add('hidden');
      return;
    }
    p.querySelector('span').textContent = text;
    p.classList.remove('hidden');
    $('bAct').classList.remove('hidden');
  };
  const usePrompt = () => promptFn && promptFn();
  $('prompt').addEventListener('click', usePrompt);
  $('bAct').addEventListener('click', usePrompt);
  input.on('interact', usePrompt);

  // ---------- 상단 정보 ----------
  ui.setPlace = (name) => {
    if ($('place').textContent !== name) $('place').textContent = name;
  };
  ui.setNet = (st, count) => {
    const n = $('net');
    n.classList.toggle('up', st.up > 0);
    n.classList.toggle('down', st.up === 0 && !st.trying);
    const label = st.up > 0 ? `접속 ${count}명` : st.trying ? '연결 중…' : '오프라인 (혼자 걷기)';
    const sp = n.querySelector('span');
    if (sp.textContent !== label) sp.textContent = label;
  };
  ui.setStats = (stamps, total, grades) => {
    const a = $('sStamp').querySelector('b');
    const b = $('sGrade').querySelector('b');
    const sa = `${stamps}/${total}`;
    if (a.textContent !== sa) {
      a.textContent = sa;
      pop($('sStamp'));
    }
    if (b.textContent !== String(grades)) {
      b.textContent = String(grades);
      pop($('sGrade'));
    }
  };
  function pop(node) {
    node.classList.remove('pop');
    void node.offsetWidth;
    node.classList.add('pop');
  }
  // 매 프레임 불리므로 마지막 값을 기억해 두고 바뀐 것만 고친다(처음 값은 index.html·CSS의 상태와 같다)
  const staminaBox = $('stamina');
  const staminaFill = staminaBox.firstElementChild;
  let staminaShow = false;
  let staminaTired = false;
  let staminaPct = 100;
  ui.setStamina = (v, tired, show) => {
    show = !!show;
    tired = !!tired;
    if (show !== staminaShow) {
      staminaShow = show;
      staminaBox.classList.toggle('show', show);
    }
    if (tired !== staminaTired) {
      staminaTired = tired;
      staminaBox.classList.toggle('tired', tired);
    }
    const p = Math.round(v * 100);
    if (p !== staminaPct) {
      staminaPct = p;
      staminaFill.style.width = p + '%';
    }
  };
  const timerBox = $('timer');
  let timerOn = false;
  let timerText = null;
  let timerSub = null;
  ui.setTimer = (text, sub) => {
    if (text == null) {
      if (timerOn) {
        timerOn = false;
        timerText = timerSub = null;
        timerBox.classList.add('hidden');
        syncBoss();
      }
      return;
    }
    if (!timerOn) {
      timerOn = true;
      timerBox.classList.remove('hidden');
      syncBoss(); // 타임어택 중에는 보스 막대를 숨긴다(같은 자리)
    }
    // 매 프레임 불리지만 글자는 0.1초 단위로만 바뀐다
    if (text === timerText && sub === timerSub) return;
    timerText = text;
    timerSub = sub;
    timerBox.replaceChildren(document.createTextNode(text), sub ? el('small', { text: sub }) : '');
  };

  // ---------- 채팅 ----------
  const log = $('chatlog');
  const chatInput = $('chatinput');
  if (input.touch) chatInput.placeholder = '채팅 입력';
  let sendFn = null;
  ui.chat = {
    add(name, text, color, cls = '') {
      const m = el('div', { class: 'msg ' + cls });
      if (name) m.append(el('b', { text: name, style: color ? `color:${color}` : '' }));
      m.append(document.createTextNode(text));
      log.append(m);
      while (log.children.length > 60) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
    },
    system(text) {
      ui.chat.add('', text, null, 'sys');
    },
    onSend(fn) {
      sendFn = fn;
    },
    focus() {
      chatInput.focus();
    },
  };
  $('chatform').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = chatInput.value.trim();
    if (t && sendFn && sendFn(t) !== false) chatInput.value = '';
    if (!input.touch) chatInput.blur();
  });
  chatInput.addEventListener('keydown', (e) => {
    // 한글 조합 중 Enter는 글자 확정이므로 보내지 않는다
    if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.stopPropagation();
  });
  input.on('chat', () => {
    if (!ui.panel.isOpen()) chatInput.focus();
  });

  // ---------- 패널 ----------
  let onClose = null;
  const panelEl = $('panel'); // 매 프레임 여러 모듈이 묻는다: 요소는 한 번만 찾아 둔다
  ui.panel = {
    isOpen: () => !panelEl.classList.contains('hidden'),
    open(title, body, opts = {}) {
      if (ui.panel.isOpen() && onClose) {
        const f = onClose;
        onClose = null;
        f();
      }
      $('panelTitle').textContent = title;
      $('panelBody').replaceChildren(...[].concat(body));
      $('panel').classList.toggle('wide', !!opts.wide);
      $('panel').classList.remove('hidden');
      onClose = opts.onClose || null;
      input.enabled = false;
      $('panel').querySelector('.card').scrollTop = 0;
    },
    close() {
      if (!ui.panel.isOpen()) return;
      $('panel').classList.add('hidden');
      $('panelBody').replaceChildren();
      input.enabled = true;
      const f = onClose;
      onClose = null;
      if (f) f();
    },
  };
  $('panelClose').addEventListener('click', ui.panel.close);
  $('panel').addEventListener('pointerdown', (e) => {
    if (e.target === $('panel')) ui.panel.close();
  });
  input.on('escape', ui.panel.close);
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && ui.panel.isOpen()) ui.panel.close();
  });

  // ---------- 난투 HUD: 체력·무기 막대·차량 계기·보스 ----------
  // 매 프레임 불려도 되도록 마지막 값을 기억해 두고, 값이 바뀔 때만 DOM을 고친다.
  const hud = $('hud');
  const HP_MAX = 100; // rules.js의 MAX_HP와 같다
  const CD_STEPS = 50; // 쿨다운 막을 그리는 단계 수
  const pct = (v01) => (v01 > 0 ? Math.min(100, Math.round(v01 * 100)) : 0);

  const hpBox = $('hp');
  const hpFill = hpBox.querySelector('.track i');
  const hpNum = hpBox.querySelector('b');
  let hpShown = false;
  let hpVal = -1;
  /** 난투 체력(0~100). null이면 숨긴다 */
  ui.setHP = (v) => {
    const show = Number.isFinite(v);
    if (show !== hpShown) {
      hpShown = show;
      hpBox.classList.toggle('hidden', !show);
      hud.classList.toggle('has-hp', show);
    }
    if (!show) return;
    const n = Math.max(0, Math.min(HP_MAX, Math.ceil(v)));
    if (n === hpVal) return;
    hpVal = n;
    hpFill.style.width = (n / HP_MAX) * 100 + '%';
    hpNum.textContent = String(n);
    hpBox.classList.toggle('low', n <= 30);
  };

  // 무기 칸의 아이콘·이름은 index.html에 적혀 있다(data-wpn 번호, data-name 이름)
  const wpnBtns = [];
  for (const b of document.querySelectorAll('#weapons button')) wpnBtns[Number(b.dataset.wpn)] = b;
  const wpnVeils = wpnBtns.map((b) => b.querySelector('i'));
  const wpnName = $('wpnName').querySelector('span');
  const bWpn = $('bWpn');
  const bWpnIcon = bWpn.querySelector('span');
  const bWpnVeil = bWpn.querySelector('i');
  let wpnCur = 0;
  let wpnCd = 0;
  let weaponFn = null;
  /** 무기 칸을 눌렀을 때 fn(번호 0~4) */
  ui.onWeapon = (fn) => {
    weaponFn = typeof fn === 'function' ? fn : null;
  };
  /** 지금 든 무기(0 = 평화)와 남은 쿨다운 비율(0~1). cd01을 생략하면 쿨다운 표시는 건드리지 않는다 */
  ui.setWeapon = (i, cd01) => {
    i |= 0;
    if (i < 0 || i >= wpnBtns.length) i = 0;
    if (i !== wpnCur) {
      if (wpnCd) {
        wpnVeils[wpnCur].style.transform = '';
        bWpnVeil.style.transform = '';
        wpnCd = 0;
      }
      wpnBtns[wpnCur].classList.remove('on');
      wpnCur = i;
      const b = wpnBtns[i];
      b.classList.add('on');
      wpnName.textContent = b.dataset.name;
      bWpnIcon.textContent = b.querySelector('span').textContent;
      hud.classList.toggle('armed', i > 0);
    }
    if (cd01 === undefined) return;
    const step = cd01 > 0 ? Math.min(CD_STEPS, Math.ceil(cd01 * CD_STEPS)) : 0;
    if (step === wpnCd) return;
    wpnCd = step;
    const s = step ? `scaleY(${step / CD_STEPS})` : '';
    wpnVeils[i].style.transform = s;
    bWpnVeil.style.transform = s;
  };

  const carBox = $('carhud');
  const carNum = carBox.querySelector('b');
  const carFill = carBox.querySelector('.track i');
  const bAtk = $('bAtk');
  const bJump = $('bJump');
  let carShown = false;
  let carKmh = -1;
  let carHp = -1;
  /** 탑승 중 계기: { kmh, hp01 }. null이면 숨기고 무기 막대를 되돌린다 */
  ui.setCar = (o) => {
    const show = !!o;
    if (show !== carShown) {
      carShown = show;
      carBox.classList.toggle('hidden', !show);
      hud.classList.toggle('has-car', show); // 무기 막대를 숨기고 그 자리를 쓴다(CSS)
      // 운전 중에는 공격 버튼이 경적, 점프 버튼이 브레이크다
      bAtk.textContent = show ? '경적' : '공격';
      bJump.textContent = show ? '브레이크' : '점프';
    }
    if (!show) return;
    const k = Math.min(999, Math.round(Math.abs(o.kmh) || 0));
    if (k !== carKmh) {
      carKmh = k;
      carNum.textContent = String(k);
    }
    const p = pct(o.hp01);
    if (p !== carHp) {
      carHp = p;
      carFill.style.width = p + '%';
      carBox.classList.toggle('low', p <= 30);
    }
  };

  const bossBox = $('bossbar');
  const bossName = bossBox.querySelector('b');
  const bossFill = bossBox.querySelector('.track i');
  let bossOn = false; // 호출자가 보여 달라고 한 상태
  let bossShown = false; // 실제로 보이는 상태
  let bossText = '';
  let bossHp = -1;
  // 타임어택 시계가 떠 있는 동안에는 보스 막대를 숨긴다(끝나면 다시 보인다)
  function syncBoss() {
    const show = bossOn && !timerOn;
    if (show === bossShown) return;
    bossShown = show;
    bossBox.classList.toggle('hidden', !show);
    hud.classList.toggle('has-boss', show); // 알림 줄(PC는 배너도)을 막대 아래로 내린다(CSS)
  }
  /** 보스 체력 막대: { name, hp01 }. null이면 숨긴다 */
  ui.setBoss = (o) => {
    bossOn = !!o;
    if (o) {
      const name = o.name == null ? '' : String(o.name);
      if (name !== bossText) {
        bossText = name;
        bossName.textContent = name;
      }
      const p = o.hp01 > 0 ? Math.min(200, Math.round(o.hp01 * 200)) : 0; // 0.5% 단위
      if (p !== bossHp) {
        bossHp = p;
        bossFill.style.width = p / 2 + '%';
      }
    }
    syncBoss();
  };

  // ---------- 다른 사람 소식 ----------
  // 남의 이벤트로 찍는 줄은 누구나 얼마든지 만들어 보낼 수 있으므로 보낸 사람이 아니라 전체 기준으로 제한한다:
  // 3줄까지는 바로, 그 뒤로는 6초에 1줄, 넘치면 버린다.
  const FEED_BURST = 3;
  const FEED_REFILL_MS = 6000;
  const FEED_MAX_LEN = 200;
  let feedTokens = FEED_BURST;
  let feedAt = performance.now();
  let mutedCheck = null;
  /** 숨김 목록 판별 함수 fn(id) — true를 돌려주면 그 사람 소식은 찍지 않는다 */
  ui.setMutedCheck = (fn) => {
    mutedCheck = typeof fn === 'function' ? fn : null;
  };
  /** 채팅창에 시스템 줄을 찍는다. mutedId는 그 소식의 주인공 id — 숨김 목록에 있으면 찍지 않는다. 찍었으면 true */
  ui.feed = (text, mutedId) => {
    if (text == null || text === '') return false;
    if (mutedId != null && mutedCheck && mutedCheck(mutedId)) return false;
    const now = performance.now();
    feedTokens = Math.min(FEED_BURST, feedTokens + (now - feedAt) / FEED_REFILL_MS);
    feedAt = now;
    if (feedTokens < 1) return false;
    feedTokens -= 1;
    let s = String(text);
    if (s.length > FEED_MAX_LEN) {
      // 이모지 같은 두 칸짜리 글자의 앞쪽 절반에서 끊기지 않게 한다
      const c = s.charCodeAt(FEED_MAX_LEN - 1);
      s = s.slice(0, c >= 0xd800 && c <= 0xdbff ? FEED_MAX_LEN - 1 : FEED_MAX_LEN) + '…';
    }
    ui.chat.system(s);
    return true;
  };

  // ---------- 메뉴·감정표현·터치 버튼 ----------
  const menuFns = {};
  ui.onMenu = (name, fn) => {
    menuFns[name] = fn;
  };
  for (const b of document.querySelectorAll('#menu button')) b.addEventListener('click', () => menuFns[b.dataset.menu] && menuFns[b.dataset.menu]());
  $('minimap').addEventListener('click', () => menuFns.map && menuFns.map());
  $('net').addEventListener('click', () => menuFns.players && menuFns.players());
  for (const k of ['stamps', 'players', 'map', 'help']) input.on(k, () => (ui.panel.isOpen() ? ui.panel.close() : menuFns[k] && menuFns[k]()));
  for (const b of document.querySelectorAll('#emotes button')) b.addEventListener('click', () => input.emit('emote', Number(b.dataset.emote)));

  input.bindJoystick($('joy'), $('knob'));
  // 누르고 있는 버튼: 손가락을 떼거나, 취소되거나, 포인터 캡처를 잃으면 반드시 풀린다
  // (누른 채 버튼 밖으로 미끄러져도 뗄 때까지는 누른 것으로 친다).
  // 마지막으로 누른 포인터 하나만 기억한다 — 떼는 이벤트를 놓치더라도 다음에 눌렀다 떼면 다시 맞춰진다.
  const holdButton = (btn, down, up) => {
    let pid = null;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        btn.setPointerCapture(e.pointerId);
      } catch (err) {
        /* 이미 떨어진 포인터 */
      }
      pid = e.pointerId;
      down();
    });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      up();
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('lostpointercapture', end);
    // 길게 누르면 뜨는 메뉴(일부 터치 기기)가 누르고 있는 입력을 끊지 않게
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  holdButton(
    bJump,
    () => {
      input.jump = true;
      input.brakeTouch = true; // 운전 중에는 브레이크(누르는 동안)
    },
    () => {
      input.brakeTouch = false;
    },
  );
  holdButton(
    bAtk,
    () => {
      input.fireTouch = true; // 누르는 동안 공격(자동 조준)
      if (input.enabled) input.emit('fire'); // 키보드 F의 첫 눌림과 같다(운전 중 경적)
    },
    () => {
      input.fireTouch = false;
    },
  );
  // 무기 바꾸기: 다른 손가락으로 스틱을 잡고 있으면 click이 생기지 않는 브라우저가 있어 pointerdown에서 바로 처리한다
  const onPress = (btn, fn) =>
    btn.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return; // 마우스는 왼쪽 버튼만
      e.preventDefault();
      fn();
    });
  onPress(bWpn, () => input.enabled && input.emit('weapon'));
  for (const b of wpnBtns) {
    const i = Number(b.dataset.wpn);
    onPress(b, () => weaponFn && weaponFn(i));
  }
  $('bRun').addEventListener('click', () => {
    input.runToggle = !input.runToggle;
    $('bRun').classList.toggle('on', input.runToggle);
  });

  return ui;
}
