import * as THREE from 'three';
import { DRIFT_CHARGE_SEC, surfaceAt, type KartState, type MapData } from '@dashrush/shared';

// 물리 좌표 (x, y)는 장면의 (x, 0, y)이고 1 단위가 1 타일이다.
// 캐주얼 카툰 톤의 임시 모형이며 4단계에서 에셋으로 교체한다.

const OUTLINE = 0x2b2340;
const TEX_PX = 32; // 바닥 텍스처의 타일당 픽셀 수
const WALL_HEIGHT = 0.7;

const FLOOR_COLORS = {
  asphalt: '#6b6f82',
  grass: '#7fd35b',
  grassAlt: '#74c851',
  sand: '#f3d37c',
  ice: '#c4ecff',
  wall: '#9a6a45',
  curbA: '#ff5b5b',
  curbB: '#ffffff',
};

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

export function drawFloorCanvas(map: MapData, px: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.width * px;
  canvas.height = map.height * px;
  const ctx = canvas.getContext('2d')!;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const s = surfaceAt(map, x, y);
      ctx.fillStyle =
        s === 'curb'
          ? (x + y) % 2 === 0 ? FLOOR_COLORS.curbA : FLOOR_COLORS.curbB
          : s === 'grass'
            ? (x + y) % 2 === 0 ? FLOOR_COLORS.grass : FLOOR_COLORS.grassAlt
            : FLOOR_COLORS[s];
      ctx.fillRect(x * px, y * px, px, px);
    }
  }

  // 결승선 체커
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
  return canvas;
}

export function buildTrack(map: MapData, renderer: THREE.WebGLRenderer): THREE.Group {
  const group = new THREE.Group();

  // 맵 바깥이 허공으로 보이지 않도록 넓은 잔디를 깐다.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x74c851 }));
  ground.rotation.x = -Math.PI / 2;
  ground.scale.set(map.width * 6, map.height * 6, 1);
  ground.position.set(map.width / 2, -0.02, map.height / 2);
  group.add(ground);

  const texture = new THREE.CanvasTexture(drawFloorCanvas(map, TEX_PX));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(map.width, map.height),
    new THREE.MeshBasicMaterial({ map: texture }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(map.width / 2, 0, map.height / 2);
  group.add(floor);

  // 벽 타일은 같은 상자를 인스턴스 하나로 묶어 그리기 호출을 한 번으로 줄인다.
  const walls: [number, number][] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) if (surfaceAt(map, x, y) === 'wall') walls.push([x, y]);
  }
  const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, WALL_HEIGHT, 1), toon(0xc98b5a), walls.length);
  const m = new THREE.Matrix4();
  walls.forEach(([x, y], i) => {
    m.makeTranslation(x + 0.5, WALL_HEIGHT / 2, y + 0.5);
    wallMesh.setMatrixAt(i, m);
  });
  group.add(wallMesh);

  return group;
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

  constructor(color: number) {
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
  }

  update(k: KartState, x: number, y: number, angle: number, time: number) {
    this.root.position.set(x, 0, y);
    this.root.rotation.y = -angle;

    this.flame.visible = k.boostLeft > 0;
    if (this.flame.visible) this.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);

    // 드리프트 게이지 단계: 충전 중은 파랑, 부스트 준비는 주황
    const ready = k.driftCharge >= DRIFT_CHARGE_SEC;
    this.sparkMat.color.set(ready ? 0xff8a1f : 0x6fd6ff);
    for (const s of this.sparks) {
      s.visible = k.drifting;
      s.rotation.y = time * 12;
      s.scale.setScalar(ready ? 1.4 : 1);
    }
  }
}
