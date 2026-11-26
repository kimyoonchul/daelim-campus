// 가상 보스(설계서 5.4). 아직 빈 껍데기다 — 보스 단계에서 이 파일(과 boss-data.js)을 채운다.
// ctx = { engine, world, player, cam, input, ui, net, remotes, store, profile, game, mayhem, bus, gfx, rules, sfx, GAME }
//
// 채울 때 알아 둘 것(앞 단계 구현에서 넘어온 약속):
// - 보스는 mayhem.addTarget({ id: 'boss:' + key, name, zone, x, y, z, radius, height, alive, hurt(d, w, x, z) })으로 등록한다.
//   id가 'boss:키' 꼴이고 name이 있어야 남의 기절 알림(by: 'boss:키')을 "아는 보스"로 받아들이고 이름을 찍는다.
// - 내가 맞을 때는 mayhem.hurt(d, { by: 'boss:' + key, kx, kz })(평화·기절·무적이면 알아서 무시한다),
//   감속은 mayhem.addSlow(초, 배율), 무기 고장은 mayhem.jam(초).
// - 내가 준 피해는 mayhem.claimBoss(key, d), 남이 준 피해는 bus 'bossClaim' { id, key, d }(형식만 걸러서 넘어온다 — 검증은 여기서),
//   격파 알림(boss)은 ctx.net.on('event', …)로 직접 받는다.
// - 미니맵 표시는 game.addMapMarker(fn), 보상은 game.addGrades(n).
// - 소리: sfx.bossRoar(), sfx.bossDown().
export function createBoss() {
  return {
    update() {},
  };
}
