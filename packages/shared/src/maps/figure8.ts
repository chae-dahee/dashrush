import { curvedMap } from '../curve.ts';
import type { MapData } from '../map.ts';

// 트랙이 가운데에서 평면으로 교차하는 가을 공원 트랙이다. 서로 다른 구간을 달리는 카트가 교차점에서 마주친다.
export const figure8: MapData = {
  id: 'figure8',
  name: '8자 교차로',
  laps: 3,
  tileSize: 32,
  ...curvedMap({
    width: 72,
    height: 56,
    path: [
      [37, 48], [60, 48], [60, 31], [54, 31], [54, 23], [47, 23], [47, 31], [12, 31], [12, 26], [20, 26], [20, 19],
      [12, 19], [12, 14], [19, 14], [19, 5], [26, 5], [26, 14], [37, 14], [37, 37], [45, 37], [45, 43], [37, 43],
    ],
    radius: 3,
    halfWidth: 2,
    surface: 'asphalt',
    outside: 'wall',
    finish: [52, 48],
    bridges: [
      { from: [54, 31], to: [47, 31], bulge: 1, halfWidth: 0.75 },
      { from: [12, 26], to: [12, 19], bulge: 1.5, halfWidth: 0.75 },
    ],
  }),
  boostPads: [
    { x: 26, y: 29.5, w: 1.5, h: 3, angle: Math.PI },
    { x: 56, y: 46.5, w: 1.5, h: 3, angle: 0 },
  ],
  decor: [],
  wallColors: [0xffc83d, 0x2b2340],
  arrows: [
    { x: 37, y: 25.5, angle: Math.PI / 2 },
    { x: 42.5, y: 31, angle: Math.PI },
  ],
  signs: [
    { x: 34.7, y: 26, dir: Math.PI / 2, arrow: 'straight' },
    { x: 39.3, y: 26, dir: Math.PI / 2, arrow: 'straight' },
    { x: 43, y: 28.7, dir: Math.PI, arrow: 'straight' },
    { x: 43, y: 33.3, dir: Math.PI, arrow: 'straight' },
  ],
  theme: { ground: 0xe6964f, grass: [0xf0a35e, 0xe6964f] },
};
