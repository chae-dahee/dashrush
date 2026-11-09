import { curvedMap } from '../curve.ts';
import type { MapData } from '../map.ts';

// 붉은 사막의 흙길 랠리 트랙이다. 왼쪽에서 짧은 모래 길과 부스트 패드가 있는 긴 흙길 중 하나를 고른다.
export const desert: MapData = {
  id: 'desert',
  name: '사막 랠리',
  laps: 3,
  tileSize: 32,
  ...curvedMap({
    width: 70,
    height: 58,
    path: [
      [6, 10], [26, 10], [26, 18], [34, 18], [34, 10], [62, 10], [62, 19], [50, 19], [50, 29], [62, 29],
      [62, 37], [54, 37], [54, 45], [62, 45], [62, 53], [46, 53], [46, 45], [38, 45], [38, 53], [6, 53],
    ],
    radius: 3,
    halfWidth: 2,
    surface: 'asphalt',
    outside: 'offroad',
    finish: [54, 10],
    lanes: [{ from: [20, 53], to: [20, 10], surface: 'sand' }],
    bridges: [
      { from: [26, 15], to: [34, 15], bulge: 0, halfWidth: 1 },
      { from: [53, 19], to: [53, 29], bulge: 0, halfWidth: 1 },
      { from: [57, 37], to: [57, 45], bulge: 0, halfWidth: 1 },
      { from: [46, 48], to: [38, 48], bulge: 0, halfWidth: 1 },
    ],
  }),
  boostPads: [
    { x: 11, y: 8.5, w: 1.5, h: 3, angle: 0 },
    { x: 12, y: 51.5, w: 1.5, h: 3, angle: Math.PI },
  ],
  decor: [],
  wallColors: [0x8a5a3c, 0xf0d9b5],
  theme: { ground: 0xcf6d42, grass: [0xd9774a, 0xcf6d42], asphalt: 0xa8784f, sand: 0xf3d37c },
};
