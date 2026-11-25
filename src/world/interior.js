// 전산관 내부(4층 로비, 5층 학과·동아리 층). 글자 지도 한 칸 = 1m.
// 4·5층의 방 구성은 공식 층별 안내(실습실, Smart Station, 교직원 식당, 교수연구실, 휴게홀, 옥외휴게소)를 따랐고,
// 방의 정확한 위치와 동아리방 배치는 상상으로 그린 것이다. 고치려면 아래 지도만 바꾸면 된다.
import * as THREE from 'three';
import { Geo } from './geom.js';
import { Collider } from './collision.js';
import { textSprite, textPlane } from './textures.js';
import { makeRng } from '../core/rng.js';

const WALL_H = 2.5;

// 바닥: . 복도  r Smart Station  f 식당  l 실습실  j 지공모  c COMMON  m 모비딕  p 교수연구실  o 옥외휴게소
// 구조: # 벽  = 난간(낮은 벽)  D 문  X 출입문(밖으로)  E 엘리베이터
// 가구: T PC책상  R 책장  O 원탁  F 배식대  S 소파  P 화분  V 자판기
// 상호작용: K 층별 안내  H 학과 연혁  B 동아리 게시판  Q 퀴즈 단말  I 아이디어 보드  G 게임기  N 알림판
const FLOORS = {
  js4: {
    name: '4층',
    code: 'j4',
    origin: [3000, 0],
    spawn: 'X',
    map: [
      '##################X################',
      '#rrrrrrrrrr#.............#ffffffff#',
      '#rRRrRRrRRr#.............#fFFFFFFf#',
      '#rrrrrrrrrr#......H......#ffffffff#',
      '#rRRrRRrRRrD.............DfOffOfff#',
      '#rrrrrrrrrr#.............#ffffffff#',
      '#rOrrrOrrrr#..S.......S..#fOffOfff#',
      '#rrrrrrrrrr#.............#ffffffff#',
      '############......K......##########',
      '#llllllllll#.............#llllllll#',
      '#lTTTlTTTll#.............#lTTTlTTl#',
      '#llllllllllD.............Dllllllll#',
      '#lTTTlTTTll#.P.........P.#lTTTlTTl#',
      '#llllllllll#......E......#llllllll#',
      '###################################',
    ],
    rooms: [
      ['Smart Station', 5.5, 3.5, '#7fd0ff'],
      ['교직원 식당', 30, 3.5, '#ffd08a'],
      ['실습실 401', 5.5, 11.5, '#cfe3ff'],
      ['실습실 402', 30, 11.5, '#cfe3ff'],
      ['전산관 로비', 18.5, 6.2, '#ffffff'],
    ],
  },
  js5: {
    name: '5층',
    code: 'j5',
    origin: [3000, 300],
    spawn: 'E',
    map: [
      '###################################',
      '#jjjjjjjj#cccccccc#mmmmmmmm#pppppp#',
      '#jQjjjBjj#cIcccBcc#mGmmmBmm#pTpTpp#',
      '#jjjjjjjj#cccccccc#mmmmmmmm#pppppp#',
      '#jjSjjjjj#ccSccccc#mmSmmmmm#pTpTpp#',
      '####D########D########D#######D####',
      '#.................................#',
      '#..S....P........N.......P..S.....#',
      '#.................................#',
      '####D###########D######...####D####',
      '#llllllllll#llllllllll#...#ooooooo=',
      '#lTTTlTTTll#lTTTlTTTll#...#oPoooPo=',
      '#llllllllll#llllllllll#...#ooooooo=',
      '#lTTTlTTTll#lTTTlTTTll#.E.#oSoooSo=',
      '#llllllllll#llllllllll#####ooooooo=',
      '###########################=======#',
    ],
    rooms: [
      ['지공모', 5, 2.8, '#2fbf71'],
      ['COMMON', 14, 2.8, '#ff8a3d'],
      ['모비딕', 23, 2.8, '#3d8bff'],
      ['교수연구실', 31, 2.8, '#d7dde6'],
      ['모바일실습실', 6, 12, '#cfe3ff'],
      ['프로젝트실습실', 17, 12, '#cfe3ff'],
      ['휴게홀', 12.5, 7.2, '#ffffff'],
      ['옥외휴게소', 30.5, 12.5, '#bff0c8'],
    ],
  },
};

const FLOOR_COL = {
  '.': 0xd9d2c3,
  r: 0xb9c7d6,
  f: 0xe2cfae,
  l: 0xaeb9c6,
  j: 0xb7dcc3,
  c: 0xf0cfae,
  m: 0xb4cdee,
  p: 0xcabfae,
  o: 0xa98a63,
};
const isFloorChar = (ch) => ch in FLOOR_COL;

function buildFloor(id, def) {
  const group = new THREE.Group();
  group.name = id;
  const collider = new Collider(4);
  const rows = def.map;
  const Hn = rows.length;
  const Wn = Math.max(...rows.map((r) => r.length));
  const [ox, oz] = def.origin;
  const at = (c, r) => (r < 0 || r >= Hn || c < 0 || c >= rows[r].length ? ' ' : rows[r][c]);
  const solidTile = (c, r) => {
    const ch = at(c, r);
    return ch === '#' || ch === ' ' || ch === '=';
  };
  // 가구 밑 바닥 종류: 가장 가까운 왼쪽(없으면 오른쪽) 바닥 글자를 따른다
  const floorOf = (c, r) => {
    const ch = at(c, r);
    if (isFloorChar(ch)) return ch;
    if (ch === '#' || ch === ' ' || ch === '=') return null;
    for (let d = 1; d < Wn; d++) {
      if (isFloorChar(at(c - d, r))) return at(c - d, r);
      if (isFloorChar(at(c + d, r))) return at(c + d, r);
    }
    return '.';
  };

  const floor = new Geo();
  const walls = new Geo();
  const caps = new Geo();
  const furn = new Geo();
  const glow = new Geo();
  const rail = new Geo();
  const spots = [];
  const rnd = makeRng(id === 'js4' ? 41 : 51);
  const X = (c) => ox + c + 0.5;
  const Z = (r) => oz + r + 0.5;

  // 들어오는 곳(스폰 글자)의 칸 위치
  let spawnR = Hn / 2;
  for (let r = 0; r < Hn; r++) if (rows[r].includes(def.spawn)) spawnR = r;
  // 벽 뒤에 붙는 물건이 바라볼 방향(열린 쪽). 벽에 안 붙었으면 들어오는 쪽을 본다.
  const facing = (c, r) => {
    const dirs = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];
    for (const [dx, dz] of dirs) if (solidTile(c - dx, r - dz) && !solidTile(c + dx, r + dz)) return [dx, dz];
    return [0, spawnR < r ? -1 : 1];
  };

  for (let r = 0; r < Hn; r++) {
    // 벽: 가로로 이어진 칸을 한 덩어리로
    let run = -1;
    for (let c = 0; c <= Wn; c++) {
      const ch = at(c, r);
      if (ch === '#') {
        if (run < 0) run = c;
      } else if (run >= 0) {
        const x0 = ox + run;
        const x1 = ox + c;
        walls.color(0xf1ede4).box((x0 + x1) / 2, WALL_H / 2, Z(r), x1 - x0, WALL_H, 1);
        caps.color(0x3a4658).box((x0 + x1) / 2, WALL_H + 0.03, Z(r), x1 - x0, 0.06, 1);
        collider.addBox(x0, oz + r, x1, oz + r + 1, WALL_H);
        run = -1;
      }
    }
    for (let c = 0; c < Wn; c++) {
      const ch = at(c, r);
      const x = X(c);
      const z = Z(r);
      const ft = floorOf(c, r);
      if (ft) {
        const base = new THREE.Color(FLOOR_COL[ft]);
        const k = 0.96 + (((c + r) % 2) * 0.05);
        floor.cr = base.r * k;
        floor.cg = base.g * k;
        floor.cb = base.b * k;
        floor.useColor = true;
        floor.quad([x - 0.5, 0, z + 0.5], [x + 0.5, 0, z + 0.5], [x + 0.5, 0, z - 0.5], [x - 0.5, 0, z - 0.5]);
      }
      if (ch === '=') {
        rail.box(x, 0.55, z, 1, 1.1, 0.14, at(c, r - 1) === '=' || at(c, r + 1) === '=' ? Math.PI / 2 : 0);
        caps.color(0x59626b).box(x, 1.12, z, 1, 0.06, 0.2, at(c, r - 1) === '=' || at(c, r + 1) === '=' ? Math.PI / 2 : 0);
        collider.addBox(x - 0.5, z - 0.5, x + 0.5, z + 0.5, 1.1);
        // 난간 밑 바닥
        floor.color(FLOOR_COL.o).quad([x - 0.5, 0, z + 0.5], [x + 0.5, 0, z + 0.5], [x + 0.5, 0, z - 0.5], [x - 0.5, 0, z - 0.5]);
        continue;
      }
      if (ch === 'D') {
        // 문틀
        const horiz = solidTile(c - 1, r) && solidTile(c + 1, r);
        const rot = horiz ? 0 : Math.PI / 2;
        furn.color(0x8a6a4a).box(x, WALL_H - 0.12, z, 1, 0.24, 1.02, rot + Math.PI / 2);
        continue;
      }
      if (isFloorChar(ch) || ch === '#' || ch === ' ') continue;
      const [fx, fz] = facing(c, r);
      const rot = Math.atan2(fx, fz);
      const solid = (rad = 0.42) => collider.addCircle(x, z, rad);
      switch (ch) {
        case 'T': {
          furn.color(0xd9c7a3).box(x, 0.72, z, 1, 0.06, 0.7);
          furn.color(0x7b8794).box(x, 0.36, z - 0.3, 0.9, 0.7, 0.05);
          furn.color(0x20262e).box(x, 1.05, z - 0.18, 0.55, 0.36, 0.05);
          glow.color(rnd() > 0.35 ? 0x5fb8ff : 0x8be39b).box(x, 1.05, z - 0.15, 0.49, 0.3, 0.02);
          furn.color(0x39424d).box(x, 0.45, z + 0.55, 0.42, 0.08, 0.42).box(x, 0.75, z + 0.74, 0.42, 0.55, 0.06);
          collider.addBox(x - 0.5, z - 0.38, x + 0.5, z + 0.36, 1);
          break;
        }
        case 'R': {
          furn.color(0x7a5a3c).box(x, 1.0, z, 1, 2.0, 0.42);
          for (let s = 0; s < 4; s++) {
            const cols = [0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0xecf0f1];
            for (let b = 0; b < 5; b++) glow.color(cols[rnd.int(cols.length)]).box(x - 0.4 + b * 0.2, 0.32 + s * 0.48, z + 0.2, 0.16, 0.32, 0.04);
          }
          collider.addBox(x - 0.5, z - 0.25, x + 0.5, z + 0.25, 2);
          break;
        }
        case 'O': {
          furn.color(0xf2efe8).box(x, 0.74, z, 0.95, 0.06, 0.95, 0.78);
          furn.color(0x7b8794).box(x, 0.37, z, 0.12, 0.74, 0.12);
          furn.color(0xe67e22).box(x - 0.72, 0.42, z, 0.36, 0.08, 0.36).box(x + 0.72, 0.42, z, 0.36, 0.08, 0.36);
          solid(0.55);
          break;
        }
        case 'F': {
          furn.color(0xc7ccd1).box(x, 0.5, z, 1, 1.0, 0.7);
          glow.color(0xfff1c9).box(x, 1.02, z, 0.9, 0.04, 0.6);
          collider.addBox(x - 0.5, z - 0.35, x + 0.5, z + 0.35, 1);
          break;
        }
        case 'S': {
          const cc = [0x3d8bff, 0xff8a3d, 0x2fbf71, 0xb86bd6][rnd.int(4)];
          furn.color(cc).box(x, 0.3, z, 1.5, 0.36, 0.7, rot).box(x - fx * 0.3, 0.62, z - fz * 0.3, 1.5, 0.5, 0.16, rot);
          solid(0.6);
          break;
        }
        case 'P': {
          furn.color(0xb5651d).box(x, 0.25, z, 0.42, 0.5, 0.42);
          furn.color(0x2e8b57).box(x, 0.95, z, 0.7, 0.9, 0.7, 0.6).box(x, 1.35, z, 0.45, 0.5, 0.45, 0.2);
          solid(0.36);
          break;
        }
        case 'V': {
          furn.color(0xc0392b).box(x, 1.0, z, 0.9, 2.0, 0.7, rot);
          solid(0.55);
          break;
        }
        case 'E': {
          furn.color(0x8d99a6).box(x - fx * 0.42, 1.15, z - fz * 0.42, 1.7, 2.3, 0.12, rot);
          furn.color(0x5d6875).box(x - fx * 0.36, 1.1, z - fz * 0.36, 0.04, 2.1, 0.02, rot);
          glow.color(0xffd23f).box(x - fx * 0.36, 2.42, z - fz * 0.36, 0.6, 0.16, 0.03, rot);
          spots.push({ kind: 'elevator', x: x + fx * 0.3, z: z + fz * 0.3, r: 1.7, ch });
          break;
        }
        case 'X': {
          glow.color(0x9fd8ff).box(x, 1.2, z, 0.95, 2.4, 0.1, rot);
          glow.color(0x2fbf71).box(x + fx * 0.08, 2.62, z + fz * 0.08, 0.9, 0.22, 0.05, rot);
          spots.push({ kind: 'exit', x: x + fx * 1.0, z: z + fz * 1.0, r: 1.8, ch, fx, fz });
          break;
        }
        default: {
          // 게시판·단말 등 상호작용 물건
          const COL = { K: 0x009fe3, H: 0x8e6b3d, B: 0x7a5a3c, Q: 0x2fbf71, I: 0xff8a3d, G: 0x3d8bff, N: 0x566273 };
          const KIND = { K: 'guide', H: 'history', B: 'club', Q: 'quiz', I: 'idea', G: 'snake', N: 'notice' };
          if (!KIND[ch]) break;
          if (ch === 'G') {
            furn.color(0x1f3f8a).box(x, 0.95, z, 0.8, 1.9, 0.75, rot);
            glow.color(0x9bff8a).box(x + fx * 0.39, 1.25, z + fz * 0.39, 0.6, 0.5, 0.03, rot);
            furn.color(0xffd23f).box(x + fx * 0.42, 0.85, z + fz * 0.42, 0.5, 0.08, 0.2, rot);
          } else if (ch === 'Q') {
            furn.color(0xd9c7a3).box(x, 0.72, z, 1, 0.06, 0.7, rot);
            furn.color(0x20262e).box(x - fx * 0.15, 1.2, z - fz * 0.15, 0.9, 0.6, 0.06, rot);
            glow.color(0x6dffa0).box(x - fx * 0.1, 1.2, z - fz * 0.1, 0.82, 0.52, 0.02, rot);
          } else {
            furn.color(0x4a4f57).box(x, 0.55, z, 0.1, 1.1, 0.1);
            furn.color(COL[ch]).box(x, 1.5, z, 1.3, 1.0, 0.08, rot);
            const notes = [0xfff1a8, 0xffffff, 0xffc9de, 0xc9f0ff, 0xd6ffc9];
            for (let k = 0; k < 6; k++) glow.color(notes[rnd.int(notes.length)]).box(x + fx * 0.05 + (fz ? (k % 3) * 0.36 - 0.36 : 0), 1.28 + Math.floor(k / 3) * 0.42, z + fz * 0.05 + (fx ? (k % 3) * 0.36 - 0.36 : 0), fz ? 0.28 : 0.02, 0.32, fx ? 0.28 : 0.02);
          }
          solid(0.45);
          spots.push({ kind: KIND[ch], x: x + fx * 1.1, z: z + fz * 1.1, r: 1.7, ch, room: floorOf(c, r) });
        }
      }
    }
  }

  const mesh = (geo, mat) => {
    const m = new THREE.Mesh(geo.build(), mat);
    group.add(m);
    return m;
  };
  mesh(floor, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh(walls, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh(caps, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh(furn, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh(glow, new THREE.MeshBasicMaterial({ vertexColors: true }));
  if (rail.p.length) {
    const rm = mesh(rail, new THREE.MeshLambertMaterial({ color: 0xaee3f5, transparent: true, opacity: 0.4, depthWrite: false }));
    rm.renderOrder = 2;
  }
  // 바닥 밖은 어두운 판
  const under = new THREE.Mesh(new THREE.PlaneGeometry(Wn + 60, Hn + 60), new THREE.MeshBasicMaterial({ color: 0x1a2130 }));
  under.rotation.x = -Math.PI / 2;
  under.position.set(ox + Wn / 2, -0.05, oz + Hn / 2);
  group.add(under);

  // 방 이름표
  for (const [name, c, r, color] of def.rooms) {
    const s = textSprite(name, 0.62, { color, bg: 'rgba(16,24,38,0.78)', font: 'bold 54px "Jua", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif', pad: 14, depthTest: false });
    s.position.set(ox + c, WALL_H + 0.9, oz + r);
    s.renderOrder = 10;
    group.add(s);
  }
  // 동아리방 벽 현판
  if (id === 'js5') {
    const banners = [
      ['지식을 공유하는 모임', 5, '#2fbf71'],
      ['함께 배우고 함께 창업', 14, '#ff8a3d'],
      ['Mobile & Digital Internet Community', 23, '#3d8bff'],
    ];
    for (const [t, c, color] of banners) {
      const p = textPlane(t, 6.4, { color: '#ffffff', bg: color, font: 'bold 44px "Jua", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif', pad: 12, radius: 10, oneSided: true });
      const k = Math.min(1, 0.7 / p.userData.h);
      p.scale.setScalar(k);
      p.position.set(ox + c, 1.75, oz + 1.02);
      group.add(p);
    }
  }

  const spawnSpot = spots.find((s) => s.ch === def.spawn) || { x: ox + Wn / 2, z: oz + Hn / 2 };
  const zone = {
    id,
    name: def.name,
    code: def.code,
    interior: true,
    group,
    collider,
    spots,
    spawn: { x: spawnSpot.x, z: spawnSpot.z },
    elevator: spots.find((s) => s.kind === 'elevator'),
    heightAt: () => 0,
    slopeAt: () => ({ dx: 0, dz: 0, mag: 0 }),
    playable(x, z) {
      const c = Math.floor(x - ox);
      const r = Math.floor(z - oz);
      const ch = at(c, r);
      return ch !== ' ' && ch !== '#';
    },
    conveyorAt: null,
    cameraBlocked: (x, y) => y < 0.3,
    pitchMin: 0.62,
    pitchMax: 1.45,
    center: { x: ox + Wn / 2, z: oz + Hn / 2 },
  };
  return zone;
}

export function buildInterior(engine, world) {
  const zones = {};
  for (const id in FLOORS) {
    const z = buildFloor(id, FLOORS[id]);
    z.onEnter = () => {
      engine.scene.fog.near = 60;
      engine.scene.fog.far = 220;
    };
    zones[id] = world.addZone(z);
  }
  return zones;
}
