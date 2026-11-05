import type { MapData, Vec } from './map.ts';

// 선분 p→q가 선분 a–b와 만나면 p→q 위의 비율(0~1)을, 아니면 null을 돌려준다.
export function segmentCross(p: Vec, q: Vec, a: Vec, b: Vec): number | null {
  const rx = q.x - p.x, ry = q.y - p.y;
  const sx = b.x - a.x, sy = b.y - a.y;
  const denom = rx * sy - ry * sx;
  if (denom === 0) return null;
  const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / denom;
  const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

const mid = (c: { a: Vec; b: Vec }): Vec => ({ x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 });

// 완주 랩 × 체크포인트 수 + 마지막 체크포인트 + 다음 체크포인트까지의 비율이다.
export function progress(map: MapData, k: { x: number; y: number; lap: number; cp: number }): number {
  const cps = map.checkpoints;
  const n = cps.length;
  if (k.cp < 0) return -1;
  const from = mid(cps[k.cp]);
  const to = mid(cps[(k.cp + 1) % n]);
  const total = Math.hypot(to.x - from.x, to.y - from.y);
  const left = Math.hypot(to.x - k.x, to.y - k.y);
  const frac = Math.min(1, Math.max(0, 1 - left / total));
  return k.lap * n + k.cp + frac;
}
