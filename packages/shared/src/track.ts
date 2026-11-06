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

// p에서 가장 가까운 트랙 중심선 선분의 진행 방향(라디안)이다. 중심선은 이웃한 체크포인트 중점을 이은 선, branches, 갈래길, 열린 곡선 지름길이다.
export function trackDirection(map: MapData, p: Vec): number {
  const cps = map.checkpoints;
  const lines = [[...cps.map(mid), mid(cps[0])], ...(map.branches ?? []), ...(map.track?.lanes ?? []).map((l) => l.line), ...(map.track?.bridges ?? []).map((b) => b.line)];
  let best = Infinity;
  let dir = 0;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
      if (d < best) {
        best = d;
        dir = Math.atan2(dy, dx);
      }
    }
  }
  return dir;
}

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
