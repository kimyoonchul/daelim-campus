// 자동차 타고 다니기(설계서 5.3). 아직 빈 껍데기다 — 차량 단계에서 이 파일(과 carstep.js)을 채운다.
// ctx = { engine, world, player, cam, input, ui, net, remotes, store, profile, game, mayhem, bus, gfx, rules, sfx, GAME }
//
// 채울 때 알아 둘 것(앞 단계 구현에서 넘어온 약속):
// - 탈 때 bus.emit('mount', { i }), 내릴 때 bus.emit('unmount', { i })를 내면 mayhem.state.car(통신에 실리는 차량 번호)는 index.js가 맞춘다.
// - 탑승 중에는 player.mount = { x, y, z, yaw }를 매 프레임 갱신한다(mayhem.update는 player.update보다 먼저 돈다). 내릴 때 null.
//   차에서 튕겨 내는 player.impulse는 mount = null과 player.place()가 둘 다 끝난 뒤에 부른다(그 전에 준 것은 지워진다).
// - 주차 인스턴스를 숨기고 되돌릴 때는 world.props.setCarVisible(i, on, 'ride')처럼 세 번째 인자(숨기는 까닭)를 꼭 준다.
//   내가 탄 차도 이렇게 숨겨야 그 차의 주차 충돌 원이 꺼진다. 파괴 모듈은 'boom'을 쓴다.
// - bus 'ko' { id, by }에서 id가 ctx.net.id면 내가 기절한 것이다 — 바로 내린다.
// - 돌려주는 객체에 isCarBusy(i), driving()을 둔다(파괴 모듈이 ctx.mayhem.vehicles.isCarBusy로 묻는다).
// - 경적은 'fire' 이벤트(키보드 F의 첫 눌림, 터치 공격 버튼). 소리: 경적 sfx.horn(), 충돌 sfx.crash().
// - ui.setCar({ kmh, hp01 })의 kmh는 km/h다(m/s × 3.6). 내리면 ui.setCar(null).
// - 사람을 들이받은 주장은 mayhem.claimHit(id, d, 'car', x, z), 내 차가 터져 다치면 mayhem.hurt(d, { by: 'car' }).
export function createVehicles() {
  return {
    update() {},
  };
}
