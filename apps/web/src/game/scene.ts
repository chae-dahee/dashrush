import * as THREE from 'three';
import {
  DRIFT_END_MIN_SEC,
  FALL_SEC,
  heightAt,
  nearestOnTrack,
  surfaceAt,
  VERGE_WIDTH,
  type CurvedTrack,
  type MapData,
  type Vec,
  type WallSign,
} from '@dashrush/shared';

// 물리 좌표 (x, y)는 장면의 (x, 0, y)이고 1 단위가 1 타일이다.
// 캐주얼 카툰 톤의 임시 모형이며 4단계에서 에셋으로 교체한다.

export interface ViewKart {
  id: string;
  x: number;
  y: number;
  angle: number;
  color: number;
  drifting: boolean;
  driftSlip: number;
  boostLeft: number;
  speed: number;
  ghost: boolean;
  fallLeft: number;
  spawnLeft: number;
  label?: string; // 다른 카트 위에 띄우는 닉네임
}

const LAYER_GAP = 0.003;
const BUMP_SPEED_DROP = 2.5; // 한 프레임에 이만큼 속력이 떨어지면 부딪힌 것으로 본다.

export const OUTLINE = 0x2b2340;
const TEX_PX = 32; // 바닥 텍스처의 타일당 픽셀 수
const WALL_HEIGHT = 0.7;
export const SEA_DEPTH = 1.2;
const SPAWN_BLINK_SEC = 0.12;
const SEA_COLOR = 0x3a8fd6;
const CLIFF_COLOR = 0x8a96a8;

const FLOOR_COLORS = {
  asphalt: '#6b6f82',
  grass: '#7fd35b',
  grassAlt: '#74c851',
  sand: '#f3d37c',
  ice: '#c4ecff',
  curbA: '#ff5b5b',
  curbB: '#ffffff',
  sea: '#3a8fd6',
  offroad: '#7fd35b',
  verge: '#a6e384',
};
const GROUND_COLOR = 0x74c851;

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

function floorColors(map: MapData): typeof FLOOR_COLORS {
  const t = map.theme;
  const pick = (c: number | undefined, d: string) => (c === undefined ? d : hex(c));
  const lighten = (c: number) => hex([16, 8, 0].reduce((v, s) => v | (Math.round(((c >> s) & 255) * 0.7 + 255 * 0.3) << s), 0));
  return {
    ...FLOOR_COLORS,
    asphalt: pick(t?.asphalt, FLOOR_COLORS.asphalt),
    verge: t?.grass ? lighten(t.grass[0]) : FLOOR_COLORS.verge,
    grass: pick(t?.grass?.[0], FLOOR_COLORS.grass),
    grassAlt: pick(t?.grass?.[1], FLOOR_COLORS.grassAlt),
    sand: pick(t?.sand, FLOOR_COLORS.sand),
    ice: pick(t?.ice, FLOOR_COLORS.ice),
    sea: pick(t?.sea, FLOOR_COLORS.sea),
  };
}

const hasSea = (map: MapData) => map.tiles.some((row) => row.includes('~'));

const FALL_GRAVITY = 6; // 바다로 떨어지는 카트를 그릴 때의 중력 가속도(타일/초²)
const FALL_NOSE_RATE = 1.2; // 떨어지는 동안 앞코를 숙이는 속도(라디안/초)
const FALL_NOSE_MAX = 0.9;

// 바다에 빠진 카트가 지면에서 내려간 거리이다. 트랙 밖 3초 리스폰은 바다가 없는 맵에서만 일어나므로 바다 맵의 낙하는 모두 바다 낙하이다.
export function fallDrop(map: MapData, k: ViewKart): number {
  if (k.fallLeft === 0 || !hasSea(map)) return 0;
  const t = FALL_SEC - k.fallLeft;
  return (FALL_GRAVITY * t * t) / 2;
}

// 0~1 균등 난수를 정해진 순서로 내므로 같은 맵은 늘 같은 무늬를 그린다.
function seeded(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

let toonGradient: THREE.DataTexture | null = null;

// 3단계 명암으로 툰 느낌을 낸다.
function gradient(): THREE.DataTexture {
  if (toonGradient) return toonGradient;
  const data = new Uint8Array([90, 90, 90, 255, 180, 180, 180, 255, 255, 255, 255, 255]);
  toonGradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  toonGradient.minFilter = THREE.NearestFilter;
  toonGradient.magFilter = THREE.NearestFilter;
  toonGradient.needsUpdate = true;
  return toonGradient;
}

export const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: gradient() });

// forScene이면 바다 타일을 투명하게 남겨, 아래에 까는 바다 평면이 보이게 한다.
export function drawFloorCanvas(map: MapData, px: number, forScene = false): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.width * px;
  canvas.height = map.height * px;
  const ctx = canvas.getContext('2d')!;
  const colors = floorColors(map);
  const track = map.track;

  if (track) {
    if (track.outside !== 'sea') {
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          ctx.fillStyle = (x + y) % 2 === 0 ? colors.grass : colors.grassAlt;
          ctx.fillRect(x * px, y * px, px, px);
        }
      }
    } else if (!forScene) {
      ctx.fillStyle = colors.sea;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (track.outside === 'offroad') {
      ctx.strokeStyle = colors.verge;
      const lines: [Vec[], boolean, number][] = [
        [track.line, true, track.halfWidth],
        ...(track.lanes ?? []).map((x): [Vec[], boolean, number] => [x.line, false, track.halfWidth]),
        ...(track.bridges ?? []).map((b): [Vec[], boolean, number] => [b.line, false, b.halfWidth]),
      ];
      for (const [l, closed, hw] of lines) {
        ctx.lineWidth = (hw + VERGE_WIDTH) * 2 * px;
        ctx.beginPath();
        l.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * px, p.y * px) : ctx.lineTo(p.x * px, p.y * px)));
        if (closed) ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.lineWidth = track.halfWidth * 2 * px;
    for (const l of track.lanes ?? []) {
      ctx.strokeStyle = colors[l.surface];
      ctx.beginPath();
      l.line.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * px, p.y * px) : ctx.lineTo(p.x * px, p.y * px)));
      ctx.stroke();
    }
    ctx.strokeStyle = colors[track.surface];
    ctx.beginPath();
    track.line.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * px, p.y * px) : ctx.lineTo(p.x * px, p.y * px)));
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = colors[track.surface];
    for (const b of track.bridges ?? []) {
      ctx.lineWidth = b.halfWidth * 2 * px;
      ctx.beginPath();
      b.line.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * px, p.y * px) : ctx.lineTo(p.x * px, p.y * px)));
      ctx.stroke();
    }
    if (track.surface === 'ice' && track.outside === 'sea') iceMarks(ctx, track, px);
  }

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const s = surfaceAt(map, x, y);
      if (s === 'sea' && forScene) continue;
      if (track && s !== 'sand') continue;
      ctx.fillStyle =
        s === 'wall'
          ? hex(map.wallColors[0])
          : s === 'curb'
          ? (x + y) % 2 === 0 ? colors.curbA : colors.curbB
          : s === 'grass'
            ? (x + y) % 2 === 0 ? colors.grass : colors.grassAlt
            : colors[s];
      ctx.fillRect(x * px, y * px, px, px);
    }
  }

  // 결승 체크포인트 선은 풀숲까지 길게 나가므로 도로 폭만큼만 그린다.
  const f = map.checkpoints[0];
  const full = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y);
  const len = map.track ? Math.min(full, 2 * map.track.halfWidth) : full;
  const skip = (full - len) / 2 / full;
  ctx.save();
  ctx.translate((f.a.x + (f.b.x - f.a.x) * skip) * px, (f.a.y + (f.b.y - f.a.y) * skip) * px);
  ctx.rotate(Math.atan2(f.b.y - f.a.y, f.b.x - f.a.x) - Math.PI / 2);
  const cell = px / 4;
  for (let i = 0; i * cell < len * px; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? '#ffffff' : '#2b2340';
      ctx.fillRect(j * cell - cell, i * cell, cell, cell);
    }
  }
  ctx.restore();

  for (const p of map.boostPads) {
    ctx.save();
    ctx.translate((p.x + p.w / 2) * px, (p.y + p.h / 2) * px);
    ctx.rotate(p.angle);
    const w = p.w * px, h = p.h * px;
    ctx.fillStyle = '#ffc83d';
    ctx.strokeStyle = '#2b2340';
    ctx.lineWidth = px / 10;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, px / 4);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#ff7a1a';
    ctx.lineWidth = px / 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const dx of [-w / 4, w / 6]) {
      ctx.beginPath();
      ctx.moveTo(dx - px / 5, -h / 3);
      ctx.lineTo(dx + px / 4, 0);
      ctx.lineTo(dx - px / 5, h / 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const a of map.arrows ?? []) {
    ctx.save();
    ctx.translate(a.x * px, a.y * px);
    ctx.rotate(a.angle);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#2b2340';
    ctx.lineWidth = px / 10;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(1.3 * px, 0);
    ctx.lineTo(0.1 * px, -0.9 * px);
    ctx.lineTo(0.1 * px, -0.35 * px);
    ctx.lineTo(-1.3 * px, -0.35 * px);
    ctx.lineTo(-1.3 * px, 0.35 * px);
    ctx.lineTo(0.1 * px, 0.35 * px);
    ctx.lineTo(0.1 * px, 0.9 * px);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  return canvas;
}

// 빙판 위 얕은 금과 하이라이트 줄이다. 이미 칠한 곳에만 그려 바다로 삐져나가지 않는다.
function iceMarks(ctx: CanvasRenderingContext2D, track: CurvedTrack, px: number) {
  const rand = seeded(7);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.lineCap = 'round';
  const line = track.line;
  for (let i = 0; i < line.length; i += 2) {
    const a = line[i], b = line[(i + 1) % line.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const off = (rand() * 2 - 1) * track.halfWidth * 0.8;
    let x = a.x - uy * off, y = a.y + ux * off;
    if (rand() < 0.5) {
      const l = 1.5 + rand() * 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = px / 8;
      ctx.beginPath();
      ctx.moveTo(x * px, y * px);
      ctx.lineTo((x + ux * l) * px, (y + uy * l) * px);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(70, 140, 190, 0.45)';
      ctx.lineWidth = px / 18;
      ctx.beginPath();
      ctx.moveTo(x * px, y * px);
      for (let k = 0; k < 3; k++) {
        const angle = rand() * Math.PI * 2, l = 0.2 + rand() * 0.4;
        x += Math.cos(angle) * l;
        y += Math.sin(angle) * l;
        ctx.lineTo(x * px, y * px);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function buildTrack(map: MapData, renderer: THREE.WebGLRenderer): THREE.Group {
  const group = new THREE.Group();
  const sea = hasSea(map);

  if (sea) {
    const seaGeo = new THREE.PlaneGeometry(map.width, map.height);
    seaGeo.rotateX(-Math.PI / 2);
    seaGeo.translate(map.width / 2, -SEA_DEPTH, map.height / 2);
    group.add(new THREE.Mesh(seaGeo, new THREE.MeshBasicMaterial({ color: map.theme?.sea ?? SEA_COLOR })));
  }
  group.add(skirt(map, sea));

  const texture = new THREE.CanvasTexture(drawFloorCanvas(map, TEX_PX, true));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const [segX, segY] = map.hills || map.track?.lanes?.some((l) => l.cut) ? [map.width * 2, map.height * 2] : [1, 1];
  const floorGeo = new THREE.PlaneGeometry(map.width, map.height, segX, segY);
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.translate(map.width / 2, 0, map.height / 2);
  const pos = floorGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(map, pos.getX(i), pos.getZ(i)));
  group.add(new THREE.Mesh(floorGeo, new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5 })));

  if (sea) group.add(cliffs(map));
  const t = map.track;
  if (t && t.outside !== 'offroad') {
    const lines: [Vec[], boolean, number][] = [
      [t.line, true, t.halfWidth],
      ...(t.lanes ?? []).map((l): [Vec[], boolean, number] => [l.line, false, t.halfWidth]),
      ...(t.bridges ?? []).map((b): [Vec[], boolean, number] => [b.line, false, b.halfWidth]),
    ];
    for (const [line, closed, hw] of lines) {
      for (const side of [1, -1]) {
        const points = edgePoints(t, line, closed, hw, side);
        group.add(t.outside === 'sea' ? iceCliff(points) : wallStrip(map, points));
      }
    }
  }

  // 벽 타일은 InstancedMesh 하나로 그리므로 모두 같은 상자 모양이어야 한다.
  const walls: [number, number][] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) if (surfaceAt(map, x, y) === 'wall') walls.push([x, y]);
  }
  const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, WALL_HEIGHT, 1), toon(map.wallColors[0]), walls.length);
  const m = new THREE.Matrix4();
  walls.forEach(([x, y], i) => {
    m.makeTranslation(x + 0.5, WALL_HEIGHT / 2 + heightAt(map, x + 0.5, y + 0.5), y + 0.5);
    wallMesh.setMatrixAt(i, m);
  });
  group.add(wallMesh);

  for (const s of [...hairpinSigns(map), ...(map.signs ?? [])]) group.add(sign(s, heightAt(map, s.x, s.y)));
  return group;
}

interface EdgePoint {
  x: number;
  z: number;
  ox: number; // 트랙 바깥을 향하는 단위 벡터
  oz: number;
  open?: boolean; // 다른 트랙 안에 들어가 면을 세우지 않는 점
}

// 중심선 한쪽 가장자리의 점들이다. 교차로·갈래길·지름길처럼 다른 트랙 안에 들어간 점은 open이다.
function edgePoints(t: CurvedTrack, line: Vec[], closed: boolean, hw: number, side: number): EdgePoint[] {
  const n = line.length;
  return [...Array(closed ? n + 1 : n).keys()].map((i) => {
    const p = line[i % n];
    const a = closed ? line[(i - 1 + n) % n] : line[Math.max(0, i - 1)];
    const b = closed ? line[(i + 1) % n] : line[Math.min(n - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ox = (-(b.y - a.y) / len) * side, oz = ((b.x - a.x) / len) * side;
    const x = p.x + ox * hw, z = p.y + oz * hw;
    const c = nearestOnTrack(t, x, z);
    return { x, z, ox, oz, open: c.d < c.halfWidth - 0.05 };
  });
}

// 점마다 section이 돌려준 단면 꼭짓점들을 이웃 점의 같은 꼭짓점과 면으로 잇는다. open인 점에 닿는 면은 비운다.
function ribbon<P extends { open?: boolean }>(points: P[], section: (p: P, i: number) => number[][], colors?: number[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  let rows = 0;
  points.forEach((p, i) => {
    const vs = section(p, i);
    rows = vs.length;
    vs.forEach((v, j) => {
      pos.push(...v);
      if (colors) col.push(...new THREE.Color(colors[j]).toArray());
    });
  });
  const index: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i].open || points[i + 1].open) continue;
    for (let j = 0; j < rows - 1; j++) {
      const a = i * rows + j, b = a + rows;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (colors) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

function wallStrip(map: MapData, points: EdgePoint[]): THREE.Mesh {
  const geo = ribbon(points, (p) => {
    const h = heightAt(map, p.x, p.z);
    return [[p.x, WALL_HEIGHT + h, p.z], [p.x, h, p.z]];
  });
  const mat = toon(map.wallColors[0]);
  mat.side = THREE.DoubleSide;
  return new THREE.Mesh(geo, mat);
}

// 절벽 면의 위에서 아래로 내려가는 층별 깊이 비율과 색이다. 네 번째 층의 밝은 띠가 얼음 지층처럼 보이게 한다.
const ICE_LAYERS = [0, 0.18, 0.42, 0.62, 1];
const ICE_COLORS = [0xf4fbff, 0xcdeefa, 0x86c9ec, 0xc4e8f8, 0x2f73b0];
const ICE_JAG = 0.18; // 절벽 면이 안쪽으로 들어가는 최대 깊이(타일)
const SNOW_LIP = 0.07;
const FOAM_WIDTH = 0.35;

// 점마다 안쪽으로 다르게 들어간 얼음 기둥 절벽, 위쪽 눈 테두리, 해수면의 거품 띠이다. 판정 경계 밖으로는 나가지 않는다.
function iceCliff(points: EdgePoint[]): THREE.Group {
  const rand = seeded(points.length * 31 + Math.round(points[0].x * 97 + points[0].z * 13));
  const jag = points.map(() => 0.04 + rand() * (ICE_JAG - 0.04));
  const at = (p: EdgePoint, out: number, y: number) => [p.x + p.ox * out, y, p.z + p.oz * out];

  const face = ribbon(points, (p, i) => ICE_LAYERS.map((f, j) => at(p, j === 0 ? 0 : -jag[i], -0.01 - f * (SEA_DEPTH - 0.01))), ICE_COLORS);
  const faceMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient(), side: THREE.DoubleSide });

  const lip = ribbon(points, (p) => [at(p, -SNOW_LIP, 0.012), at(p, SNOW_LIP, 0.012), at(p, SNOW_LIP, -0.09)]);
  const lipMat = toon(0xffffff);
  lipMat.side = THREE.DoubleSide;

  const foam = ribbon(points, (p, i) => [at(p, -jag[i], -SEA_DEPTH + 0.015), at(p, FOAM_WIDTH, -SEA_DEPTH + 0.015)]);
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });

  const g = new THREE.Group();
  g.add(new THREE.Mesh(face, faceMat), new THREE.Mesh(lip, lipMat), new THREE.Mesh(foam, foamMat));
  return g;
}

const SKIRT_DEPTH = 2.5;
const SKIRT_STEP = 0.5;
const SKIRT_LIP = 0.25; // 단면 맨 위에 땅 색을 그대로 두는 띠의 높이(타일)

function skirt(map: MapData, sea: boolean): THREE.Mesh {
  const { width: w, height: h } = map;
  const corners = [[0, 0], [w, 0], [w, h], [0, h], [0, 0]];
  const points: { x: number; z: number; open?: boolean }[] = [];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i], [bx, bz] = corners[i + 1];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / SKIRT_STEP);
    for (let k = 0; k < n; k++) points.push({ x: ax + ((bx - ax) * k) / n, z: az + ((bz - az) * k) / n });
  }
  points.push({ x: 0, z: 0 });

  const base = new THREE.Color(sea ? map.theme?.sea ?? SEA_COLOR : map.theme?.ground ?? GROUND_COLOR);
  const shade = (f: number) => base.clone().multiplyScalar(f).getHex();
  const geo = sea
    ? ribbon(points, (p) => [[p.x, -SEA_DEPTH, p.z], [p.x, -SKIRT_DEPTH, p.z]], [base.getHex(), shade(0.45)])
    : ribbon(points, (p) => {
        const top = heightAt(map, p.x, p.z);
        return [[p.x, top, p.z], [p.x, top - SKIRT_LIP, p.z], [p.x, top - SKIRT_LIP, p.z], [p.x, -SKIRT_DEPTH, p.z]];
      }, [base.getHex(), base.getHex(), shade(0.6), shade(0.35)]);
  return new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient(), side: THREE.DoubleSide }));
}

function cliffs(map: MapData): THREE.InstancedMesh {
  const tiles: [number, number][] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (surfaceAt(map, x, y) === 'sea') continue;
      if (map.track && surfaceAt(map, x, y) === map.track.surface) continue;
      const nearSea = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => map.tiles[y + dy]?.[x + dx] === '~');
      if (nearSea) tiles.push([x, y]);
    }
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, SEA_DEPTH, 1), toon(CLIFF_COLOR), tiles.length);
  const m = new THREE.Matrix4();
  tiles.forEach(([x, y], i) => {
    m.makeTranslation(x + 0.5, -SEA_DEPTH / 2 - 0.01, y + 0.5);
    mesh.setMatrixAt(i, m);
  });
  return mesh;
}

const HAIRPIN_TURN = (150 * Math.PI) / 180;
const HAIRPIN_LEN = 14;

// 중심선이 HAIRPIN_LEN 안에서 HAIRPIN_TURN 넘게 꺾이기 시작하는 곳마다, 다가오는 방향 정면의 트랙 가장자리 바로 바깥에 표지판을 세운다.
function hairpinSigns(map: MapData): WallSign[] {
  const t = map.track;
  if (!t) return [];
  const line = t.line, n = line.length;
  const heading = (i: number) => {
    const a = line[i % n], b = line[(i + 1) % n];
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  const signs: WallSign[] = [];
  for (let i = 0; i < n; i++) {
    let turn = 0, len = 0, j = i;
    while (len < HAIRPIN_LEN && Math.abs(turn) < HAIRPIN_TURN) {
      turn += wrap(heading(j + 1) - heading(j));
      len += Math.hypot(line[(j + 1) % n].x - line[j % n].x, line[(j + 1) % n].y - line[j % n].y);
      j++;
    }
    if (Math.abs(turn) < HAIRPIN_TURN) continue;
    const d = heading(i), fx = Math.cos(d), fy = Math.sin(d), p = line[i];
    for (let s = t.halfWidth; s < t.halfWidth + 8; s += 0.25) {
      const c = nearestOnTrack(t, p.x + fx * s, p.y + fy * s);
      if (c.d <= c.halfWidth) continue;
      signs.push({ x: p.x + fx * (s + 0.4), y: p.y + fy * (s + 0.4), dir: d, arrow: turn > 0 ? 'right' : 'left' });
      break;
    }
    i = j;
  }
  return signs;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const signTextures = new Map<WallSign['arrow'], THREE.CanvasTexture>();

function signTexture(arrow: WallSign['arrow']): THREE.CanvasTexture {
  const cached = signTextures.get(arrow);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = hex(OUTLINE);
  ctx.fillRect(0, 0, 128, 64);
  ctx.strokeStyle = '#ffc83d';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.translate(64, 32);
  if (arrow === 'left') ctx.scale(-1, 1);
  if (arrow === 'straight') {
    ctx.beginPath();
    ctx.moveTo(0, 20);
    ctx.lineTo(0, -18);
    ctx.moveTo(-16, -4);
    ctx.lineTo(0, -20);
    ctx.lineTo(16, -4);
    ctx.stroke();
  } else {
    for (const x of [-30, 0, 30]) {
      ctx.beginPath();
      ctx.moveTo(x - 9, -18);
      ctx.lineTo(x + 9, 0);
      ctx.lineTo(x - 9, 18);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  signTextures.set(arrow, texture);
  return texture;
}

function sign(s: WallSign, ground: number): THREE.Group {
  const g = new THREE.Group();
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.8),
    new THREE.MeshBasicMaterial({ map: signTexture(s.arrow), side: THREE.DoubleSide }),
  );
  board.position.y = WALL_HEIGHT + 0.45;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, WALL_HEIGHT + 0.05, 8), toon(OUTLINE));
  pole.position.y = (WALL_HEIGHT + 0.05) / 2;
  g.add(board, pole);
  g.position.set(s.x, ground, s.y);
  g.rotation.y = Math.atan2(-Math.cos(s.dir), -Math.sin(s.dir));
  return g;
}

// 뒷면만 그리는 약간 큰 복제본으로 굵은 윤곽선을 만든다.
function withOutline(mesh: THREE.Mesh, thickness = 0.04): THREE.Group {
  const g = new THREE.Group();
  const outline = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide }));
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  outline.scale.set(1 + (2 * thickness) / size.x, 1 + (2 * thickness) / size.y, 1 + (2 * thickness) / size.z);
  outline.position.copy(mesh.position);
  outline.rotation.copy(mesh.rotation);
  g.add(mesh, outline);
  return g;
}

export class KartModel {
  readonly root = new THREE.Group(); // 위치와 방향
  readonly body = new THREE.Group(); // 1인칭에서 숨기는 차체
  private flame: THREE.Mesh;
  private sparks: THREE.Mesh[] = [];
  private sparkMat = new THREE.MeshBasicMaterial({ color: 0x6fd6ff });
  private ghost = false;
  private lastSpeed = 0;
  private squash = 0;

  // layer는 카트마다 다른 번호이며, 같은 모형끼리 겹칠 때 면이 같은 평면에 놓여 깜빡이지 않도록 높이를 아주 조금씩 다르게 둔다.
  constructor(color: number, label: string | undefined, private layer: number) {
    // 모형은 +x 방향을 앞으로 만든다.
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.56), toon(color));
    chassis.position.y = 0.2;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.4), toon(color));
    nose.position.set(0.5, 0.16, 0);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.34), toon(0xffffff));
    seat.position.set(-0.22, 0.38, 0);
    const wheel = new THREE.CylinderGeometry(0.15, 0.15, 0.14, 16);
    wheel.rotateX(Math.PI / 2);
    for (const [x, z] of [[0.3, 0.32], [0.3, -0.32], [-0.3, 0.32], [-0.3, -0.32]]) {
      const w = new THREE.Mesh(wheel, toon(0x3a3350));
      w.position.set(x, 0.15, z);
      this.body.add(withOutline(w, 0.025));
    }
    this.body.add(withOutline(chassis), withOutline(nose, 0.03), withOutline(seat, 0.03));

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    shadow.material.userData.opacity = 0.22; // 고스트 상태에서 돌아올 때 쓰는 원래 투명도
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(1.1, 0.75, 1);
    shadow.position.y = 0.01;
    this.body.add(shadow);

    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 12), new THREE.MeshBasicMaterial({ color: 0xffb02e }));
    this.flame.rotation.z = Math.PI / 2;
    this.flame.position.set(-0.65, 0.22, 0);
    this.root.add(this.flame);

    for (const z of [0.32, -0.32]) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), this.sparkMat);
      s.position.set(-0.42, 0.12, z);
      this.sparks.push(s);
      this.root.add(s);
    }
    this.root.add(this.body);
    if (label) this.root.add(nameLabel(label));
  }

  // 반환값이 true이면 이번 갱신에서 부딪혔다고 본다. 효과음 판단에 쓴다.
  update(k: ViewKart, time: number, dtSec: number, map: MapData): boolean {
    const drop = fallDrop(map, k);
    const nose = drop > 0 ? -Math.min(FALL_NOSE_MAX, (FALL_SEC - k.fallLeft) * FALL_NOSE_RATE) : 0;
    const fx = Math.cos(k.angle) / 2, fy = Math.sin(k.angle) / 2;
    const pitch = Math.atan(heightAt(map, k.x + fx, k.y + fy) - heightAt(map, k.x - fx, k.y - fy));
    this.root.position.set(k.x, heightAt(map, k.x, k.y) + this.layer * LAYER_GAP - drop, k.y);
    this.root.rotation.set(0, -k.angle, pitch + nose, 'YZX');
    const blink = (sec: number) => Math.floor(sec / SPAWN_BLINK_SEC) % 2 === 0;
    // 땅 위 리스폰은 가라앉지 않고 깜빡이며 사라진다.
    this.root.visible = (k.spawnLeft === 0 || blink(k.spawnLeft)) && (k.fallLeft === 0 || drop > 0 || blink(k.fallLeft));

    if (k.ghost !== this.ghost) {
      this.ghost = k.ghost;
      this.root.traverse((o) => {
        if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.Sprite)) return;
        const m = o.material as THREE.Material;
        // 윤곽선은 차체 뒤에 있는 뒷면이라, 차체가 반투명하면 비쳐 보여 차 전체가 검게 보인다.
        if (m.side === THREE.BackSide) {
          o.visible = !k.ghost;
          return;
        }
        m.userData.depthWrite ??= m.depthWrite;
        m.transparent = true;
        m.opacity = k.ghost ? 0.35 : m.userData.opacity ?? 1;
        // 반투명한 고스트가 깊이를 기록하면 겹친 카트가 프레임마다 가려졌다 보였다 하므로, 기록하지 않고 나중에 그린다.
        m.depthWrite = k.ghost ? false : m.userData.depthWrite;
        o.renderOrder = k.ghost ? 1 : 0;
      });
    }

    // 속력이 갑자기 떨어지면 부딪힌 것으로 보고 차체를 잠깐 찌그러뜨린다. 그리기에만 적용한다.
    const hit = k.fallLeft === 0 && this.lastSpeed - k.speed > BUMP_SPEED_DROP;
    // 바다 낙하 중에는 속력이 남아 있다가 리스폰에서 0이 되므로, 낙하 중 속력은 비교에 쓰지 않는다.
    this.lastSpeed = k.fallLeft > 0 ? 0 : k.speed;
    if (hit) this.squash = 1;
    this.squash = Math.max(0, this.squash - dtSec * 5);
    const s = Math.sin(this.squash * Math.PI) * 0.22;
    this.body.scale.set(1 + s, 1 - s, 1 + s);

    this.flame.visible = k.boostLeft > 0;
    if (this.flame.visible) this.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);

    // 드리프트를 끝내면 작은 부스트를 얻는 상태가 되면 불꽃 색이 바뀌고 커진다.
    const ready = k.driftSlip >= DRIFT_END_MIN_SEC;
    this.sparkMat.color.set(ready ? 0xff8a1f : 0x6fd6ff);
    for (const s of this.sparks) {
      s.visible = k.drifting;
      s.rotation.y = time * 12;
      s.scale.setScalar(ready ? 1.4 : 1);
    }
    return hit;
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.Sprite)) return;
      o.geometry.dispose();
      const m = o.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
    });
  }
}

function nameLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#2b2340';
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = 1;
  return sprite;
}
