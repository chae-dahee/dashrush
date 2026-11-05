// 맵 좌표와 물리 계산은 모두 타일 단위이다. 픽셀 변환은 렌더링에서만 한다.

export interface Vec {
  x: number;
  y: number;
}

export interface Checkpoint {
  a: Vec;
  b: Vec;
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
}

export type Surface = 'asphalt' | 'curb' | 'grass' | 'sand' | 'ice' | 'wall';

export const TILE_SURFACE: Record<string, Surface> = {
  '.': 'asphalt',
  c: 'curb',
  g: 'grass',
  s: 'sand',
  i: 'ice',
  '#': 'wall',
};

export interface SurfaceParams {
  speed: number; // 최고 속도 배율
  grip: number; // 접지력 배율
}

export const SURFACE_PARAMS: Record<Exclude<Surface, 'wall'>, SurfaceParams> = {
  asphalt: { speed: 1, grip: 1 },
  curb: { speed: 1, grip: 1 },
  grass: { speed: 0.5, grip: 1 },
  sand: { speed: 0.6, grip: 1 },
  ice: { speed: 1, grip: 0.25 },
};

// 맵 밖은 벽으로 취급해 카트가 빠져나가지 못하게 한다.
export function surfaceAt(map: MapData, tx: number, ty: number): Surface {
  const row = map.tiles[ty];
  const ch = row?.[tx];
  return (ch !== undefined && TILE_SURFACE[ch]) || 'wall';
}

export function validateMap(map: MapData): string[] {
  const errors: string[] = [];
  if (map.tiles.length !== map.height) errors.push(`행 수 ${map.tiles.length} ≠ height ${map.height}`);
  map.tiles.forEach((row, y) => {
    if (row.length !== map.width) errors.push(`${y}행 길이 ${row.length} ≠ width ${map.width}`);
    for (const ch of row) if (!(ch in TILE_SURFACE)) errors.push(`${y}행 알 수 없는 타일 '${ch}'`);
  });
  if (map.checkpoints.length < 2) errors.push('체크포인트는 2개 이상이어야 한다');
  if (map.grid.length !== 8) errors.push('출발 그리드는 8칸이어야 한다');
  map.grid.forEach((g, i) => {
    if (surfaceAt(map, Math.floor(g.x), Math.floor(g.y)) === 'wall') errors.push(`그리드 ${i}번이 벽 위에 있다`);
  });
  return errors.map((e) => `[${map.id}] ${e}`);
}
