// 발신 빈도 제한: 최근 1초 동안 보낸 시각을 8칸에 적어 두는 슬라이딩 창.
// 순수 모듈이다(three·DOM을 쓰지 않으므로 Node에서 그대로 시험할 수 있다).
// 시각은 부르는 쪽이 ms 단위로 넘긴다(브라우저에서는 performance.now()).
//
//   const lim = createLimiter();
//   lim.take('s', now)  상태: 빈칸이 있으면 한 칸을 쓰고 true
//   lim.take('e', now)  이벤트류('s'가 아닌 모든 종류): 빈칸이 있고, 최근 1초에 보낸 이벤트류가 3건 미만일 때만 true
//   lim.count(now)      최근 1초에 보낸 건수(상태 + 이벤트류)
//
// 공개 브로커는 한 사람이 초당 16건쯤 보내면 메시지를 흘리기 시작하므로 8건으로 묶는다.
// 이벤트류를 3칸으로 묶어 두면 상태(초당 5건)는 이벤트가 아무리 몰려도 밀리지 않는다.

export const LIMIT = { slots: 8, eventSlots: 3, windowMs: 1000 };

export function createLimiter({ slots = LIMIT.slots, eventSlots = LIMIT.eventSlots, windowMs = LIMIT.windowMs } = {}) {
  const at = new Float64Array(slots).fill(-Infinity); // 칸마다 마지막으로 쓴 시각
  const ev = new Uint8Array(slots); // 그 칸을 이벤트류가 썼으면 1

  // 창 안에 있는 칸: now - at < windowMs (딱 1초가 지난 칸은 빈칸이다)
  const live = (i, now) => now - at[i] < windowMs;

  /** 최근 1초에 보낸 건수 */
  function count(now) {
    let n = 0;
    for (let i = 0; i < slots; i++) if (live(i, now)) n++;
    return n;
  }

  /** 최근 1초에 보낸 이벤트류 건수 */
  function events(now) {
    let n = 0;
    for (let i = 0; i < slots; i++) if (ev[i] && live(i, now)) n++;
    return n;
  }

  // 보낼 수 있으면 쓸 칸 번호, 아니면 -1
  function freeSlot(kind, now) {
    if (!Number.isFinite(now)) return -1;
    let free = -1;
    let e = 0;
    for (let i = 0; i < slots; i++) {
      if (!live(i, now)) {
        if (free < 0) free = i;
      } else if (ev[i]) e++;
    }
    if (kind !== 's' && e >= eventSlots) return -1;
    return free;
  }

  /** 지금 보내도 되는지만 본다(칸을 쓰지 않는다) */
  const room = (kind, now) => freeSlot(kind, now) >= 0;

  /** 보내도 되면 한 칸을 쓰고 true. 안 되면 false(아무것도 바뀌지 않는다) */
  function take(kind, now) {
    const i = freeSlot(kind, now);
    if (i < 0) return false;
    at[i] = now;
    ev[i] = kind === 's' ? 0 : 1;
    return true;
  }

  function reset() {
    at.fill(-Infinity);
    ev.fill(0);
  }

  return { take, count, events, room, reset, slots, eventSlots, windowMs };
}

// new Limiter() 로 써도 같은 것이 나온다
export { createLimiter as Limiter };
export default createLimiter;
