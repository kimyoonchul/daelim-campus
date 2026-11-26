// 건물·주차 차량 파괴와 연습용 과녁(설계서 5.2). 아직 빈 껍데기다 — 파괴 단계에서 이 파일을 채운다.
// ctx = { engine, world, player, cam, input, ui, net, remotes, store, profile, game, mayhem, bus, gfx, rules, sfx, GAME }
//
// 채울 때 알아 둘 것(앞 단계 구현에서 넘어온 약속):
// - 돌려주는 객체에 isDown(key)를 두면 mayhem.isDown(key)가 그것을 부른다.
// - 차를 숨기고 되돌릴 때는 world.props.setCarVisible(i, false 또는 true, 'boom')처럼 세 번째 인자(숨기는 까닭)를 꼭 준다.
//   차량 모듈은 'ride'를 쓴다. 까닭이 다르면 서로의 숨김을 풀지 않는다(하나라도 남아 있으면 계속 숨는다).
// - 누가 타고 있는 차인지는 쓸 때마다 ctx.mayhem.vehicles.isCarBusy(i)로 묻는다(이 모듈이 차량 모듈보다 먼저 만들어진다).
// - 내 폭발은 bus 'explosion', 남이 터뜨렸다는 차량 주장은 bus 'carClaim' { id, i }(형식만 걸러서 넘어온다 — 검증은 여기서),
//   건물 붕괴·늦게 온 사람용 알림(bd·ws)은 ctx.net.on('event', …)로 직접 받는다. 내가 터뜨린 차는 mayhem.claimCar(i).
// - 소리: 건물 붕괴는 sfx.crash(true), 재건은 sfx.build().
// - 과녁은 mayhem.addTarget({ id, zone, x, y, z, radius, height, alive, hurt(d, w, x, z) })으로 세운다.
export function createDestruct() {
  return {
    update() {},
  };
}
