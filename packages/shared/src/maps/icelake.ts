import { curvedMap } from '../curve.ts';
import type { MapData } from '../map.ts';

// 대부분이 빙판이고 군데군데 눈 둔덕이 있는 겨울 호수 트랙이다. 미끄러지는 차체를 다루는 실력이 승패를 가른다.
export const icelake: MapData = {
  id: 'icelake',
  name: '빙판 호수',
  laps: 3,
  tileSize: 32,
  ...curvedMap({
    width: 76,
    height: 54,
    path: [[36, 10], [64, 10], [64, 44], [46, 44], [46, 30], [32, 30], [32, 44], [12, 44], [12, 10], [24, 10], [24, 22], [36, 22]],
    radius: 4,
    halfWidth: 3,
    surface: 'ice',
    outside: 'offroad',
    finish: [52, 10],
    bridges: [{ from: [46, 44], to: [32, 44], bulge: 1.5, halfWidth: 0.6 }],
    patches: [
      { x: 61, y: 24, w: 3, h: 2, ch: 's' },
      { x: 22, y: 41, w: 2, h: 3, ch: 's' },
      { x: 9, y: 26, w: 3, h: 2, ch: 's' },
    ],
  }),
  boostPads: [
    { x: 58, y: 8.5, w: 1.5, h: 3, angle: 0 },
    { x: 18, y: 42.5, w: 1.5, h: 3, angle: Math.PI },
  ],
  decor: [],
  wallColors: [0x3d7bff, 0xffffff],
  theme: { ground: 0xe9f1fb, grass: [0xf4f8ff, 0xe9f1fb], sand: 0xd6e4f2, ice: 0xbfe6ff },
};
