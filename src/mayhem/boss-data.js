// 가상 보스 정의(설계서 5.4). boss.js는 이 표를 읽어 움직이는 엔진이고, 다른 장소 버전에서는 이 파일만 바꿔 쓴다.
//
// 지킬 것: 보스는 사람이 아닌 가상 캐릭터다. 실존 인물·특정 교수·학과·동아리를 떠올리게 하는 이름·대사·외모를 넣지 않는다.
// 외모를 놀리는 대사·기술 이름도 넣지 않는다. 만화·장난감 풍으로.
//
// 보스 하나의 형식:
//   key     짧은 영문 키(영문·숫자·_·- 16자 이내, 보스끼리 겹치지 않게). 통신(fx 묶음의 b, boss 이벤트)에 실리고,
//           'boss:' + key가 과녁 id이자 기절 까닭(by)이 된다.
//   name    이름표·체력 막대·알림에 쓰는 이름
//   look    몸은 아바타를 3.2배로 키워 쓰고, 머리를 무엇으로 할지 고른다:
//             'megaphone'  머리 대신 큰 확성기
//             'monitor'    머리 대신 브라운관 모니터(화면에 빨간 물결선과 에러 글자가 흐른다)
//             'human'      아바타 그대로(자켓 색만 color) — 대림 데이터에서는 쓰지 않는다(다른 장소 버전용).
//                          체형·머리 모양·안경·직함 같은 사람 꾸미기는 일부러 없다(특정인을 흉내 내지 못하게)
//           이 셋이 아니면(오타·빠짐) 경고를 찍고 'monitor'로 그린다
//   color   자켓·장식·지도 표시 색('#rrggbb')
//   hp      최대 체력
//   lair    둥지(잠들어 있는 곳). 둘 중 하나:
//             { zone, door, out }       그 건물 문(world.doors의 key)에서 문 바깥 방향으로 out m (캠퍼스에서만)
//             { zone, anchor, offset }  world.props.anchors[anchor]에서 [dx, dz]만큼 옮긴 곳 (캠퍼스에서만)
//           zone은 내부 구역 id(world.zones의 키). 자리는 실행할 때 확인한다: 갈 수 있는 땅이고 건물 밖이며,
//           도착점·스탬프 원·깃발·처음 들어오는 곳·깨어나는 곳(그리고 기준으로 삼은 anchor)에서 15m 이상.
//           안 되면 바깥쪽으로 더 옮기고, 그래도 안 되면 주변을 찾는다.
//   arena   둥지에서 이 반경(m) 밖으로는 나가지 않는다
//   wake    무장한 내가 이 거리(m) 안에 오면 깨어난다. 내 피해는 wake와 그 보스 기술 중 가장 긴 사거리(boss.js의 REACH) 중
//           짧은 쪽 안에서만 들어간다(보스가 반격할 수 없는 곳에서 안전하게 잡는 것 막기).
//           연습 과녁(GAME.dummies)은 되도록 둥지에서 wake + 12m 밖에 선다 — 둥지와 과녁 앵커가 너무 가까우면 과녁이 보스 곁에 선다
//   lines   대사. 깨어날 때·기술을 쓸 때 말풍선으로 말하고, 글자 탄(bubbles·rain)에도 쓴다(40자 이내)
//   skills  기술 목록. 깨어 있는 동안 차례대로 돌려 쓰고, 체력이 50% 이하가 되면 cd가 0.7배가 된다:
//             { kind: 'bubbles',   name, cd, count, dmg, slow: [초, 배율] }  lines 글자 말풍선 탄이 느리게 쫓아온다. 맞으면 감속
//             { kind: 'shockwave', name, cd, dmg }                       보스가 뛰었다 내려앉으며 바닥 고리가 퍼진다. 땅에 서 있으면 맞고, 점프하면 피한다
//             { kind: 'bombs',     name, cd, count, dmg, radius }        예고 원 count개, 1.4초 뒤 폭발(반경 radius m)
//             { kind: 'rain',      name, cd, count, dmg }                 예고 원 안으로 lines 글자가 하늘에서 떨어진다
//             { kind: 'orbs',      name, cd, count, dmg, dur }            보스 주위를 도는 구슬 count개(dur초 동안)
//             { kind: 'burst',     name, cd, windup, count, dmg, jam }    windup초 동안 기술 이름을 외치며 준비한 뒤 사방으로 탄 count개, 맞으면 무기 고장 jam초
//           cd 다시 쓰기까지(초) · count 개수 · dmg 한 번 맞을 때 피해. 탄 개수는 기기와 상관없이 이 값 그대로다(게임 규칙).

export const BOSSES = [
  {
    key: 'nag',
    name: '잔소리 대마왕',
    look: 'megaphone',
    color: '#8e44ad',
    hp: 700,
    lair: { zone: 'campus', door: 'suam', out: 24 },
    arena: 28,
    wake: 45,
    lines: ['일찍 일찍 다녀라!', '밥은 먹고 다니니?', '방 좀 치워라!', '휴대폰 그만 봐라!', '자세 똑바로!', '불 끄고 다녀라!'],
    skills: [
      { kind: 'bubbles', name: '잔소리 탄막', cd: 4.5, count: 5, dmg: 9, slow: [2.5, 0.6] },
      { kind: 'shockwave', name: '일장연설', cd: 9, dmg: 16 },
      { kind: 'bombs', name: '잔소리 폭탄', cd: 7, count: 4, dmg: 22, radius: 4 },
    ],
  },
  {
    key: 'bug',
    name: '버그 마왕',
    look: 'monitor',
    color: '#d63031',
    hp: 700,
    lair: { zone: 'campus', anchor: 'field', offset: [16, 12] },
    arena: 28,
    wake: 45,
    lines: ['NullPointerException', 'undefined', 'NaN', '404', 'Segfault', '; 누락'],
    skills: [
      { kind: 'rain', name: '에러 메시지 비', cd: 5, count: 8, dmg: 12 },
      { kind: 'orbs', name: '무한 루프', cd: 11, count: 3, dmg: 10, dur: 6 },
      { kind: 'burst', name: '신택스 에러!', cd: 13, windup: 2, count: 16, dmg: 26, jam: 2.5 },
      { kind: 'bombs', name: '스택 오버플로', cd: 8, count: 3, dmg: 20, radius: 4 },
    ],
  },
];
