import type { Checkpoint, CurvedTrack, GridSlot, MapData, Vec } from './map.ts';

type Point = [number, number];

export interface CurvedMapSpec {
  width: number;
  height: number;
  path: (Point | [number, number, number])[]; // 진행 순서의 꼭짓점이며 모서리마다 radius(세 번째 값이 있으면 그 값) 원호로 둥글린다.
  radius: number;
  halfWidth: number;
  surface: CurvedTrack['surface'];
  outside: CurvedTrack['outside'];
  finish: Point; // 첫 변 위의 결승선 위치
  cpStep?: number;
  lanes?: { from: Point; to: Point; surface: 'sand' }[];
  bridges?: { from: Point; to: Point; bulge: number; halfWidth?: number }[];
  patches?: { x: number; y: number; w: number; h: number; ch: string }[];
}

const STEP = 0.5;
const CP_MARGIN = 2.5; // 체크포인트 선이 트랙 밖으로 나가는 길이이며, 코너 안쪽을 깊게 파고들어도 선을 지나게 한다.

// 꼭짓점 경로를 둥근 모서리 곡선 트랙으로 바꾼다. 같은 입력이면 서버와 클라이언트가 같은 맵을 만든다.
// 갈래길과 지름길 양 끝 사이의 본선 체크포인트는 optional이 된다.
export function curvedMap(spec: CurvedMapSpec): Pick<MapData, 'width' | 'height' | 'tiles' | 'checkpoints' | 'grid' | 'track'> {
  const { halfWidth: hw } = spec;
  const raw = filleted(spec.path, spec.radius);
  const start = nearestIndex(raw, spec.finish);
  const line = [...raw.slice(start), ...raw.slice(0, start)];
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + dist(line[i - 1], line[i]));
  const total = cum[cum.length - 1] + dist(line[line.length - 1], line[0]);

  const skips: [number, number][] = [];
  const lanes = (spec.lanes ?? []).map((l) => {
    skips.push([cum[nearestIndex(line, l.from)], cum[nearestIndex(line, l.to)]]);
    return { line: [toVec(l.from), toVec(l.to)], surface: l.surface };
  });
  const bridges = (spec.bridges ?? []).map((b) => {
    const i0 = nearestIndex(line, b.from), i1 = nearestIndex(line, b.to);
    skips.push([cum[i0], cum[i1]]);
    return { line: bridgeLine(line[i0], line[i1], line[Math.floor((i0 + i1) / 2)], b.bulge), halfWidth: b.halfWidth ?? hw };
  });

  const checkpoints: Checkpoint[] = [];
  const n = Math.round(total / (spec.cpStep ?? 5));
  for (let c = 0; c < n; c++) {
    const s = (total * c) / n;
    let i = cum.findIndex((v) => v >= s);
    if (i < 0) i = line.length - 1;
    const p = line[i], [tx, ty] = tangent(line, i), k = hw + CP_MARGIN;
    const cp: Checkpoint = { a: { x: p.x - ty * k, y: p.y + tx * k }, b: { x: p.x + ty * k, y: p.y - tx * k } };
    if (c > 0 && skips.some(([s0, s1]) => s > s0 && s < s1)) cp.optional = true;
    checkpoints.push(cp);
  }

  const [tx, ty] = tangent(line, 0), f = line[0], off = Math.min(1.5, hw * 0.55);
  const grid: GridSlot[] = [...Array(8).keys()].map((i) => ({
    x: f.x - tx * (1.5 + 1.2 * i) - ty * (i % 2 ? off : -off),
    y: f.y - ty * (1.5 + 1.2 * i) + tx * (i % 2 ? off : -off),
    angle: Math.atan2(ty, tx),
  }));

  const filler = spec.outside === 'sea' ? '~' : 'g';
  const rows = Array.from({ length: spec.height }, () => Array<string>(spec.width).fill(filler));
  for (const p of spec.patches ?? []) {
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) rows[y][x] = p.ch;
  }

  return {
    width: spec.width,
    height: spec.height,
    tiles: rows.map((r) => r.join('')),
    checkpoints,
    grid,
    track: { line, halfWidth: hw, surface: spec.surface, outside: spec.outside, ...(lanes.length && { lanes }), ...(bridges.length && { bridges }) },
  };
}

const dist = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y);
const toVec = ([x, y]: Point): Vec => ({ x, y });

function nearestIndex(line: Vec[], [x, y]: Point): number {
  let best = 0;
  line.forEach((p, i) => {
    if (Math.hypot(p.x - x, p.y - y) < Math.hypot(line[best].x - x, line[best].y - y)) best = i;
  });
  return best;
}

function tangent(line: Vec[], i: number): Point {
  const a = line[(i - 1 + line.length) % line.length], b = line[(i + 1) % line.length];
  const l = dist(a, b);
  return [(b.x - a.x) / l, (b.y - a.y) / l];
}

function filleted(path: CurvedMapSpec['path'], radius: number): Vec[] {
  const n = path.length;
  const unit = (x: number, y: number): Point => {
    const l = Math.hypot(x, y);
    return [x / l, y / l];
  };
  const corners = path.map((p, i) => {
    const a = path[(i - 1 + n) % n], c = path[(i + 1) % n];
    const d1 = unit(p[0] - a[0], p[1] - a[1]), d2 = unit(c[0] - p[0], c[1] - p[1]);
    const phi = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
    // 짧은 변의 양 끝 원호가 겹치지 않도록 원호가 차지하는 길이를 변의 절반으로 제한한다.
    const half = Math.min(Math.hypot(p[0] - a[0], p[1] - a[1]), Math.hypot(c[0] - p[0], c[1] - p[1])) / 2;
    const t = Math.min(((p as number[])[2] ?? radius) * Math.tan(phi / 2), half);
    const r = t / Math.tan(phi / 2);
    const s = Math.sign(d1[0] * d2[1] - d1[1] * d2[0]);
    const A: Point = [p[0] - d1[0] * t, p[1] - d1[1] * t];
    const C: Point = [A[0] - d1[1] * s * r, A[1] + d1[0] * s * r];
    return { A, B: [p[0] + d2[0] * t, p[1] + d2[1] * t] as Point, C, s, phi, r };
  });
  const out: Vec[] = [];
  corners.forEach((c, i) => {
    const a0 = Math.atan2(c.A[1] - c.C[1], c.A[0] - c.C[0]);
    const arc = Math.max(1, Math.ceil((c.r * c.phi) / STEP));
    for (let k = 0; k <= arc; k++) {
      const a = a0 + c.s * c.phi * (k / arc);
      out.push({ x: c.C[0] + Math.cos(a) * c.r, y: c.C[1] + Math.sin(a) * c.r });
    }
    const next = corners[(i + 1) % n];
    const m = Math.ceil(Math.hypot(next.A[0] - c.B[0], next.A[1] - c.B[1]) / STEP);
    for (let k = 1; k < m; k++) out.push({ x: c.B[0] + ((next.A[0] - c.B[0]) * k) / m, y: c.B[1] + ((next.A[1] - c.B[1]) * k) / m });
  });
  return out;
}

// 두 끝을 잇는 2차 곡선이며, 건너뛰는 구간 반대쪽으로 bulge만큼 휜다.
function bridgeLine(p0: Vec, p2: Vec, skipped: Vec, bulge: number): Vec[] {
  const m = { x: (p0.x + p2.x) / 2, y: (p0.y + p2.y) / 2 };
  const ax = m.x - skipped.x, ay = m.y - skipped.y, l = Math.hypot(ax, ay) || 1;
  const c = { x: m.x + (ax / l) * bulge * 2, y: m.y + (ay / l) * bulge * 2 };
  const n = Math.max(4, Math.ceil(dist(p0, p2) / STEP));
  return [...Array(n + 1).keys()].map((k) => {
    const t = k / n, u = 1 - t;
    return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y };
  });
}
