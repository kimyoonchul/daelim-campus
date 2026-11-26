// 무기 발사와 탄(설계서 5.1). 아직 빈 껍데기다 — 무기 단계에서 이 파일을 채운다.
// ctx = { engine, world, player, cam, input, ui, net, remotes, store, profile, game, mayhem, bus, gfx, rules, sfx, GAME }
//
// 채울 때 알아 둘 것(앞 단계 구현에서 넘어온 약속):
// - 공격 1회마다 mayhem.bumpAtk(ax, az)(공격 횟수·겨냥점·전투 잠금·내 아바타 동작), 맞힌 것은 mayhem.claimHit(id, d, w, x, z),
//   대상은 mayhem.armedPeers()(원격 접속자 기록, 프레임마다 한 번만 다시 만든다)와 mayhem.targets, 고장은 mayhem.isJammed().
// - 대포알의 처음 속도는 rules.shellLaunch(dx, dy, dz) — 비행시간 방식, NaN 없음.
// - 남의 발사 재현: remotes 기록의 r.atkEvents·r.atkPose는 그 스냅샷의 wpn이 0보다 클 때만 바뀐다.
//   atkPose = { x, y, z, yaw, ax, az, w, zone } — 무기 종류는 atkPose.w, zone은 내부 구역 id.
// - 쿨다운 표시 ui.setWeapon(wpn, cd01)의 cd01은 "남은" 비율이다(방금 쐈으면 1, 준비됐으면 0).
// - 소리: 대포 발사는 sfx.launch(true), 남의 대포는 sfx.at('launch', 거리, true). launch에 인자가 없으면 폭죽 소리다.
// - 'aimtap'은 input.js가 걸러서 보낸다(패널이 떠 있을 때·오른쪽 버튼·두 손가락·끌기·길게 누르기는 나오지 않는다).
//   터치 공격 버튼은 input.fireTouch를 켜면서 input.emit('fire')도 낸다 — 'fire' 이벤트와 input.fire 양쪽에서 쏘면 한 번 눌러 두 번 나간다.
// - gfx.explosion의 quiet(남의 폭발)는 gfx가 전체 1초 2번으로 제한한다(그리지 않았으면 false를 돌려준다).
export function createWeapons() {
  return {
    update() {},
  };
}
