import * as THREE from 'three';
import { DRIFT_END_MIN_SEC, FALL_SEC, nearestOnTrack, surfaceAt, VERGE_WIDTH, type CurvedTrack, type MapData, type Vec, type WallSign } from '@dashrush/shared';

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

const OUTLINE = 0x2b2340;
const TEX_PX = 32; // 바닥 텍스처의 타일당 픽셀 수
const WALL_HEIGHT = 0.7;
const SEA_DEPTH = 1.2;
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

// clearSea이면 바다 타일을 투명하게 남겨, 아래에 까는 바다 평면이 보이게 한다.
export function drawFloorCanvas(map: MapData, px: number, clearSea = false): HTMLCanvasElement {
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
    } else if (!clearSea) {
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
  }

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const s = surfaceAt(map, x, y);
      if (s === 'sea' && clearSea) continue;
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

  const f = map.checkpoints[0];
  const len = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y);
  ctx.save();
  ctx.translate(f.a.x * px, f.a.y * px);
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

export function buildTrack(map: MapData, renderer: THREE.WebGLRenderer): THREE.Group {
  const group = new THREE.Group();
  const sea = hasSea(map);

  // 맵 바깥이 허공으로 보이지 않도록 넓은 땅을 깐다. 바다 맵은 절벽 아래 바다를 깐다.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: sea ? map.theme?.sea ?? SEA_COLOR : map.theme?.ground ?? GROUND_COLOR }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.scale.set(map.width * 6, map.height * 6, 1);
  ground.position.set(map.width / 2, sea ? -SEA_DEPTH : -0.02, map.height / 2);
  group.add(ground);

  const texture = new THREE.CanvasTexture(drawFloorCanvas(map, TEX_PX, sea));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(map.width, map.height),
    new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(map.width / 2, 0, map.height / 2);
  group.add(floor);

  if (sea) group.add(cliffs(map));
  const t = map.track;
  if (t && t.outside !== 'offroad') {
    const [top, bottom, color] = t.outside === 'sea' ? [-0.01, -SEA_DEPTH, CLIFF_COLOR] : [WALL_HEIGHT, 0, map.wallColors[0]];
    const lines: [Vec[], boolean, number][] = [
      [t.line, true, t.halfWidth],
      ...(t.lanes ?? []).map((l): [Vec[], boolean, number] => [l.line, false, t.halfWidth]),
      ...(t.bridges ?? []).map((b): [Vec[], boolean, number] => [b.line, false, b.halfWidth]),
    ];
    for (const [line, closed, hw] of lines) for (const side of [1, -1]) group.add(edgeStrip(t, line, closed, hw, side, top, bottom, color));
  }

  // 벽 타일은 InstancedMesh 하나로 그리므로 모두 같은 상자 모양이어야 한다.
  const walls: [number, number][] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) if (surfaceAt(map, x, y) === 'wall') walls.push([x, y]);
  }
  const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, WALL_HEIGHT, 1), toon(map.wallColors[0]), walls.length);
  const m = new THREE.Matrix4();
  walls.forEach(([x, y], i) => {
    m.makeTranslation(x + 0.5, WALL_HEIGHT / 2, y + 0.5);
    wallMesh.setMatrixAt(i, m);
  });
  group.add(wallMesh);

  for (const s of [...hairpinSigns(map), ...(map.signs ?? [])]) group.add(sign(s));
  for (const d of map.decor) group.add(d.type === 'cone' ? cone(d.x, d.y) : tires(d.x, d.y));
  return group;
}

// 중심선 한쪽 가장자리를 따라 세운 벽(또는 절벽) 면이다. 교차로·갈래길·지름길처럼 다른 트랙 안에 들어간 구간은 뺀다.
function edgeStrip(t: CurvedTrack, line: Vec[], closed: boolean, hw: number, side: number, top: number, bottom: number, color: number): THREE.Mesh {
  const n = line.length;
  const segs = closed ? n : n - 1;
  const pos: number[] = [];
  const open: boolean[] = [];
  for (let i = 0; i <= segs; i++) {
    const p = line[i % n];
    const a = closed ? line[(i - 1 + n) % n] : line[Math.max(0, i - 1)];
    const b = closed ? line[(i + 1) % n] : line[Math.min(n - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const x = p.x - ((b.y - a.y) / len) * hw * side;
    const z = p.y + ((b.x - a.x) / len) * hw * side;
    pos.push(x, top, z, x, bottom, z);
    const c = nearestOnTrack(t, x, z);
    open.push(c.d < c.halfWidth - 0.05);
  }
  const index: number[] = [];
  for (let i = 0; i < segs; i++) {
    if (open[i] || open[i + 1]) continue;
    index.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mat = toon(color);
  mat.side = THREE.DoubleSide;
  return new THREE.Mesh(geo, mat);
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

function sign(s: WallSign): THREE.Group {
  const g = new THREE.Group();
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.8),
    new THREE.MeshBasicMaterial({ map: signTexture(s.arrow), side: THREE.DoubleSide }),
  );
  board.position.y = WALL_HEIGHT + 0.45;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, WALL_HEIGHT + 0.05, 8), toon(OUTLINE));
  pole.position.y = (WALL_HEIGHT + 0.05) / 2;
  g.add(board, pole);
  g.position.set(s.x, 0, s.y);
  g.rotation.y = Math.atan2(-Math.cos(s.dir), -Math.sin(s.dir));
  return g;
}

function cone(x: number, y: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 12), toon(0xff7a1a));
  body.position.y = 0.25;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.08, 12), toon(0xffffff));
  band.position.y = 0.26;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), toon(0xff7a1a));
  base.position.y = 0.02;
  g.add(body, band, base);
  g.position.set(x, 0, y);
  return g;
}

function tires(x: number, y: number): THREE.Group {
  const g = new THREE.Group();
  const geometry = new THREE.TorusGeometry(0.24, 0.1, 8, 16);
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(geometry, toon(i === 1 ? 0xffffff : 0x2b2340));
    t.rotation.x = Math.PI / 2;
    t.position.y = 0.1 + i * 0.19;
    g.add(t);
  }
  g.position.set(x, 0, y);
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
  update(k: ViewKart, time: number, dtSec: number): boolean {
    const sink = k.fallLeft > 0 ? 1 - k.fallLeft / FALL_SEC : 0;
    this.root.position.set(k.x, this.layer * LAYER_GAP - sink * SEA_DEPTH, k.y);
    this.root.rotation.y = -k.angle;
    this.root.visible = k.spawnLeft === 0 || Math.floor(k.spawnLeft / SPAWN_BLINK_SEC) % 2 === 0;

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
    this.lastSpeed = k.speed;
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
