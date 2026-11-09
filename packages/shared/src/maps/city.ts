import { curvedMap } from '../curve.ts';
import type { MapData } from '../map.ts';

// 둥근 직각 코너와 헤어핀 2곳이 있는 시가지 트랙이다. 시계 방향으로 달린다.
export const city: MapData = {
  id: 'city',
  name: '도심 서킷',
  laps: 3,
  tileSize: 32,
  ...curvedMap({
    width: 61,
    height: 47,
    path: [[8, 6], [52, 6], [52, 18], [36, 18], [36, 28], [52, 28], [52, 40], [8, 40], [8, 30], [22, 30], [22, 18], [8, 18]],
    radius: 3,
    halfWidth: 2,
    surface: 'asphalt',
    outside: 'offroad',
    finish: [30, 6],
    bridges: [{ from: [52, 18], to: [52, 28], bulge: 1.5, halfWidth: 0.75 }],
  }),
  boostPads: [
    { x: 40, y: 4.5, w: 1.5, h: 3, angle: 0 },
    { x: 28, y: 38.5, w: 1.5, h: 3, angle: Math.PI },
  ],
  decor: [],
  wallColors: [0xb9b4aa, 0x8f8a80],
};
