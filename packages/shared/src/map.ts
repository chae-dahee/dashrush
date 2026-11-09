import { KART_RADIUS } from './constants.ts';

// 맵 좌표와 물리 계산은 모두 타일 단위이다. 픽셀 변환은 렌더링에서만 한다.

export interface Vec {
  x: number;
  y: number;
}

export interface Checkpoint {
  a: Vec;
  b: Vec;
  optional?: boolean;
}


export interface MapTheme {
  ground: number;
  grass?: [number, number];
  sand?: number;
  asphalt?: number;
  ice?: number;
  sea?: number;
}

export interface GridSlot extends Vec {
  angle: number;
}

export interface BoostPad {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
}

export interface MapData {
  id: string;
  name: string;
  laps: number;
  tileSize: number;
  width: number;
  height: number;
  tiles: string[];
  checkpoints: Checkpoint[]; // 0번이 결승선이다.
  grid: GridSlot[];
  boostPads: BoostPad[];
  decor: Decor[]; // 트랙 밖 풍경과 충돌 방해물이다.
  wallColors: [number, number]; // 벽 타일에 번갈아 칠하는 두 색
  theme?: MapTheme;
  arrows?: FloorArrow[]; // 바닥에 칠하는 진행 방향 화살표이며 판정이 없다.
  branches?: Vec[][]; // 체크포인트 순서 밖 갈림길의 진행 방향 중심선이며 역주행 표시에만 쓴다.
  track?: CurvedTrack;
  signs?: WallSign[]; // 헤어핀 표지판은 자동으로 세우므로, 그 밖에 방향이 헷갈리는 곳만 적는다.
  hills?: Hill[];
}

// 화면에만 보이는 언덕이며 물리 판정은 평면 그대로이다. 바다 맵에는 두지 않는다.
export interface Hill extends Vec {
  radius: number;
  height: number;
}

export function heightAt(map: MapData, x: number, y: number): number {
  let h = 0;
  for (const hill of map.hills ?? []) {
    const d = Math.hypot(x - hill.x, y - hill.y);
    if (d < hill.radius) h += (hill.height * (1 + Math.cos((Math.PI * d) / hill.radius))) / 2;
  }
  return h;
}

// 닫힌 중심선에서 halfWidth 안쪽이 트랙이다.
export interface CurvedTrack {
  line: Vec[];
  halfWidth: number;
  surface: 'asphalt' | 'ice';
  outside: 'offroad' | 'sea' | 'wall';
  lanes?: { line: Vec[]; surface: 'sand' }[]; // 늘 열려 있는 갈래길이며 열린 곡선이다.
  bridges?: { line: Vec[]; halfWidth: number }[]; // 늘 열려 있는 지름길이며 트랙과 같은 재질로 판정한다.
}

export interface FloorArrow extends Vec {
  angle: number;
}

// (x, y)에 세우는 방향 표지판이다. dir은 표지판을 바라보며 다가오는 카트의 진행 방향이다.
export interface WallSign extends Vec {
  dir: number;
  arrow: 'left' | 'right' | 'straight';
}

// 장식 종류별 scale 1일 때 모델 바닥 면적에 맞춘 충돌 반지름(타일)이다.
export const DECOR_RADIUS = {
  cone: 0.3, tires: 0.55, grandstand: 1.9, pit: 1.8, lightTower: 0.45, billboard: 0.9, flag: 0.25, balloons: 0.35,
  shop: 1.6, streetTree: 0.55, lamp: 0.25, trafficLight: 0.25, planter: 0.45,
  maple: 0.75, gate: 1.9, shrub: 0.75, bench: 0.6, leafPile: 0.6,
  hut: 1.3, pine: 0.6, snowman: 0.5, snowdrift: 0.8, iceChunk: 0.45,
  mesa: 1.8, cactus: 0.4, camp: 1.7, tent: 0.9, bush: 0.5, stake: 0.15, rock: 0.7,
  iceberg: 1.8, icePillar: 0.7, floe: 1.3,
};

export type DecorType = keyof typeof DECOR_RADIUS;

export interface Decor extends Vec {
  type: DecorType;
  radius: number; // 카트 충돌에 쓰는 원의 반지름(타일)
  angle?: number;
  scale?: number;
  variant?: number; // 같은 종류 안의 색·형태 변형 번호
}

export function decor(type: DecorType, x: number, y: number, scale = 1, angle = 0, variant = 0): Decor {
  return { type, x, y, radius: DECOR_RADIUS[type] * scale, scale, angle, variant };
}

export type Surface = 'asphalt' | 'curb' | 'grass' | 'sand' | 'ice' | 'verge' | 'offroad' | 'wall' | 'sea';

// 트랙 밖 땅 중 가장자리에서 이 폭(타일) 안은 덜 느린 도로 옆 잔디이다.
export const VERGE_WIDTH = 1.5;

export const TILE_SURFACE: Record<string, Surface> = {
  '.': 'asphalt',
  c: 'curb',
  g: 'grass',
  s: 'sand',
  i: 'ice',
  '#': 'wall',
  '~': 'sea',
};

export interface SurfaceParams {
  speed: number; // 최고 속도 배율
  grip: number; // 접지력 배율
}

export const SURFACE_PARAMS: Record<Exclude<Surface, 'wall' | 'sea'>, SurfaceParams> = {
  asphalt: { speed: 1, grip: 1 },
  curb: { speed: 1, grip: 1 },
  grass: { speed: 0.5, grip: 1 },
  sand: { speed: 0.6, grip: 1 },
  ice: { speed: 1, grip: 0.25 },
  verge: { speed: 0.5, grip: 1 },
  offroad: { speed: 0.15, grip: 1 },
};

// 맵 밖은 벽으로 취급해 카트가 빠져나가지 못하게 한다.
export function surfaceAt(map: MapData, tx: number, ty: number): Surface {
  const row = map.tiles[ty];
  const ch = row?.[tx];
  return (ch !== undefined && TILE_SURFACE[ch]) || 'wall';
}

// track이 있어도 모래 타일(지름길 다리·패치)이 우선한다.
export function surfaceAtPoint(map: MapData, x: number, y: number): Surface {
  const tile = surfaceAt(map, Math.floor(x), Math.floor(y));
  const t = map.track;
  if (!t || tile === 'sand') return tile;
  if (t.bridges?.some((b) => nearestOnLine(b.line, x, y, false).d <= b.halfWidth)) return t.surface;
  if (nearestOnLine(t.line, x, y, true).d <= t.halfWidth) return t.surface;
  const lane = t.lanes?.find((l) => nearestOnLine(l.line, x, y, false).d <= t.halfWidth);
  if (lane) return lane.surface;
  const c = nearestOnTrack(t, x, y);
  if (t.outside === 'offroad' && c.d <= c.halfWidth + VERGE_WIDTH) return 'verge';
  return t.outside;
}

// 본선, 갈래길, 열린 지름길 중 가장자리가 가장 가까운 중심선 위의 점과 그 반폭이다.
export function nearestOnTrack(t: CurvedTrack, x: number, y: number): Vec & { d: number; halfWidth: number } {
  let best = { ...nearestOnLine(t.line, x, y, true), halfWidth: t.halfWidth };
  const others = [...(t.lanes ?? []).map((l) => ({ line: l.line, halfWidth: t.halfWidth })), ...(t.bridges ?? [])];
  for (const o of others) {
    const c = nearestOnLine(o.line, x, y, false);
    if (c.d - o.halfWidth < best.d - best.halfWidth) best = { ...c, halfWidth: o.halfWidth };
  }
  return best;
}

function nearestOnLine(line: Vec[], x: number, y: number, closed: boolean): Vec & { d: number } {
  let best = { x: line[0].x, y: line[0].y, d: Infinity };
  for (let i = 0; i < line.length - (closed ? 0 : 1); i++) {
    const a = line[i], b = line[(i + 1) % line.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const px = a.x + dx * t, py = a.y + dy * t;
    const d = Math.hypot(px - x, py - y);
    if (d < best.d) best = { x: px, y: py, d };
  }
  return best;
}

export function validateMap(map: MapData): string[] {
  const errors: string[] = [];
  if (map.tiles.length !== map.height) errors.push(`행 수 ${map.tiles.length} ≠ height ${map.height}`);
  map.tiles.forEach((row, y) => {
    if (row.length !== map.width) errors.push(`${y}행 길이 ${row.length} ≠ width ${map.width}`);
    for (const ch of row) if (!(ch in TILE_SURFACE)) errors.push(`${y}행 알 수 없는 타일 '${ch}'`);
  });
  if (map.checkpoints.length < 2) errors.push('체크포인트는 2개 이상이어야 한다');
  if (map.checkpoints[0]?.optional) errors.push('0번 체크포인트는 optional일 수 없다');
  if (map.grid.length !== 8) errors.push('출발 그리드는 8칸이어야 한다');
  map.grid.forEach((g, i) => {
    const s = surfaceAtPoint(map, g.x, g.y);
    if (s === 'wall' || s === 'sea' || s === 'offroad') errors.push(`그리드 ${i}번이 트랙 밖에 있다`);
  });
  map.decor.forEach((d, i) => {
    const s = surfaceAtPoint(map, d.x, d.y);
    if (!Number.isFinite(d.radius) || d.radius <= 0) errors.push(`장식 ${i}번의 충돌 반경이 잘못됐다`);
    if (d.x - d.radius < 0 || d.y - d.radius < 0 || d.x + d.radius > map.width || d.y + d.radius > map.height) {
      errors.push(`장식 ${i}번이 맵 경계를 벗어난다`);
    }
    if (s === 'asphalt' || s === 'curb' || s === 'ice' || s === 'sand') errors.push(`장식 ${i}번이 주행 노면 위에 있다`);
    if (map.track) {
      const c = nearestOnTrack(map.track, d.x, d.y);
      if (c.d <= c.halfWidth + d.radius + KART_RADIUS + 0.05) errors.push(`장식 ${i}번이 트랙과 겹친다`);
    }
    map.decor.slice(0, i).forEach((other, j) => {
      if (Math.hypot(d.x - other.x, d.y - other.y) <= d.radius + other.radius) errors.push(`장식 ${i}번이 ${j}번 장식과 겹친다`);
    });
    if (map.boostPads.some((p) => {
      const x = Math.max(p.x, Math.min(d.x, p.x + p.w));
      const y = Math.max(p.y, Math.min(d.y, p.y + p.h));
      return Math.hypot(x - d.x, y - d.y) <= d.radius;
    })) errors.push(`장식 ${i}번이 부스트 패드와 겹친다`);
  });
  return errors.map((e) => `[${map.id}] ${e}`);
}
