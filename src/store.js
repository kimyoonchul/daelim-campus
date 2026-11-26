// 브라우저에만 저장되는 진행 상황(프로필·스탬프·기록). 서버에는 아무것도 남지 않는다.
import { GAME } from './config.js';

const KEY = GAME.storeKey; // 저장 키는 설정에서(다른 장소 버전은 다른 키를 쓴다)

function load() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch (e) {
    return {};
  }
}

const data = Object.assign({ profile: null, stamps: {}, grades: 0, picked: {}, bestClimb: 0, quizBest: 0, snakeBest: 0, time: 'day', muted: [] }, load());

export const store = {
  data,
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      /* 저장소가 막혀 있어도 게임은 계속된다 */
    }
  },
  set(k, v) {
    data[k] = v;
    store.save();
  },
};
