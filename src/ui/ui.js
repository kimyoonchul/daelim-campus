// 화면 UI: 입장 폼, 채팅, 알림, 상호작용 안내, 패널. 사용자 입력은 항상 textContent로만 넣는다.
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
      if (!input.touch) setTimeout(() => $('fName').focus(), 50);
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
  ui.setStamina = (v, tired, show) => {
    const s = $('stamina');
    s.classList.toggle('show', show);
    s.classList.toggle('tired', tired);
    s.firstElementChild.style.width = Math.round(v * 100) + '%';
  };
  ui.setTimer = (text, sub) => {
    const t = $('timer');
    if (text == null) {
      t.classList.add('hidden');
      return;
    }
    t.classList.remove('hidden');
    t.replaceChildren(document.createTextNode(text), sub ? el('small', { text: sub }) : '');
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
  ui.panel = {
    isOpen: () => !$('panel').classList.contains('hidden'),
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
  $('bJump').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    input.jump = true;
  });
  $('bRun').addEventListener('click', () => {
    input.runToggle = !input.runToggle;
    $('bRun').classList.toggle('on', input.runToggle);
  });

  return ui;
}
