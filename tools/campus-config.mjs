// 캠퍼스 빌드 설정: OSM 건물 이름 → 게임 안의 키, 건물 기준 높이(패드), 출입구 방향.
// 높이는 임곡로(남쪽 도로)를 0m로 잡은 값. DEM(SRTM)은 건물·숲이 섞인 표면 모델이라
// 큰 경사 방향만 참고하고, 단차는 공식 사진·안내도를 보고 손으로 정했다.

export const ORIGIN = { lat: 37.4035241, lon: 126.9304994 };

// 월드 범위 (x=동, z=남). 2m 격자.
export const DOMAIN = { x0: -352, z0: -320, step: 2, nx: 337, nz: 321 };

export const CAMPUS_WAY = 380698408;

// bearing: 출입구가 바라보는 나침반 방위(도, 0=북, 90=동). 건물 중심에서 그 방향으로 쏴서 문 위치를 찾는다.
export const BUILDINGS = {
  대학본부: { key: 'hq', letter: 'A', pad: 35, floorH: 4, bearing: 150 },
  한림관: { key: 'hallim', letter: 'B', pad: 9, floorH: 4.5, bearing: 95 },
  정보통신관: { key: 'ict', letter: 'D', pad: 26, floorH: 4, bearing: 150 },
  퇴계관: { key: 'toegye', letter: 'E', pad: 26, floorH: 4, bearing: 150 },
  율곡관: { key: 'yulgok', letter: 'F', pad: 29, floorH: 4, bearing: 330 },
  학생회관: { key: 'union', letter: 'G', pad: 29, floorH: 4, bearing: 200 },
  임곡관: { key: 'imgok', letter: 'H', pad: 37, floorH: 4, bearing: 60 },
  // 전산관은 비탈에 박힌 건물: 북쪽 광장(46m)에서 4층으로 들어가고 남쪽은 1층(34m)까지 드러난다.
  전산관: { key: 'jeonsan', letter: 'J', pad: null, base: 34, top: 54, floorH: 4, bearing: 335 },
  생활관: { key: 'saenghwal', letter: 'K', pad: 46, floorH: 4, bearing: 240 },
  자동차관: { key: 'auto', letter: 'L', pad: 18, floorH: 4, bearing: 240 },
  다산관: { key: 'dasan', letter: 'M', pad: 50, floorH: 4, bearing: 200 },
  수암관: { key: 'suam', letter: 'N', pad: 56, floorH: 4, bearing: 170 },
  // 홍지관: 길 쪽(동쪽)은 한 층 높다 — 낮은 쪽으로 지하 1층이 드러난다
  홍지관: { key: 'hongji', letter: 'P', pad: 9, base: 4.8, extra: 1, floorH: 4.2, bearing: 80 },
  수위실: { key: 'gate', letter: 'Y', pad: 14, floorH: 3.2, bearing: 100 },
};

// 이름 없는 건물(way id) → 골프연습장 본동
export const UNNAMED_BUILDINGS = {
  878623121: { name: '골프연습장', key: 'golf', letter: 'C', pad: 22, floorH: 4, bearing: 110 },
};

// 건물이 아닌 평지(패드)
export const AREA_PADS = {
  780189826: { kind: 'field', pad: 16 }, // 대운동장
  484348865: { kind: 'court', pad: 16 }, // 농구장
  878652540: { kind: 'square', pad: 46 }, // 전산관·생활관 사이 광장
  780189830: { kind: 'golf', pad: 22 }, // 골프연습장 그물망
};

export const ROAD_WIDTH = {
  primary: 15,
  primary_link: 8,
  tertiary: 10,
  residential: 6.5,
  service: 5.5,
  footway: 2.6,
  path: 1.8,
  steps: 3.2,
  cycleway: 2.6,
};
