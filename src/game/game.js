// 게임 진행: 상호작용, 스탬프 투어, A+ 줍기, 등굣길 타임어택, 축제 불꽃, 전산관 출입, 각종 패널.
import * as THREE from 'three';
import data from '../../data/campus-data.js';
import { el } from '../ui/ui.js';
import { CLUBS, VERSION } from '../config.js';
import { BUILDING_INFO, CLUB_INFO, DEPT_HISTORY, TIPS, SOURCES } from './content.js';
import { openQuiz, openSnake, openIdea } from './minigames.js';
import { createFx } from './fx.js';
import { sfx } from '../core/sfx.js';
import { heightAt } from '../world/heightfield.js';
import { zoneAt, occAt, OCC } from '../world/occupancy.js';
import { resample, inPoly } from '../world/geom.js';
import { makeRng } from '../core/rng.js';
import { EMOTES } from '../player/avatar.js';

const fmtTime = (ms) => {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};
const clubOf = (p) => CLUBS.find((c) => c.id === p.c);
const tagLine = (p) => {
  const a = [];
  const c = clubOf(p);
  if (c) a.push(c.name);
  else if (p.c === 'etc' && p.ct) a.push(p.ct);
  if (p.y) a.push(p.y + '학번');
  if (p.m) a.push(p.m);
  return a.join(' · ');
};

function coinTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(50, 44, 6, 64, 64, 64);
  gr.addColorStop(0, '#fff6b0');
  gr.addColorStop(0.6, '#ffcf33');
  gr.addColorStop(1, '#d99a00');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(64, 64, 62, 0, 7);
  g.fill();
  g.strokeStyle = '#a86f00';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(64, 64, 54, 0, 7);
  g.stroke();
  g.fillStyle = '#7a4b00';
  g.font = 'bold 62px "Jua", "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('A+', 64, 68);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createGame({ engine, world, player, cam, input, ui, net, remotes, store, minimap, profile }) {
  const props = world.props;
  const signs = props.signs;
  const anchors = props.anchors;
  const TOTAL = signs.length;
  const stamps = store.data.stamps;
  const fx = createFx(engine);
  const interactables = [];
  const records = new Map(); // 접속 중에 본 타임어택 기록
  const jsDoor = world.doors.find((d) => d.key === 'jeonsan');
  let savedCam = null;
  let boostT = 0;
  let frame = 0;

  const addI = (zone, x, z, r, label, use) => interactables.push({ zone, x, z, r, label, use });
  const stampCount = () => Object.keys(stamps).length;
  const refreshStats = () => ui.setStats(stampCount(), TOTAL, store.data.grades || 0);

  // ---------- 스탬프 ----------
  const refreshRings = () => {
    for (const s of signs) s.ring.material.color.setHex(stamps[s.key] ? 0x3ddc84 : 0xffd23f);
  };
  function graduate() {
    profile.g = 1;
    store.set('profile', profile);
    player.avatar.setProfile(profile);
    net.setProfile(profile);
    net.sendEvent('grad');
    setTimeout(() => {
      ui.banner('졸업을 축하합니다!', '스탬프 투어 완주 · 학사모를 썼어요 🎓', true, 5200);
      sfx.fanfare();
      fx.firework(player.pos.x, player.pos.y, player.pos.z);
      ui.chat.system('🎓 스탬프 15개를 모두 모았어요. 머리 위 학사모를 확인해 보세요!');
    }, 2900);
  }
  function giveStamp(s) {
    if (stamps[s.key]) return;
    stamps[s.key] = Date.now();
    store.save();
    refreshRings();
    const n = stampCount();
    sfx.stamp();
    fx.sparkle(s.x, s.y + 1.2, s.z, 0xff6b6b, 44);
    ui.banner('스탬프 쾅!', `${s.letter} ${s.name} · ${n}/${TOTAL}`);
    refreshStats();
    if (n === TOTAL) graduate();
  }

  // ---------- 패널들 ----------
  function showBuilding(key) {
    const b = world.doors.find((d) => d.key === key);
    const info = BUILDING_INFO[key];
    if (!b || !info) return;
    const body = [
      el('p', { text: info.desc }),
      el('ul', { class: 'floors' }, info.floors.map(([f, t]) => el('li', {}, [el('b', { text: f }), el('span', { text: t })]))),
      el('p', { class: 'muted', text: stamps[key] ? '✅ 스탬프를 찍은 곳이에요.' : '안내판 앞 노란 원에 서면 스탬프가 찍혀요.' }),
    ];
    if (key === 'jeonsan') body.push(el('p', { class: 'muted', text: '입구로 들어가면 4층 로비와 5층 동아리방을 둘러볼 수 있어요. 실내 방 배치는 상상으로 그렸습니다.' }));
    body.push(el('p', { class: 'muted' }, ['층별 안내 출처: ', el('a', { href: SOURCES.campusMap, target: '_blank', rel: 'noopener', text: '대림대학교 캠퍼스맵', style: 'color:#7fd0ff' }), ' (2026년 11월 확인)']));
    ui.panel.open(`${b.letter} ${b.name}`, body);
  }

  function showStamps() {
    const n = stampCount();
    const grid = el(
      'div',
      { class: 'stampgrid' },
      signs.map((s) => el('div', { class: 'stamp' + (stamps[s.key] ? ' got' : '') }, [el('div', {}, [el('i', { text: s.letter }), document.createTextNode(s.name)])])),
    );
    ui.panel.open('스탬프북', [
      el('p', { text: `건물 15곳 중 ${n}곳을 다녀왔어요.` + (n === TOTAL ? ' 완주! 🎓' : ' 모두 모으면 학사모를 씁니다.') }),
      grid,
      el('p', { class: 'muted', text: `모은 A+: ${store.data.grades || 0}개 · 등굣길 최고 기록: ${store.data.bestClimb ? fmtTime(store.data.bestClimb) : '아직 없음'} · 퀴즈 최고 ${store.data.quizBest || 0}/8 · 스네이크 최고 ${store.data.snakeBest || 0}점` }),
    ]);
  }

  function showProfile(r) {
    const p = r.avatar.profile;
    const muted = store.data.muted.includes(r.id);
    ui.panel.open(p.n, [
      el('p', {}, [el('span', { class: 'tag', text: tagLine(p) || '손님' }), p.g ? el('span', { class: 'tag', text: '🎓 스탬프 완주' }) : null]),
      p.t ? el('p', { class: 'q', style: 'font-size:17px', text: `“${p.t}”` }) : el('p', { class: 'muted', text: '한마디를 남기지 않았어요.' }),
      el('div', { class: 'btnrow' }, [
        el('button', {
          class: 'btn',
          text: muted ? '채팅 다시 보기' : '이 사람 채팅 숨기기',
          onclick: () => {
            const i = store.data.muted.indexOf(r.id);
            if (i >= 0) store.data.muted.splice(i, 1);
            else store.data.muted.push(r.id);
            store.save();
            ui.panel.close();
            ui.toast(i >= 0 ? '채팅을 다시 표시합니다' : '이 접속에서는 채팅을 숨깁니다');
          },
        }),
      ]),
    ]);
  }

  function showPlayers() {
    const rows = [
      el('li', {}, [
        el('span', { class: 'dot', style: `background:${profile.col}` }),
        el('div', { class: 'who' }, [el('b', { text: profile.n + ' (나)' }), el('small', { text: tagLine(profile) || '손님' })]),
      ]),
    ];
    for (const r of remotes.list()) {
      const p = r.avatar.profile;
      const where = r.zone === 'campus' ? '캠퍼스' : r.zone === 'js4' ? '전산관 4층' : '전산관 5층';
      rows.push(
        el('li', {}, [
          el('span', { class: 'dot', style: `background:${p.col}` }),
          el('div', { class: 'who' }, [el('b', { text: p.n }), el('small', { text: [tagLine(p), where, p.t ? `“${p.t}”` : ''].filter(Boolean).join(' · ') })]),
          el('button', { text: '프로필', onclick: () => showProfile(r) }),
        ]),
      );
    }
    const st = net.status();
    ui.panel.open(`접속자 ${rows.length}명`, [
      el('ul', { class: 'plist' }, rows),
      el('p', { class: 'muted', text: st.up > 0 ? '같은 시간에 접속한 사람만 보입니다. 대화는 어디에도 저장되지 않아요.' : '지금은 서버에 연결되지 않아 혼자 걷는 중입니다. 잠시 뒤 자동으로 다시 연결해요.' }),
    ]);
  }

  const mapMarkers = () => {
    const m = [];
    if (player.zone === 'campus') for (const s of signs) if (!stamps[s.key]) m.push({ x: s.x, z: s.z, color: '#ffd23f', r: 6 });
    if (climb.state === 'run' && anchors.climbGoal) m.push({ x: anchors.climbGoal.x, z: anchors.climbGoal.z, color: '#2fbf71', r: 10 });
    return m;
  };
  const mapOthers = () => remotes.list().filter((r) => r.zone === 'campus').map((r) => ({ x: r.x, z: r.z, color: r.avatar.profile.col }));

  function showMap() {
    const cvs = minimap.big(player.zone === 'campus' ? player : null, mapOthers(), mapMarkers());
    ui.panel.open('캠퍼스 지도', [cvs, el('p', { class: 'muted', text: '노란 점: 아직 안 찍은 스탬프 · 색 점: 다른 접속자 · 지도 자료 © OpenStreetMap contributors' })], { wide: true });
  }

  function showHelp() {
    const k = (a, b) => [el('kbd', { text: a }), el('span', { text: b })];
    const keys = input.touch
      ? [...k('왼쪽 스틱', '이동 (끝까지 밀면 달리기)'), ...k('화면 드래그', '시점 돌리기'), ...k('두 손가락', '확대·축소'), ...k('노란 버튼', '문 열기·안내 보기')]
      : [...k('W A S D', '이동'), ...k('Shift', '달리기'), ...k('Space', '점프'), ...k('마우스 드래그', '시점 돌리기'), ...k('휠', '확대·축소'), ...k('E', '문 열기·안내 보기'), ...k('Enter', '채팅'), ...k('1 ~ 6', '감정표현'), ...k('M · B · Tab', '지도 · 스탬프북 · 접속자')];
    ui.panel.open('도움말', [
      el('div', { class: 'keys' }, keys),
      el('p', { style: 'margin-top:12px', text: '할 수 있는 것' }),
      el('ul', { style: 'margin:4px 0 0;padding-left:18px' }, TIPS.map((t) => el('li', { text: t }))),
      el('div', { class: 'btnrow' }, [
        el('button', {
          class: 'btn',
          text: sfx.isEnabled() ? '🔊 소리 끄기' : '🔇 소리 켜기',
          onclick: (e) => {
            sfx.setEnabled(!sfx.isEnabled());
            e.currentTarget.textContent = sfx.isEnabled() ? '🔊 소리 끄기' : '🔇 소리 켜기';
          },
        }),
        el('button', {
          class: 'btn',
          text: '✏️ 프로필 다시 쓰기',
          onclick: () => location.reload(),
        }),
      ]),
      el('p', { class: 'muted', style: 'margin-top:12px', text: `대림 캠퍼스 온라인 v${VERSION} · 대림대학교 공식 서비스가 아닌 동문 개인 프로젝트입니다. 건물 배치는 OpenStreetMap, 높낮이는 SRTM 자료와 사진을 참고해 만들었고 실제와 다를 수 있습니다. 지도 자료 © OpenStreetMap contributors.` }),
    ]);
  }

  function showElevator() {
    const cur = player.zone;
    const go = (zid) => {
      ui.panel.close();
      if (zid === cur) return;
      const z = world.zones[zid];
      sfx.door();
      player.place(zid, z.elevator.x, z.elevator.z, zid === 'js4' ? Math.PI : Math.PI);
      ui.toast(`띵동! 전산관 ${z.name}입니다`);
    };
    const btn = (label, sub, zid) => el('button', { type: 'button', class: zid && zid === cur ? 'cur' : '', disabled: !zid, onclick: () => zid && go(zid) }, [document.createTextNode(label), el('small', { text: sub })]);
    ui.panel.open('전산관 엘리베이터', [
      el('div', { class: 'elev' }, [
        btn('5F', '실습실 · 동아리방 · 옥외휴게소', 'js5'),
        btn('4F', '로비 · Smart Station · 교직원 식당', 'js4'),
        btn('3F', '학부사무실 (준비 중)', null),
        btn('2F', '실습실 · 합동강의실 (준비 중)', null),
        btn('1F', '제과제빵과 실습실 (준비 중)', null),
      ]),
      el('p', { class: 'muted', style: 'margin-top:10px', text: '지금은 4층과 5층만 둘러볼 수 있어요.' }),
    ]);
  }

  function showHistory() {
    ui.panel.open('학과 연혁', [
      el('p', { text: '전산관을 지켜 온 컴퓨터 계열의 발자취.' }),
      el('ul', { class: 'floors' }, DEPT_HISTORY.map(([y, t]) => el('li', {}, [el('b', { style: 'flex:0 0 52px', text: y }), el('span', { text: t })]))),
      el('p', { class: 'muted', text: '출처: 학과 홈페이지 연혁' }),
    ]);
  }

  function showClub(id) {
    const c = CLUB_INFO[id];
    if (!c) return;
    const mine = profile.c === id;
    ui.panel.open(c.name, [
      el('p', {}, [el('span', { class: 'tag', style: `background:${c.color};color:#fff`, text: c.full })]),
      el('p', { text: c.desc }),
      mine ? el('p', { text: '🏠 우리 동아리방에 오신 걸 환영합니다, 선배님!' }) : null,
      el('p', { class: 'muted' }, ['방 안의 기계에서 ‘', document.createTextNode(c.game), '’을(를) 해 볼 수 있어요. 소개 출처: ', el('a', { href: SOURCES.clubs, target: '_blank', rel: 'noopener', text: '학과 홈페이지 전공동아리 안내', style: 'color:#7fd0ff' })]),
    ]);
  }

  function showNotice() {
    const rows = [];
    const all = [{ p: profile, me: true }, ...remotes.list().map((r) => ({ p: r.avatar.profile }))];
    for (const { p, me } of all) if (p.t) rows.push(el('li', {}, [el('span', { class: 'dot', style: `background:${p.col}` }), el('div', { class: 'who' }, [el('b', { text: p.n + (me ? ' (나)' : '') }), el('small', { text: `“${p.t}”` })])]));
    ui.panel.open('휴게홀 알림판', [
      el('p', { text: '지금 접속한 사람들이 남긴 한마디가 붙어 있어요.' }),
      rows.length ? el('ul', { class: 'plist' }, rows) : el('p', { class: 'muted', text: '아직 붙은 쪽지가 없어요. 입장할 때 ‘한마디’를 적으면 여기에 붙습니다.' }),
    ]);
  }

  function showBear() {
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    ui.panel.open('안내 곰', [
      el('p', { class: 'q', style: 'font-size:18px', text: `“어서 와요, ${profile.n}! 언덕이 좀 가파르죠?”` }),
      el('p', { text: tip }),
      el('ul', { class: 'floors' }, [
        el('li', {}, [el('b', { style: 'flex:0 0 30px', text: '📍' }), el('span', { text: `스탬프 투어 ${stampCount()}/${TOTAL}` })]),
        el('li', {}, [el('b', { style: 'flex:0 0 30px', text: '🏃' }), el('span', { text: `등굣길 타임어택 최고 ${store.data.bestClimb ? fmtTime(store.data.bestClimb) : '기록 없음'}` })]),
        el('li', {}, [el('b', { style: 'flex:0 0 30px', text: '🅰' }), el('span', { text: `모은 A+ ${store.data.grades || 0}개` })]),
      ]),
      el('div', { class: 'btnrow' }, [el('button', { class: 'btn', text: '다른 이야기', onclick: showBear }), el('button', { class: 'btn', text: '도움말 보기', onclick: showHelp })]),
    ]);
  }

  // ---------- 등굣길 타임어택 ----------
  const climb = { state: 'idle', t0: 0, timers: [] };
  function cancelClimb(msg) {
    for (const t of climb.timers) clearTimeout(t);
    climb.timers = [];
    climb.state = 'idle';
    player.climbFrozen = false;
    ui.setTimer(null);
    if (msg) ui.toast(msg);
  }
  function startClimb() {
    ui.panel.close();
    cancelClimb();
    const s = anchors.climbStart;
    player.place('campus', s.x + 1.6, s.z + 1.2, Math.PI);
    climb.state = 'count';
    player.climbFrozen = true;
    ['3', '2', '1'].forEach((n, i) =>
      climb.timers.push(
        setTimeout(() => {
          ui.banner(n, '', false, 800);
          sfx.beep();
        }, i * 800),
      ),
    );
    climb.timers.push(
      setTimeout(() => {
        ui.banner('출발!', '수암관까지 달려요', true, 1200);
        sfx.beep(true);
        climb.state = 'run';
        climb.t0 = performance.now();
        player.climbFrozen = false;
        player.stamina = 1;
      }, 2400),
    );
  }
  function finishClimb() {
    const t = performance.now() - climb.t0;
    const best = store.data.bestClimb || 0;
    const isBest = !best || t < best;
    if (isBest) store.set('bestClimb', Math.round(t));
    cancelClimb();
    ui.banner('도착!', `${fmtTime(t)}${isBest ? ' · 신기록!' : ''}`, true, 4200);
    sfx.fanfare();
    const g = anchors.climbGoal;
    fx.firework(g.x, g.y, g.z);
    records.set('me', { n: profile.n, t });
    net.sendEvent('rec', { t: Math.round(t) });
    ui.chat.system(`🏃 등굣길 ${fmtTime(t)}! ${isBest ? '내 최고 기록이에요.' : `(최고 ${fmtTime(best)})`}`);
  }
  function showClimb() {
    const list = [...records.values()].sort((a, b) => a.t - b.t).slice(0, 8);
    ui.panel.open('등굣길 타임어택', [
      el('p', { text: '정문에서 캠퍼스 꼭대기 수암관까지, 그 시절 지각 직전처럼 달려 보세요. 길은 자유! 무빙워크를 타도 됩니다.' }),
      el('p', { class: 'muted', text: `내 최고 기록: ${store.data.bestClimb ? fmtTime(store.data.bestClimb) : '아직 없음'}` }),
      list.length ? el('ul', { class: 'floors' }, list.map((r, i) => el('li', {}, [el('b', { text: `${i + 1}위` }), el('span', { text: `${r.n} — ${fmtTime(r.t)}` })]))) : el('p', { class: 'muted', text: '이번 접속에서 아직 기록이 없어요. 첫 기록의 주인공이 되어 보세요.' }),
      el('div', { class: 'btnrow' }, [el('button', { class: 'btn primary', text: '🏁 시작', onclick: startClimb })]),
    ]);
  }

  // ---------- A+ 줍기 ----------
  const coins = [];
  {
    const rnd = makeRng(1234);
    const tex = coinTexture();
    const geo = new THREE.CylinderGeometry(0.55, 0.55, 0.09, 24);
    geo.rotateX(Math.PI / 2);
    const side = new THREE.MeshLambertMaterial({ color: 0xe0a100 });
    const face = new THREE.MeshBasicMaterial({ map: tex });
    const spots = [];
    for (const r of data.roads) {
      if (!r.inCampus || r.bridge || r.conveying || !(r.kind === 'service' || r.kind === 'footway' || r.kind === 'steps')) continue;
      const rs = resample(r.pts, 31);
      for (let i = 1; i < rs.length - 1; i++) {
        const x = rs[i][0] + rnd.range(-1.6, 1.6);
        const z = rs[i][1] + rnd.range(-1.6, 1.6);
        if (zoneAt(x, z) !== 1 || world.campus.collider.solidAt(x, z) || occAt(x, z) === OCC.BUILDING) continue;
        if (spots.some((s) => Math.hypot(s[0] - x, s[1] - z) < 20)) continue;
        spots.push([x, z]);
      }
    }
    // 운동장과 광장에도 몇 개
    for (const a of data.areas) {
      if (a.kind !== 'field' && a.kind !== 'square') continue;
      for (let k = 0; k < (a.kind === 'field' ? 5 : 2); k++) {
        for (let t = 0; t < 30; t++) {
          const x = rnd.range(Math.min(...a.poly.map((p) => p[0])), Math.max(...a.poly.map((p) => p[0])));
          const z = rnd.range(Math.min(...a.poly.map((p) => p[1])), Math.max(...a.poly.map((p) => p[1])));
          if (!inPoly(x, z, a.poly) || spots.some((s) => Math.hypot(s[0] - x, s[1] - z) < 12)) continue;
          spots.push([x, z]);
          break;
        }
      }
    }
    for (const [x, z] of spots) {
      const m = new THREE.Mesh(geo, [side, face, face]);
      const y = heightAt(x, z) + 1.15;
      m.position.set(x, y, z);
      world.campus.group.add(m);
      coins.push({ x, y, z, mesh: m, back: 0, ph: rnd() * 6 });
    }
  }

  // ---------- 상호작용 지점 등록 ----------
  for (const s of signs) addI('campus', s.x, s.z, 3.0, `${s.name} 안내 보기`, () => showBuilding(s.key));
  if (jsDoor) {
    addI('campus', jsDoor.x, jsDoor.z, 2.8, '전산관 들어가기', () => {
      sfx.door();
      savedCam = { pitch: cam.pitch, dist: cam.dist, yaw: cam.yaw };
      const z = world.zones.js4;
      player.place('js4', z.spawn.x, z.spawn.z, 0);
      cam.yaw = Math.PI;
      cam.pitch = 1.08;
      cam.dist = 14;
      ui.toast('전산관 4층 로비 · 엘리베이터로 5층 동아리방에 갈 수 있어요');
    });
  }
  if (anchors.bear) addI('campus', anchors.bear.x - 1.0, anchors.bear.z - 1.2, 3.2, '안내 곰과 이야기하기', showBear);
  if (anchors.climbStart) addI('campus', anchors.climbStart.x + 1.2, anchors.climbStart.z + 0.8, 3.2, '등굣길 타임어택', showClimb);
  if (anchors.vending)
    addI('campus', anchors.vending.x, anchors.vending.z, 2.6, '☕ 커피 한 잔 (체력 회복)', () => {
      boostT = 50;
      player.stamina = 1;
      player.tired = false;
      sfx.pick();
      ui.banner('카페인 충전!', '50초 동안 지치지 않아요', true, 2200);
      player.avatar.say('캬~ 이 맛이지');
    });
  let lastFw = 0;
  if (anchors.field)
    addI('campus', anchors.field.x, anchors.field.z, 3.6, '🎆 축제 불꽃 쏘기', () => {
      const now = performance.now();
      if (now - lastFw < 5000) {
        ui.toast('불꽃을 장전하는 중…');
        return;
      }
      lastFw = now;
      fx.firework(anchors.field.x, anchors.field.y, anchors.field.z);
      net.sendEvent('fw', { x: Math.round(anchors.field.x), z: Math.round(anchors.field.z) });
      if (engine.state.time === 'day') ui.toast('밤(🌙)에 쏘면 훨씬 예뻐요');
    });
  for (const zid of ['js4', 'js5']) {
    const z = world.zones[zid];
    if (!z) continue;
    for (const s of z.spots) {
      if (s.kind === 'exit')
        addI(zid, s.x, s.z, s.r, '밖으로 나가기 (광장)', () => {
          sfx.door();
          const d = jsDoor;
          player.place('campus', d.x + d.nx * 1.4, d.z + d.nz * 1.4, Math.atan2(d.nx, d.nz));
          if (savedCam) {
            cam.pitch = savedCam.pitch;
            cam.dist = savedCam.dist;
            cam.yaw = savedCam.yaw + Math.PI;
          }
        });
      else if (s.kind === 'elevator') addI(zid, s.x, s.z, s.r, '엘리베이터 타기', showElevator);
      else if (s.kind === 'guide') addI(zid, s.x, s.z, s.r, '층별 안내 보기', () => showBuilding('jeonsan'));
      else if (s.kind === 'history') addI(zid, s.x, s.z, s.r, '학과 연혁 보기', showHistory);
      else if (s.kind === 'notice') addI(zid, s.x, s.z, s.r, '알림판 보기', showNotice);
      else if (s.kind === 'club') addI(zid, s.x, s.z, s.r, '동아리 소개 보기', () => showClub({ j: 'jigongmo', c: 'common', m: 'mobidic' }[s.room]));
      else if (s.kind === 'quiz')
        addI(zid, s.x, s.z, s.r, '지식 나눔 퀴즈 풀기', () =>
          openQuiz({
            ui,
            store,
            onDone: (sc, n) => {
              if (sc >= 6) net.sendEvent('quiz', { s: sc });
              ui.chat.system(`🧠 지공모 퀴즈 ${sc}/${n}점!`);
            },
          }),
        );
      else if (s.kind === 'idea')
        addI(zid, s.x, s.z, s.r, '창업 아이템 뽑기', () =>
          openIdea({
            ui,
            onShare: (text) => {
              if (net.sendChat(text)) {
                ui.chat.add(profile.n, text, (clubOf(profile) || {}).color || '#cfe3ff', 'me');
                player.avatar.say(text);
                ui.toast('채팅에 공유했어요');
              }
            },
          }),
        );
      else if (s.kind === 'snake') addI(zid, s.x, s.z, s.r, '피처폰 스네이크 하기', () => openSnake({ ui, store, onDone: (sc) => sc >= 10 && ui.chat.system(`🐍 스네이크 ${sc}점!`) }));
    }
  }

  // ---------- 통신 이벤트 ----------
  const peerFw = new Map();
  net.on('event', (id, msg, peer) => {
    const name = peer.profile.n;
    if (msg.k === 'rec' && Number.isFinite(msg.t) && msg.t >= 15000 && msg.t <= 3600000) {
      records.set(id, { n: name, t: msg.t });
      ui.chat.system(`🏃 ${name} 님이 등굣길을 ${fmtTime(msg.t)}에 주파했어요!`);
    } else if (msg.k === 'fw' && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
      const now = performance.now();
      if (now - (peerFw.get(id) || 0) < 3500) return;
      peerFw.set(id, now);
      const x = Math.max(-300, Math.min(300, msg.x));
      const z = Math.max(-300, Math.min(300, msg.z));
      fx.firework(x, heightAt(x, z), z);
    } else if (msg.k === 'grad') ui.chat.system(`🎓 ${name} 님이 스탬프 투어를 완주했어요!`);
    else if (msg.k === 'quiz' && Number.isFinite(msg.s)) ui.chat.system(`🧠 ${name} 님이 지공모 퀴즈에서 ${Math.max(0, Math.min(8, msg.s | 0))}점을 받았어요`);
  });
  net.on('chat', (id) => {
    if (!store.data.muted.includes(id)) sfx.chat();
  });
  fx.onBoom = () => {
    if (player.zone === 'campus') sfx.boom();
  };

  // ---------- 캐릭터 이벤트 ----------
  player.on('jump', () => sfx.jump());
  player.on('tired', () => {
    sfx.tired();
    player.avatar.say('헉… 헉… 언덕이…');
    ui.toast('숨이 차요! 잠깐 걸으면 회복돼요');
  });
  player.on('zone', () => {
    if (climb.state !== 'idle') cancelClimb('타임어택이 취소됐어요');
  });

  // 다른 사람 아바타를 누르면 프로필
  const v = new THREE.Vector3();
  input.on('tap', ({ x, y }) => {
    if (ui.panel.isOpen()) return;
    const rect = engine.renderer.domElement.getBoundingClientRect();
    let best = null;
    let bd = 52;
    for (const r of remotes.list()) {
      if (!r.avatar.group.visible) continue;
      v.set(r.x, r.y + 1.2, r.z).project(engine.camera);
      if (v.z > 1) continue;
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    if (best) showProfile(best);
  });

  // ---------- 메뉴 ----------
  ui.onMenu('stamps', showStamps);
  ui.onMenu('players', showPlayers);
  ui.onMenu('map', showMap);
  ui.onMenu('help', showHelp);
  ui.onMenu('emote', () => {
    ui.panel.open('감정표현', [
      el(
        'div',
        { class: 'emogrid' },
        EMOTES.filter(Boolean).map((e) =>
          el(
            'button',
            {
              type: 'button',
              onclick: () => {
                ui.panel.close();
                player.avatar.playEmote(e.id);
              },
            },
            [document.createTextNode(e.icon), el('small', { text: e.name })],
          ),
        ),
      ),
      el('p', { class: 'muted', style: 'margin-top:10px', text: '움직이면 동작이 풀려요. 키보드에서는 숫자 1~6.' }),
    ]);
  });
  ui.onMenu('time', () => {
    const order = ['day', 'sunset', 'night'];
    const next = order[(order.indexOf(engine.state.time) + 1) % order.length];
    engine.setTime(next);
    store.set('time', next);
    ui.toast({ day: '☀️ 낮', sunset: '🌇 노을', night: '🌙 밤 — 운동장에서 불꽃을 쏴 보세요' }[next]);
  });

  // ---------- 장소 이름 ----------
  const field = data.areas.find((a) => a.kind === 'field');
  function placeName() {
    if (player.zone !== 'campus') return `전산관 ${world.active.name}`;
    const { x, z } = player.pos;
    let best = null;
    let bd = 34;
    for (const d of world.doors) {
      const dd = Math.hypot(d.x - x, d.z - z);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    if (best) return best.key === 'gate' ? '정문' : best.name;
    if (field && inPoly(x, z, field.poly)) return '대운동장';
    if (z > 130) return '정문 진입로';
    return '캠퍼스';
  }

  let curPrompt = null;
  const game = {
    fx,
    climb,
    coins,
    interactables,
    showBuilding,
    start() {
      refreshRings();
      refreshStats();
      setTimeout(() => ui.toast('📍 건물 앞 노란 원에 서면 스탬프가 찍혀요'), 2500);
      setTimeout(() => ui.toast('🐻 정문의 안내 곰에게 말을 걸어 보세요 (E)'), 7000);
      setTimeout(() => ui.toast('🏃 빨간 깃발에서 등굣길 타임어택을 시작할 수 있어요'), 12000);
    },
    update(dt) {
      frame++;
      const t = engine.time;
      props.update(dt, t);
      fx.update(dt);
      if (boostT > 0) {
        boostT -= dt;
        player.stamina = 1;
        player.tired = false;
      }
      const px = player.pos.x;
      const pz = player.pos.z;
      const campus = player.zone === 'campus';

      // A+ 줍기
      for (const c of coins) {
        if (c.back > 0) {
          c.back -= dt;
          if (c.back <= 0) c.mesh.visible = true;
          continue;
        }
        c.mesh.rotation.y = t * 2.4 + c.ph;
        c.mesh.position.y = c.y + Math.sin(t * 2.2 + c.ph) * 0.14;
        if (campus && Math.abs(px - c.x) < 1.4 && Math.abs(pz - c.z) < 1.4 && Math.abs(player.pos.y + 1 - c.y) < 2.4) {
          c.mesh.visible = false;
          c.back = 210;
          store.data.grades = (store.data.grades || 0) + 1;
          store.save();
          sfx.pick();
          fx.sparkle(c.x, c.y, c.z);
          refreshStats();
          if (store.data.grades === 1) ui.toast('🅰 A+를 주웠어요! 학점은 다다익선');
          else if (store.data.grades % 10 === 0) ui.banner(`A+ ${store.data.grades}개!`, '장학금 각', true, 1800);
        }
      }

      if (campus) {
        for (const s of signs) if (!stamps[s.key] && Math.abs(px - s.x) < 2.3 && Math.abs(pz - s.z) < 2.3) giveStamp(s);
      }

      // 타임어택 진행
      if (climb.state === 'run') {
        const e = performance.now() - climb.t0;
        ui.setTimer('🏃 ' + fmtTime(e), store.data.bestClimb ? `최고 ${fmtTime(store.data.bestClimb)}` : '수암관까지!');
        const g = anchors.climbGoal;
        if (g && Math.hypot(px - g.x, pz - g.z) < 5.5) finishClimb();
        else if (e > 15 * 60000) cancelClimb('시간이 너무 오래 걸려 취소됐어요');
      }

      // 가까운 상호작용 지점 → 안내 표시
      if (frame % 4 === 0) {
        let best = null;
        let bd = Infinity;
        if (!ui.panel.isOpen() && climb.state !== 'count') {
          for (const it of interactables) {
            if (it.zone !== player.zone) continue;
            const d = Math.hypot(it.x - px, it.z - pz);
            if (d < it.r && d < bd) {
              bd = d;
              best = it;
            }
          }
        }
        if (best !== curPrompt) {
          curPrompt = best;
          ui.setPrompt(best ? best.label : null, best ? best.use : null);
        }
      }
      if (frame % 20 === 0) ui.setPlace(placeName());
      minimap.draw(player, world.active, campus ? mapOthers() : [], mapMarkers());
    },
  };
  return game;
}
