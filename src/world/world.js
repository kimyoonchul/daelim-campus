// 월드 조립: 캠퍼스(야외) 구역과 실내 구역을 만들고, 이동·카메라가 쓰는 질의 함수를 구역별로 제공한다.
import * as THREE from 'three';
import data from '../../data/campus-data.js';
import { heightAt, slopeAt } from './heightfield.js';
import { zoneAt } from './occupancy.js';
import { Collider } from './collision.js';
import { buildTerrain } from './terrain.js';
import { buildBuildings } from './buildings.js';

export function createWorld(engine) {
  const zones = {};
  const world = {
    zones,
    active: null,
    interactables: [], // {zone, x, y, z, r, label, icon, onUse, visible?}
    data,
    setZone(id) {
      const z = zones[id];
      if (!z) return;
      for (const k in zones) zones[k].group.visible = k === id;
      world.active = z;
      z.onEnter && z.onEnter();
      return z;
    },
    addInteractable(it) {
      world.interactables.push(it);
      return it;
    },
    addZone(zone) {
      zones[zone.id] = zone;
      zone.group.visible = false;
      engine.scene.add(zone.group);
      return zone;
    },
  };

  // ----- 캠퍼스(야외) -----
  const group = new THREE.Group();
  const collider = new Collider(8);
  const terrain = buildTerrain(engine);
  group.add(terrain.group);
  const bld = buildBuildings(engine, collider);
  group.add(bld.group);

  const campus = {
    id: 'campus',
    name: '캠퍼스',
    interior: false,
    group,
    collider,
    conveyors: [],
    heightAt,
    slopeAt,
    playable: (x, z) => zoneAt(x, z) > 0,
    conveyorAt(x, z) {
      for (const c of campus.conveyors) {
        if (x < c.bb[0] || x > c.bb[2] || z < c.bb[1] || z > c.bb[3]) continue;
        const hit = c.at(x, z);
        if (hit) return hit;
      }
      return null;
    },
    cameraBlocked(x, y, z) {
      if (y < heightAt(x, z) + 0.35) return true;
      const s = collider.solidAt(x, z);
      return !!s && y < s.top && y > s.base;
    },
    pitchMin: -0.2,
    pitchMax: 1.4,
    onEnter() {
      engine.scene.fog.near = 260;
      engine.scene.fog.far = 1050;
    },
  };
  world.addZone(campus);
  world.campus = campus;
  world.terrain = terrain;
  world.buildings = bld;
  world.doors = bld.doors;
  world.setZone('campus');
  return world;
}
