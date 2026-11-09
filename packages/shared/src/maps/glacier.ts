import { curvedMap } from '../curve.ts';
import type { MapData } from '../map.ts';

// 벽 없이 바다 위 절벽으로 둘러싸인 고난도 빙판 트랙이다. 좁은 급커브가 이어지고, 트랙 밖으로 나가면 바다에 빠져 마지막 체크포인트로 돌아간다.
export const glacier: MapData = {
  id: 'glacier',
  name: '빙하 절벽',
  laps: 3,
  tileSize: 32,
  ...curvedMap({
    width: 72,
    height: 54,
    path: [
      [10, 8, 6], [46, 8, 6], [62, 14, 6], [62, 30, 6], [52, 34, 5], [44, 26, 5],
      [34, 34, 5], [40, 46, 6], [14, 46, 6], [8, 34, 5], [18, 26, 5], [8, 18, 5],
    ],
    radius: 5,
    halfWidth: 1.75,
    surface: 'ice',
    outside: 'sea',
    finish: [36, 8],
    bridges: [
      { from: [49.79, 9.42], to: [51.5, 32.83], bulge: 0 },
      { from: [9.28, 35.27], to: [8.6, 15.02], bulge: 2 },
    ],
  }),
  boostPads: [
    { x: 42, y: 6.5, w: 1.5, h: 3, angle: 0 },
    { x: 26, y: 44.5, w: 1.5, h: 3, angle: Math.PI },
  ],
  decor: [],
  wallColors: [0x8a96a8, 0xffffff],
  theme: { ground: 0x2f7fcf, sea: 0x2f7fcf, sand: 0xf4f8ff, ice: 0xcff0ff },
};
