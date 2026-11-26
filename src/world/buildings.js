// 캠퍼스 건물과 주변 건물. 평면은 OSM, 외벽 색·창 모양은 공식 안내 사진을 보고 정한 스타일 표를 쓴다.
import * as THREE from 'three';
import data from '../../data/campus-data.js';
import { Geo, insetPoly, inPoly, centroid, signedArea } from './geom.js';
import { facadeTexture, windowLightTexture, textPlane } from './textures.js';
import { makeRng } from '../core/rng.js';

// 외벽 재질 정의: [창 스타일, 옵션]
const FACADES = {
  brickBand: { style: 'punch2', wall: '#8f4535', brick: true, band: '#f2efe8', glass: '#34495c', frame: '#f2efe8', seed: 3 },
  whitePunch: { style: 'punch2', wall: '#e9e6de', glass: '#5d8496', frame: '#fbfaf6', seed: 4 },
  ivyArch: { style: 'arch', wall: '#9b4c39', brick: true, glass: '#4c86b0', frame: '#e9e2d2', ivy: 0.7, seed: 5 },
  fins: { style: 'fins', wall: '#8d8378', glass: '#2e4254', seed: 6 },
  finsBase: { style: 'ribbon', wall: '#857b70', glass: '#3a566b', frame: '#6f665d', seed: 7 },
  stone: { style: 'punch', wall: '#8b8176', glass: '#35526a', frame: '#756c62', seed: 8 },
  curtainBlue: { style: 'curtain', glass: '#3d82ad', seed: 9 },
  curtainTeal: { style: 'curtain', glass: '#3a92a6', seed: 10 },
  whiteRibbon: { style: 'ribbon', wall: '#efede6', glass: '#4f81ab', frame: '#fbfaf7', seed: 11 },
  whiteRibbon2: { style: 'punch2', wall: '#f0efe9', glass: '#56808f', frame: '#ffffff', seed: 12 },
  creamRibbon: { style: 'ribbon', wall: '#e7dcc5', glass: '#476a7d', frame: '#f6efe0', seed: 13 },
  creamPunch: { style: 'punch2', wall: '#dbd0b9', glass: '#4a6b7c', frame: '#efe8d8', seed: 14 },
  gym: { style: 'ribbon', wall: '#b9bdc2', glass: '#4e6f8b', frame: '#d7dadd', seed: 15 },
  gymBase: { style: 'curtain', glass: '#2f4a60', mullion: 'rgba(200,205,210,0.9)', seed: 16 },
  panel: { style: 'punch2', wall: '#d4d8db', glass: '#3f6f93', frame: '#eef1f3', seed: 17 },
  storefront: { style: 'curtain', glass: '#355f7c', mullion: 'rgba(245,245,245,0.95)', seed: 18 },
  grayRibbon: { style: 'ribbon', wall: '#d7d4cd', glass: '#3f7896', frame: '#efeeea', seed: 19 },
  gatehouse: { style: 'curtain', glass: '#26394a', mullion: 'rgba(240,240,240,0.95)', seed: 20 },
  golf: { style: 'ribbon', wall: '#6b7a70', glass: '#2c4a44', frame: '#55635a', seed: 21 },
  apt: { style: 'apt', wall: '#dcd7cb', glass: '#5b7386', frame: '#efece4', seed: 22 },
  aptB: { style: 'apt', wall: '#cfd6da', glass: '#51697c', frame: '#eef1f2', seed: 23 },
  shop: { style: 'ribbon', wall: '#c9c2b4', glass: '#44606f', frame: '#e6e0d3', seed: 24 },
};

// 건물별 구성: bay(창 한 칸 너비), bands [[재질, 시작층, 끝층]], roof [종류, 색, 줄임, 높이]
const STYLE = {
  hq: { bay: 3.6, bands: [['whitePunch', 0, 4]], roof: ['hip', 0x4f8f78, 3.2, 3.0], sign: '#1f3a5f' },
  hallim: { bay: 5, bands: [['gymBase', 0, 1], ['gym', 1, 4]], roof: ['hip', 0x9a5b45, 7, 4.2], sign: '#ffffff', signStroke: '#39424a' },
  golf: { bay: 4, bands: [['golf', 0, 3]], roof: ['flat', 0x56615a], sign: '#ffffff' },
  ict: { bay: 3.6, bands: [['ivyArch', 0, 4]], roof: ['hip', 0x4a8a70, 3, 2.6], sign: '#ffffff', signStroke: '#3a2a22' },
  toegye: { bay: 4.2, bands: [['finsBase', 0, 1], ['fins', 1, 5], ['curtainBlue', 5, 7]], roof: ['flat', 0x9a9c9e], sign: '#ffffff', signStroke: '#3b352f', equip: 6 },
  yulgok: { bay: 4.2, bands: [['stone', 0, 2], ['curtainTeal', 2, 7]], roof: ['flat', 0x9a9c9e], sign: '#ffffff', signStroke: '#2d3e48', equip: 6 },
  union: { bay: 4, bands: [['whiteRibbon', 0, 5]], roof: ['flat', 0xa5a7a8], sign: '#1f3a5f', equip: 2 },
  imgok: { bay: 4, bands: [['creamRibbon', 0, 2]], roof: ['hip', 0x3f9a78, 3.5, 2.4], sign: '#b5542b' },
  jeonsan: { bay: 4, bands: [['brickBand', 0, 5]], roof: ['hip', 0x5c4337, 4, 3.2], sign: '#ffffff', signStroke: '#4a241b', pilaster: 0xf2efe8 },
  saenghwal: { bay: 4, bands: [['storefront', 0, 1], ['whiteRibbon', 1, 2]], roof: ['flat', 0xdcd9d2], sign: '#1f3a5f' },
  auto: { bay: 4, bands: [['grayRibbon', 0, 7]], roof: ['flat', 0xa5a7a8], sign: '#1f3a5f', equip: 2 },
  dasan: { bay: 3.6, bands: [['creamPunch', 0, 5]], roof: ['hip', 0x4b9175, 3, 2.4], sign: '#1f3a5f' },
  suam: { bay: 3.6, bands: [['whiteRibbon2', 0, 5]], roof: ['hip', 0x4b9175, 3, 2.6], sign: '#1f3a5f' },
  hongji: { bay: 4.2, bands: [['storefront', 0, 1], ['panel', 1, 6]], roof: ['flat', 0xb5b8ba], sign: '#1f3a5f', equip: 3 },
  gate: { bay: 2.5, bands: [['gatehouse', 0, 1]], roof: ['slab', 0xf4f4f1], sign: null },
};

export function buildBuildings(engine, collider) {
  const group = new THREE.Group();
  group.name = 'buildings';
  const mats = {};
  const facadeMats = [];
  const mat = (name) => {
    if (mats[name]) return mats[name];
    const f = FACADES[name];
    const m = new THREE.MeshLambertMaterial({
      map: facadeTexture(f),
      emissiveMap: windowLightTexture(f.style, f.seed + 100, f.style === 'curtain' ? 0.7 : 0.5),
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });
    facadeMats.push(m);
    return (mats[name] = m);
  };
  const flat = (color) => {
    const k = 'c' + color;
    if (!mats[k]) mats[k] = new THREE.MeshLambertMaterial({ color });
    return mats[k];
  };
  // parent를 주지 않으면 group에 바로 넣는다(연결 통로·주변 건물·골프 그물)
  const add = (geo, material, shadow = true, parent = group) => {
    const m = new THREE.Mesh(geo.build(), material);
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  // 건물 대표색 2~3개(숫자 hex, 잔해 색 등에 쓴다): 층을 많이 차지하는 외벽 띠부터, 그리고 지붕색.
  // 유리 외벽(curtain)은 벽 색이 없어서 유리색을 쓴다.
  const bandColor = (name) => new THREE.Color(FACADES[name].wall || FACADES[name].glass).getHex();
  const mainColors = (st) => {
    const out = [];
    const bands = st.bands.slice().sort((p, q) => q[2] - q[1] - (p[2] - p[1]));
    for (const [name] of bands) {
      const c = bandColor(name);
      if (out.length < 2 && !out.includes(c)) out.push(c);
    }
    if (!out.includes(st.roof[1])) out.push(st.roof[1]);
    if (st.pilaster && out.length < 3 && !out.includes(st.pilaster)) out.push(st.pilaster);
    return out;
  };

  const doors = [];
  const byKey = {};
  const rnd = makeRng(2024);

  for (const b of data.buildings) {
    if (!b.campus) continue;
    const st = STYLE[b.key];
    if (!st) continue;
    // 건물 한 동의 메시는 모두 shell에 넣고, pivot(평면 중심·바닥 높이)이 shell(−중심)을 품는다.
    // 두 이동이 상쇄되어 메시는 지금까지와 같은 자리에 있고(shell 안의 좌표 = 월드 좌표),
    // pivot.scale.y만 줄이면 건물이 제자리에서 바닥 쪽으로 주저앉는다(무너짐·재건 연출).
    const pivot = new THREE.Group();
    pivot.name = 'bld:' + b.key;
    pivot.position.set(b.c[0], b.low, b.c[1]);
    const shell = new THREE.Group();
    shell.position.set(-b.c[0], -b.low, -b.c[1]);
    pivot.add(shell);
    group.add(pivot);
    const fh = b.floorH;
    // 땅에 묻히는 밑동
    add(new Geo().walls(b.poly, b.low - 4, b.base + 0.02, st.bay), flat(0xa7a399), true, shell);
    st.bands.forEach(([name, f0, f1], bi) => {
      // 마지막 띠는 지붕까지 올린다(층수가 표보다 많은 건물 대비)
      const last = bi === st.bands.length - 1;
      const top = last ? Math.max(f1, b.floors || f1) : f1;
      const y0 = b.base + f0 * fh;
      const y1 = last ? b.top : Math.min(b.top, b.base + f1 * fh);
      add(new Geo().walls(b.poly, y0, y1, st.bay, f0, top), mat(name), true, shell);
    });
    // 지붕
    const [rt, rc, inset, rise] = st.roof;
    const roof = new Geo();
    if (rt === 'hip') {
      const eave = insetPoly(b.poly, -0.9);
      roof.walls(eave, b.top - 0.1, b.top + 0.35, 4);
      roof.hipRoof(eave, b.top + 0.35, inset + 0.9, rise);
      add(roof, flat(rc), true, shell);
    } else if (rt === 'slab') {
      const eave = insetPoly(b.poly, -1.1);
      roof.walls(eave, b.top, b.top + 0.35, 4).cap(eave, b.top + 0.35);
      add(roof, flat(rc), true, shell);
    } else {
      roof.walls(b.poly, b.top, b.top + 0.9, 4);
      add(roof, flat(0xe4e2dc), true, shell);
      add(new Geo().cap(insetPoly(b.poly, 0.35), b.top + 0.55), flat(rc), false, shell);
      // 옥상 설비
      if (st.equip) {
        const eq = new Geo();
        let placed = 0;
        const inner = insetPoly(b.poly, 4);
        for (let t = 0; t < 60 && placed < st.equip; t++) {
          const x = b.c[0] + rnd.range(-30, 30);
          const z = b.c[1] + rnd.range(-30, 30);
          if (!inPoly(x, z, inner) || !inPoly(x, z, b.poly)) continue;
          eq.box(x, b.top + 0.55 + 1.1, z, rnd.range(3, 6), 2.2, rnd.range(2.5, 4), rnd() * 3);
          placed++;
        }
        if (placed) add(eq, flat(0xc9ccce), true, shell);
      }
    }
    // 전산관: 모서리마다 흰 기둥(벽돌 + 흰 콘크리트 틀)
    if (st.pilaster) {
      const pg = new Geo();
      const n = b.poly.length;
      for (let i = 0; i < n; i++) {
        const p = b.poly[i];
        const a = b.poly[(i + n - 1) % n];
        const c = b.poly[(i + 1) % n];
        const cross = (p[0] - a[0]) * (c[1] - p[1]) - (p[1] - a[1]) * (c[0] - p[0]);
        if (cross <= 0) continue; // 볼록한 모서리만
        pg.box(p[0], (b.low - 2 + b.top) / 2, p[1], 0.9, b.top - b.low + 2, 0.9, Math.atan2(c[0] - p[0], c[1] - p[1]));
      }
      add(pg, flat(st.pilaster), true, shell);
    }
    // 충돌체의 top/base는 카메라가 벽을 뚫지 않게 여유를 둔 값이다. 실제 지붕 높이는 아래 기록의 top.
    const solid = collider.addPoly(b.poly, b.top + 4, b.low - 4, b.key);
    // 파괴·탄 판정이 쓰는 건물 기록. 가져온 데이터(b)는 고치지 않고 새 객체로 만든다.
    let radius = 0;
    for (const p of b.poly) radius = Math.max(radius, Math.hypot(p[0] - b.c[0], p[1] - b.c[1]));
    byKey[b.key] = {
      key: b.key,
      name: b.name,
      letter: b.letter,
      poly: b.poly,
      c: b.c,
      base: b.base,
      top: b.top,
      low: b.low,
      floors: b.floors,
      pivot,
      colors: mainColors(st),
      radius,
      area: Math.abs(signedArea(b.poly)),
      solid,
    };

    // 출입구: 유리문 + 캐노피 + 건물 이름
    if (b.door) {
      const d = b.door;
      const rot = Math.atan2(d.nx, d.nz);
      const dy = d.y;
      const dg = new THREE.Group();
      dg.position.set(d.x + d.nx * 0.06, dy, d.z + d.nz * 0.06);
      dg.rotation.y = rot;
      if (b.key !== 'gate') {
        const frame = new THREE.Mesh(new Geo().box(0, 1.5, 0.1, 4.4, 3.0, 0.3).build(), flat(0xf3f1eb));
        const glassDoor = new THREE.Mesh(new Geo().box(0, 1.35, 0.2, 3.6, 2.7, 0.2).build(), new THREE.MeshLambertMaterial({ color: 0x24394b, emissive: 0xffd9a0, emissiveIntensity: 0 }));
        facadeMats.push(glassDoor.material);
        const canopy = new THREE.Mesh(new Geo().box(0, 3.25, 1.5, 6.4, 0.35, 3.4).build(), flat(b.key === 'imgok' ? 0xd9703f : 0xf6f4ef));
        canopy.castShadow = true;
        const posts = new THREE.Mesh(new Geo().box(-2.8, 1.6, 2.9, 0.3, 3.2, 0.3).box(2.8, 1.6, 2.9, 0.3, 3.2, 0.3).build(), flat(0xdedbd3));
        dg.add(frame, glassDoor, canopy, posts);
        if (st.sign) {
          const w = Math.min(9, 1.5 + b.name.length * 1.5);
          const sign = textPlane(b.name, w, { color: st.sign, stroke: st.signStroke || null, strokeWidth: 10, font: 'bold 96px "Jua", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif', oneSided: true });
          sign.position.set(0, 3.6 + sign.userData.h / 2 + 0.5, 0.12);
          dg.add(sign);
        }
      }
      shell.add(dg); // dg의 위치는 월드 좌표 그대로다(shell 안의 좌표 = 월드 좌표)
      doors.push({ key: b.key, name: b.name, letter: b.letter, x: d.x + d.nx * 1.6, z: d.z + d.nz * 1.6, y: dy, nx: d.nx, nz: d.nz });
    }
  }

  // 퇴계관–율곡관 연결 통로(OSM의 bridge=yes 보행로)
  for (const r of data.roads) {
    if (!r.bridge) continue;
    const a = r.pts[0];
    const c = r.pts[r.pts.length - 1];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]) + 4;
    const rot = Math.atan2(c[0] - a[0], c[1] - a[1]);
    const mx = (a[0] + c[0]) / 2;
    const mz = (a[1] + c[1]) / 2;
    const yb = (byKey.yulgok ? byKey.yulgok.base : 29) + 8.6;
    for (const dy of [0, 8]) {
      const m = new THREE.Mesh(new Geo().box(mx, yb + dy, mz, 3.4, 3.2, len, rot).build(), mat('curtainTeal'));
      m.castShadow = true;
      group.add(m);
    }
  }

  // 주변 건물(아파트 등): 재질별로 한 덩어리
  const aptA = new Geo();
  const aptB = new Geo();
  const shop = new Geo();
  const roofs = new Geo();
  let n = 0;
  for (const b of data.buildings) {
    if (b.campus) continue;
    const isApt = b.kind === 'apt';
    const fh = isApt ? 2.9 : 3.3;
    const levels = Math.max(1, Math.round((b.top - b.base) / fh));
    const g = isApt ? (n++ % 2 ? aptA : aptB) : shop;
    g.walls(b.poly, b.base - 6, b.base + levels * fh, isApt ? 3.4 : 4, -Math.ceil(6 / fh), levels);
    roofs.walls(b.poly, b.base + levels * fh, b.base + levels * fh + 0.8, 4).cap(b.poly, b.base + levels * fh + 0.8);
    collider.addPoly(b.poly, b.top + 3, b.base - 6);
  }
  add(aptA, mat('apt'));
  add(aptB, mat('aptB'));
  add(shop, mat('shop'));
  add(roofs, flat(0xb9bbb8));

  // 골프연습장 그물망
  for (const a of data.areas) {
    if (a.kind !== 'golf') continue;
    const net = new THREE.MeshLambertMaterial({ color: 0x2e9c63, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
    const y0 = a.pad != null ? a.pad : 22;
    const cage = new THREE.Mesh(new Geo().walls(a.poly, y0, y0 + 15, 4).cap(a.poly, y0 + 15).build(), net);
    group.add(cage);
    const frame = new Geo();
    for (const p of a.poly) frame.box(p[0], y0 + 7.5, p[1], 0.35, 15, 0.35);
    add(frame, flat(0x3f5a4a));
    collider.addPoly(a.poly, y0 + 15, y0);
    void centroid;
  }

  engine.onNight((night) => {
    for (const m of facadeMats) m.emissiveIntensity = night * 0.95;
  });

  return { group, doors, byKey };
}
