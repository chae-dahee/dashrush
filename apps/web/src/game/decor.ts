import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt, surfaceAtPoint, type Decor, type DecorType, type MapData } from '@dashrush/shared';
import { OUTLINE, SEA_DEPTH, toon } from './scene.ts';

// 장식 모형은 앞면이 +z이고 바닥 중심이 원점이다. 맵 데이터의 angle은 앞면이 바라보는 맵 방향이다.
// 같은 종류·변형은 묶음별로 지오메트리를 합친 InstancedMesh 하나로 그린다.

type V3 = [number, number, number];

interface Anim {
  kind: 'sway' | 'wave' | 'bob' | 'pulse' | 'puff';
  amp: number;
  speed: number;
  off?: number; // puff 주기 안의 시작 위치(0~1)
}

interface Part {
  geo: THREE.BufferGeometry;
  line: THREE.BufferGeometry | null;
  color: number;
  glow: boolean;
}

interface Channel {
  pivot: THREE.Vector3;
  anim?: Anim;
  parts: Part[];
}

interface PartOpts {
  r?: V3;
  s?: number | V3;
  glow?: boolean; // 조명 영향 없이 밝게 그려 발광처럼 보이게 한다.
  line?: number; // 윤곽선 두께이며 0이면 그리지 않는다.
}

const LINE = 0.035;
const W = 0xffffff;
const INK = OUTLINE;
const LIGHT = 0xfff1a8;
const PI = Math.PI;

class Model {
  readonly channels: Channel[] = [{ pivot: new THREE.Vector3(), parts: [] }];
  private ch = this.channels[0];

  // 이후 부품은 pivot을 기준으로 anim에 따라 함께 움직인다.
  move(anim: Anim, x = 0, y = 0, z = 0) {
    this.ch = { pivot: new THREE.Vector3(x, y, z), anim, parts: [] };
    this.channels.push(this.ch);
  }

  still() {
    this.ch = this.channels[0];
  }

  add(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, o: PartOpts = {}) {
    const s: V3 = typeof o.s === 'number' ? [o.s, o.s, o.s] : o.s ?? [1, 1, 1];
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z).sub(this.ch.pivot),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.r ?? [0, 0, 0]))),
      new THREE.Vector3(...s),
    );
    const t = o.line ?? LINE;
    let line: THREE.BufferGeometry | null = null;
    if (t > 0) {
      // 부품 중심에서 축마다 두께만큼 키운 뒷면 복제본이 윤곽선이 된다.
      geo.computeBoundingBox();
      const c = geo.boundingBox!.getCenter(new THREE.Vector3());
      const size = geo.boundingBox!.getSize(new THREE.Vector3());
      const k = (i: 0 | 1 | 2) => 1 + (2 * t) / Math.max(size.getComponent(i) * s[i], 0.02);
      line = geo.clone().translate(-c.x, -c.y, -c.z).scale(k(0), k(1), k(2)).translate(c.x, c.y, c.z).applyMatrix4(m);
    }
    this.ch.parts.push({ geo: geo.clone().applyMatrix4(m), line, color, glow: !!o.glow });
  }
}

// 둥근 모서리 상자
function B(w: number, h: number, d: number, r = Math.min(w, h, d) * 0.2): THREE.BufferGeometry {
  const b = Math.min(r, w / 2, h / 2, d / 2) * 0.5;
  const sw = w - 2 * b, sh = h - 2 * b;
  const rr = Math.min(r - b, sw / 2, sh / 2);
  const s = new THREE.Shape();
  const x0 = -sw / 2, y0 = -sh / 2;
  s.moveTo(x0 + rr, y0);
  s.lineTo(x0 + sw - rr, y0);
  s.quadraticCurveTo(x0 + sw, y0, x0 + sw, y0 + rr);
  s.lineTo(x0 + sw, y0 + sh - rr);
  s.quadraticCurveTo(x0 + sw, y0 + sh, x0 + sw - rr, y0 + sh);
  s.lineTo(x0 + rr, y0 + sh);
  s.quadraticCurveTo(x0, y0 + sh, x0, y0 + sh - rr);
  s.lineTo(x0, y0 + rr);
  s.quadraticCurveTo(x0, y0, x0 + rr, y0);
  const depth = Math.max(d - 2 * b, 0.001);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 3 });
  return g.translate(0, 0, -depth / 2);
}
const C = (rt: number, rb: number, h: number, seg = 20) => new THREE.CylinderGeometry(rt, rb, h, seg);
const S = (r: number, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h);
const K = (r: number, h: number, seg = 20) => new THREE.ConeGeometry(r, h, seg);
const I = (r: number, detail = 2) => new THREE.IcosahedronGeometry(r, detail);
const O = (r: number) => new THREE.OctahedronGeometry(r);
const R = (radius: number, tube: number, arc = 2 * PI) => new THREE.TorusGeometry(radius, tube, 12, 32, arc);
// 바닥부터 위로 [반지름, 높이]를 이어 돌린 회전체
const L = (pts: number[][], seg = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const T = (pts: V3[], r: number, seg = 20) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, 10);

// 깃대에서 +x로 뻗은 천이며, 바람에 휜 모양을 미리 준다.
function cloth(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, 0.05, 10, 1, 1).translate(w / 2, 0, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + 0.1 * Math.sin((p.getX(i) / w) * PI * 1.6));
  g.computeVertexNormals();
  return g;
}

// 기울인 결정 기둥과 그 끝의 뾰족한 머리
function crystal(m: Model, r: number, h: number, color: number, x: number, y: number, z: number, tilt: number) {
  m.add(C(r * 0.8, r, h, 6), color, x, y, z, { r: [0, 0, tilt] });
  const l = h / 2 + r * 0.6;
  m.add(K(r * 0.8, r * 1.2, 6), color, x - Math.sin(tilt) * l, y + Math.cos(tilt) * l, z, { r: [0, 0, tilt] });
}

function flag(m: Model, x: number, top: number, z: number, color: number, pole = W) {
  m.add(C(0.045, 0.06, top, 10), pole, x, top / 2, z);
  m.add(S(0.1, 12, 8), 0xffc83d, x, top + 0.05, z);
  m.move({ kind: 'wave', amp: 0.35, speed: 2.6 }, x, top - 0.3, z);
  m.add(cloth(1.1, 0.7), color, x + 0.04, top - 0.3, z);
  m.still();
}

function bulbs(m: Model, pts: V3[], colors: number[], r = 0.09) {
  pts.forEach(([x, y, z], i) => m.add(S(r, 12, 8), colors[i % colors.length], x, y, z, { glow: true, line: 0.02 }));
}

function foam(m: Model, r: number) {
  m.move({ kind: 'pulse', amp: 0.05, speed: 1.6 });
  m.add(R(r, 0.12), W, 0, 0.05, 0, { r: [PI / 2, 0, 0], line: 0 });
  m.still();
}

const CROWD = [0xff5b5b, 0xffc83d, 0x3d7bff, 0x2ec4b6, 0xff9ecf, W];

function build(type: DecorType, v: number): Model {
  const m = new Model();
  switch (type) {
    case 'cone':
      m.add(B(0.6, 0.08, 0.6, 0.08), 0xff7a1a, 0, 0.04, 0);
      m.add(L([[0, 0.08], [0.26, 0.08], [0.2, 0.3], [0.12, 0.55], [0.05, 0.8], [0, 0.82]]), 0xff7a1a);
      m.add(C(0.15, 0.175, 0.12), W, 0, 0.42, 0, { line: 0 });
      break;
    case 'tires': {
      const tire = R(0.36, 0.17);
      for (let i = 0; i < 3; i++) m.add(tire, i === 1 ? (v % 2 ? W : 0xff5b5b) : 0x3a3350, 0, 0.17 + i * 0.32, 0, { r: [PI / 2, 0, 0] });
      m.add(C(0.22, 0.22, 0.86, 16), INK, 0, 0.45, 0, { line: 0 });
      break;
    }
    case 'grandstand': {
      const [seat, trim] = v % 2 ? [0xff5b5b, W] : [0x3d7bff, 0xffc83d];
      for (let i = 0; i < 4; i++) {
        const h = 0.5 + (i + 1) * 0.45;
        m.add(B(3.6, h, 0.62, 0.1), i % 2 ? trim : seat, 0, h / 2, 0.9 - i * 0.6);
      }
      for (const x of [-1.75, 1.75]) for (const z of [-1.05, 1.05]) m.add(C(0.06, 0.06, 3.3, 10), W, x, 1.65, z);
      m.add(B(4.0, 0.16, 2.7, 0.08), trim, 0, 3.35, 0, { r: [0.08, 0, 0] });
      for (let i = 0; i < 8; i++) m.add(S(0.25, 14, 8), i % 2 ? W : seat, -1.75 + i * 0.5, 3.2, 1.38, { s: [1, 0.6, 0.4] });
      flag(m, 0, 4.4, -0.6, seat);
      m.move({ kind: 'bob', amp: 0.06, speed: 7 });
      for (let i = 0; i < 4; i++) {
        const y = 0.5 + (i + 1) * 0.45, z = 0.85 - i * 0.6;
        for (let j = 0; j < 6; j++) {
          const x = -1.45 + j * 0.58 + (i % 2) * 0.15;
          m.add(B(0.3, 0.28, 0.22, 0.08), CROWD[(i * 2 + j) % CROWD.length], x, y + 0.14, z, { line: 0.02 });
          m.add(S(0.14, 12, 8), 0xffd2a6, x, y + 0.42, z, { line: 0.02 });
        }
      }
      break;
    }
    case 'pit':
      m.add(B(3.4, 2.0, 2.6, 0.14), W, 0, 1.0, 0);
      for (const x of [-1.08, 0, 1.08]) {
        m.add(B(0.92, 1.4, 0.1, 0.05), 0x6b6f82, x, 0.72, 1.3);
        for (let k = 0; k < 4; k++) m.add(B(0.86, 0.05, 0.12, 0.02), 0x9aa0b8, x, 0.25 + k * 0.32, 1.34, { line: 0 });
      }
      m.add(B(3.4, 0.22, 0.14, 0.05), 0xffc83d, 0, 1.68, 1.32, { line: 0 });
      m.add(B(3.75, 0.28, 2.9, 0.12), 0xff5b5b, 0, 2.12, 0);
      m.add(B(2.2, 0.7, 0.18, 0.1), INK, 0, 2.7, 0.6);
      for (let i = 0; i < 8; i++) m.add(B(0.24, 0.24, 0.2, 0.03), i % 2 ? W : 0xffc83d, -0.84 + i * 0.24, 2.7, 0.62, { line: 0 });
      flag(m, 1.4, 3.6, -0.9, 0x3d7bff);
      m.move({ kind: 'pulse', amp: 0.18, speed: 4 }, 0, 1.92, 1.42);
      bulbs(m, [-1.4, -0.7, 0, 0.7, 1.4].map((x): V3 => [x, 1.92, 1.42]), [LIGHT]);
      break;
    case 'lightTower':
      m.add(L([[0, 0], [0.45, 0], [0.45, 0.25], [0.22, 0.4], [0, 0.4]]), 0x8a96a8);
      m.add(C(0.1, 0.16, 5.6, 14), 0xd9d4e6, 0, 3.0, 0);
      for (const y of [1.5, 3, 4.5]) m.add(R(0.18, 0.05), 0xff5b5b, 0, y, 0, { r: [PI / 2, 0, 0], line: 0 });
      m.add(B(1.8, 1.1, 0.3, 0.1), 0x3a3350, 0, 6.0, 0.1, { r: [0.25, 0, 0] });
      m.move({ kind: 'pulse', amp: 0.08, speed: 2.5 }, 0, 6.0, 0.3);
      for (const y of [5.75, 6.2]) bulbs(m, [-0.6, 0, 0.6].map((x): V3 => [x, y, 0.32 - (y - 6) * 0.25]), [0xfff6c2], 0.2);
      break;
    case 'billboard': {
      const [a, b] = [[0xffc83d, 0xff5b5b], [0x3d7bff, W], [0x2ec4b6, 0xffc83d]][v % 3];
      for (const x of [-0.75, 0.75]) m.add(C(0.07, 0.09, 1.35, 10), 0x8a96a8, x, 0.67, 0);
      m.add(B(2.4, 1.3, 0.2, 0.16), a, 0, 1.95, 0);
      m.add(B(2.1, 0.3, 0.22, 0.08), b, 0, 1.55, 0.01, { line: 0 });
      m.add(C(0.36, 0.36, 0.24, 24), b, -0.65, 2.1, 0.02, { r: [PI / 2, 0, 0], line: 0.025 });
      m.add(B(0.95, 0.18, 0.23, 0.06), W, 0.35, 2.25, 0.02, { line: 0 });
      m.add(B(0.65, 0.14, 0.23, 0.05), W, 0.2, 1.98, 0.02, { line: 0 });
      m.move({ kind: 'pulse', amp: 0.25, speed: 5 }, 0, 2.7, 0);
      bulbs(m, [-1, -0.6, -0.2, 0.2, 0.6, 1].map((x): V3 => [x, 2.7, 0]), [LIGHT, 0xff9ecf], 0.08);
      break;
    }
    case 'flag':
      flag(m, 0, 3.0, 0, [0xff5b5b, 0xffc83d, 0x3d7bff, 0x2ec4b6, 0xff9ecf][v % 5]);
      break;
    case 'balloons':
      m.add(L([[0, 0], [0.2, 0], [0.2, 0.18], [0.12, 0.25], [0, 0.25]]), 0x8a96a8);
      m.move({ kind: 'sway', amp: 0.08, speed: 1.4 }, 0, 0.25, 0);
      for (const [x, y, z, c] of [[-0.4, 2.6, 0.1, 0xff5b5b], [0.35, 2.9, -0.1, 0xffc83d], [0.05, 2.35, 0.4, 0x3d7bff], [0.1, 3.2, 0.2, 0xff9ecf]]) {
        m.add(T([[0, 0.25, 0], [x * 0.4, 1.3, z * 0.4], [x, y - 0.42, z]], 0.015, 12), W, 0, 0, 0, { line: 0 });
        m.add(S(0.34), c, x, y, z, { s: [1, 1.2, 1] });
        m.add(K(0.07, 0.12, 10), c, x, y - 0.42, z, { r: [PI, 0, 0], line: 0 });
      }
      break;
    case 'shop': {
      const [body, awning, accent] = [
        [0xffd166, 0xe4572e, 0x3d7bff],
        [0x7bdff2, 0xff5b9e, 0xffc83d],
        [0xb8f28b, 0x3d7bff, 0xff7a1a],
        [0xffa6c9, 0x2ec4b6, 0x6b4bd6],
      ][v % 4];
      const floors = 2 + (v % 2), fh = 1.25, H = floors * fh;
      m.add(B(3, H, 2.6, 0.14), body, 0, H / 2, 0);
      m.add(B(3.25, 0.3, 2.85, 0.12), accent, 0, H + 0.12, 0);
      m.add(B(1.7, 0.75, 0.08, 0.08), LIGHT, -0.45, 0.62, 1.3, { glow: true });
      m.add(B(0.6, 1.0, 0.08, 0.08), 0x6b4b3a, 0.95, 0.5, 1.3);
      for (let f = 1; f < floors; f++) {
        for (const x of [-0.95, 0, 0.95]) {
          m.add(B(0.55, 0.62, 0.08, 0.1), LIGHT, x, f * fh + 0.6, 1.3, { glow: true });
          m.add(B(0.7, 0.08, 0.2, 0.03), W, x, f * fh + 0.25, 1.35, { line: 0 });
        }
      }
      // 줄무늬 차양은 1/4 원기둥 조각을 번갈아 칠해 만든다.
      const sw = 3 / 6;
      for (let i = 0; i < 6; i++) {
        const x = -1.5 + sw * (i + 0.5);
        m.add(new THREE.CylinderGeometry(0.55, 0.55, sw, 16, 1, false, 0, PI / 2), i % 2 ? W : awning, x, 1.05, 1.3, { r: [0, 0, PI / 2], line: 0.02 });
        m.add(S(0.15, 12, 8), i % 2 ? awning : W, x, 1.03, 1.85, { s: [1.6, 0.8, 0.5], line: 0.02 });
      }
      m.add(B(1.9, 0.55, 0.16, 0.12), accent, 0, H + 0.7, 0.9);
      m.add(C(0.18, 0.18, 0.18, 20), W, -0.6, H + 0.7, 1.0, { r: [PI / 2, 0, 0], line: 0 });
      if (v % 2 === 0) {
        m.add(L([[0, 0], [0.42, 0], [0.42, 0.7], [0.45, 0.72], [0.2, 0.95], [0, 0.98]]), 0x9a6b4a, -0.8, H + 0.27, -0.6);
      }
      m.move({ kind: 'pulse', amp: 0.3, speed: 4.5 }, 0, H + 0.36, 0.98);
      bulbs(m, [-0.8, -0.4, 0, 0.4, 0.8].map((x): V3 => [x, H + 0.36, 0.98]), [LIGHT, 0xff9ecf, 0x7bdff2], 0.07);
      break;
    }
    case 'streetTree': {
      // 변형 0은 초록, 1은 분홍 꽃, 2는 눈 덮인 겨울 나무이다.
      const leaf = v === 1 ? [0xff9ecf, 0xffb8dc, 0xf77fbe] : v === 2 ? [0x3f9f6a, 0x58b77a, 0x34875a] : [0x5cc95a, 0x7fdc5f, 0x46b04f];
      m.add(L([[0, 0], [0.22, 0], [0.16, 0.3], [0.12, 1.4], [0.1, 1.7], [0, 1.7]]), 0x9a5b3a);
      if (v === 2) m.add(S(0.5), W, 0, 0.05, 0, { s: [1, 0.3, 1] });
      else m.add(R(0.42, 0.08), 0xb9b4aa, 0, 0.08, 0, { r: [PI / 2, 0, 0] });
      m.move({ kind: 'sway', amp: 0.05, speed: 1.1 }, 0, 1.5, 0);
      const crown: [number, number, number, number, number][] = [[0, 2.4, 0, 0.95, 0], [0.55, 2.75, 0.2, 0.7, 1], [-0.5, 2.7, -0.25, 0.65, 2], [0.1, 3.15, -0.1, 0.55, 1]];
      for (const [x, y, z, r, c] of crown) {
        m.add(S(r), leaf[c], x, y, z);
        if (v === 2) m.add(S(r * 0.82), W, x, y + r * 0.42, z, { s: [1, 0.45, 1] });
      }
      break;
    }
    case 'lamp':
      m.add(L([[0, 0], [0.22, 0], [0.22, 0.12], [0.12, 0.3], [0.08, 0.5], [0, 0.5]]), INK);
      m.add(C(0.06, 0.08, 2.6, 12), INK, 0, 1.75, 0);
      m.add(T([[0, 3.0, 0], [0, 3.35, 0.15], [0, 3.4, 0.5], [0, 3.25, 0.75]], 0.06, 16), INK);
      m.add(L([[0.3, -0.12], [0.24, -0.02], [0.1, 0.12], [0, 0.14]]), INK, 0, 3.2, 0.75);
      m.move({ kind: 'pulse', amp: 0.08, speed: 3 }, 0, 3.02, 0.75);
      m.add(S(0.17), LIGHT, 0, 3.02, 0.75, { glow: true, line: 0 });
      break;
    case 'trafficLight':
      m.add(L([[0, 0], [0.2, 0], [0.2, 0.1], [0.1, 0.25], [0, 0.25]]), INK);
      m.add(C(0.06, 0.07, 3.0, 12), 0x3a3350, 0, 1.5, 0);
      m.add(B(0.5, 1.3, 0.4, 0.14), 0xffc83d, 0, 2.6, 0.1);
      m.add(S(0.15, 14, 10), 0xff4b4b, 0, 3.0, 0.32, { s: [1, 1, 0.5], glow: true });
      m.add(S(0.15, 14, 10), 0xffb03b, 0, 2.6, 0.32, { s: [1, 1, 0.5], glow: true });
      m.move({ kind: 'pulse', amp: 0.2, speed: 3 }, 0, 2.2, 0.32);
      m.add(S(0.15, 14, 10), 0x4fdc6a, 0, 2.2, 0.32, { s: [1, 1, 0.5], glow: true });
      break;
    case 'planter':
      m.add(L([[0, 0], [0.3, 0], [0.42, 0.45], [0.48, 0.5], [0.48, 0.6], [0, 0.6]]), 0xe07a4f);
      m.add(S(0.42), 0x5cc95a, 0, 0.75, 0, { s: [1, 0.7, 1] });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * 2 * PI;
        m.add(S(0.1, 12, 8), [0xff5b9e, 0xffc83d, W][i % 3], Math.cos(a) * 0.3, 0.92, Math.sin(a) * 0.3, { line: 0.02 });
      }
      break;
    case 'maple': {
      const leaf = [[0xe8483b, 0xff6b3d, 0xd62f3a], [0xff8c2b, 0xffb03b, 0xf06a25], [0xffc93c, 0xffe066, 0xf4a72a]][v % 3];
      m.add(L([[0, 0], [0.38, 0], [0.28, 0.3], [0.2, 1.6], [0.16, 2.2], [0, 2.2]]), 0x8b5638);
      m.add(T([[0, 1.6, 0], [0.5, 2.1, 0.1], [0.9, 2.5, 0.2]], 0.09), 0x8b5638);
      m.add(T([[0, 1.8, 0], [-0.5, 2.3, -0.1], [-0.8, 2.7, -0.3]], 0.08), 0x8b5638);
      for (let i = 0; i < 7; i++) {
        const a = i * 2.1, d = 1 + (i % 3) * 0.3;
        m.add(S(0.16, 10, 6), leaf[i % 3], Math.cos(a) * d, 0.03, Math.sin(a) * d, { s: [1, 0.2, 1], line: 0 });
      }
      m.move({ kind: 'sway', amp: 0.04, speed: 0.9 }, 0, 2.0, 0);
      for (const [x, y, z, r, c] of [[0, 3.2, 0, 1.3, 0], [0.9, 3.0, 0.4, 0.95, 1], [-0.9, 3.1, -0.3, 1.0, 2], [0.3, 3.9, -0.2, 0.95, 1], [-0.4, 3.75, 0.5, 0.8, 0], [0.6, 3.6, -0.7, 0.75, 2]]) {
        m.add(S(r), leaf[c], x, y, z);
      }
      break;
    }
    case 'gate':
      for (const x of [-1.55, 1.55]) {
        m.add(B(0.7, 3.0, 0.7, 0.1), 0xd9583b, x, 1.5, 0);
        for (const y of [0.8, 1.6, 2.4]) m.add(B(0.74, 0.06, 0.74, 0.02), 0xfff1d0, x, y, 0, { line: 0 });
        m.add(B(0.88, 0.25, 0.88, 0.08), 0xfff1d0, x, 3.1, 0);
        m.add(S(0.22), 0xffc83d, x, 3.42, 0);
      }
      m.add(R(1.55, 0.2, PI), 0xfff1d0, 0, 3.0, 0);
      m.add(B(2.0, 0.55, 0.14, 0.12), 0x46b04f, 0, 3.55, 0);
      m.add(B(1.6, 0.12, 0.16, 0.05), 0xffc83d, 0, 3.55, 0.01, { line: 0 });
      m.move({ kind: 'pulse', amp: 0.05, speed: 4 }, 0, 3.0, 0.2);
      bulbs(m, Array.from({ length: 7 }, (_, k): V3 => [1.55 * Math.cos(((k + 1) * PI) / 8), 3 + 1.55 * Math.sin(((k + 1) * PI) / 8), 0.2]), [LIGHT, 0xff9ecf]);
      break;
    case 'shrub': {
      const leaf = v === 2 ? [0xf08b3e, 0xffc04d, 0xd95d3f] : [0x55ad58, 0x62c767, 0x4a9b52];
      for (const [x, y, z, r, c] of [[-0.35, 0.45, 0, 0.55, 0], [0.35, 0.5, 0.1, 0.6, 1], [0, 0.75, -0.15, 0.5, 2], [0.05, 0.4, 0.4, 0.42, 1]]) {
        m.add(S(r), leaf[c], x, y, z);
      }
      if (v === 1) {
        for (const [x, y, z] of [[-0.4, 0.95, 0.2], [0.3, 1.0, 0.3], [0.5, 0.8, -0.2], [-0.1, 1.2, -0.1], [0.1, 0.7, 0.75], [-0.75, 0.6, -0.1]]) {
          m.add(S(0.09, 10, 6), x > 0 ? 0xff9ecf : W, x, y, z, { line: 0.02 });
        }
      }
      break;
    }
    case 'bench':
      for (const z of [-0.12, 0.04, 0.2]) m.add(B(1.5, 0.08, 0.14, 0.04), 0xd9783f, 0, 0.5, z);
      for (const y of [0.75, 0.95]) m.add(B(1.5, 0.12, 0.08, 0.04), 0xd9783f, 0, y, -0.28, { r: [-0.15, 0, 0] });
      for (const x of [-0.6, 0.6]) {
        m.add(T([[x, 0, 0.25], [x, 0.4, 0.22], [x, 0.46, 0], [x, 0.4, -0.2], [x, 0, -0.22]], 0.035), INK);
        m.add(T([[x, 0.46, -0.2], [x, 0.8, -0.3], [x, 1.02, -0.3]], 0.035), INK);
      }
      break;
    case 'leafPile': {
      const c = [0xf08b3e, 0xd95d3f, 0xffc04d];
      for (const [x, y, z, r, k] of [[0, 0.15, 0, 0.6, 0], [0.45, 0.1, 0.2, 0.4, 1], [-0.4, 0.12, -0.15, 0.45, 2], [0.1, 0.3, -0.1, 0.35, 1]]) {
        m.add(S(r), c[k], x, y, z, { s: [1, 0.45, 1] });
      }
      for (let i = 0; i < 6; i++) {
        const a = i * 1.7, d = 0.85 + (i % 2) * 0.2;
        m.add(S(0.13, 10, 6), c[i % 3], Math.cos(a) * d, 0.03, Math.sin(a) * d, { s: [1, 0.2, 1], line: 0 });
      }
      break;
    }
    case 'pavilion': {
      const roof = [0x46b04f, 0xd9583b][v % 2];
      m.add(L([[0, 0], [1.55, 0], [1.55, 0.2], [1.4, 0.3], [0, 0.3]]), 0xfff1d0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * 2 * PI;
        m.add(C(0.1, 0.12, 2.0, 12), 0xd9583b, Math.cos(a) * 1.2, 1.3, Math.sin(a) * 1.2);
      }
      m.add(C(0.45, 0.45, 0.08), 0xd9783f, 0, 0.85, 0);
      m.add(C(0.08, 0.1, 0.55, 10), 0xd9783f, 0, 0.55, 0);
      m.add(C(1.75, 1.75, 0.12, 24), 0xfff1d0, 0, 2.3, 0);
      m.add(L([[1.85, 2.3], [1.55, 2.5], [1.05, 2.85], [0.55, 3.25], [0.18, 3.6], [0, 3.65]]), roof);
      m.add(R(1.8, 0.07), 0xffc83d, 0, 2.33, 0, { r: [PI / 2, 0, 0] });
      m.add(S(0.2), 0xffc83d, 0, 3.75, 0);
      m.move({ kind: 'pulse', amp: 0.05, speed: 3 }, 0, 2.2, 0);
      bulbs(m, Array.from({ length: 12 }, (_, k): V3 => [1.8 * Math.cos((k * PI) / 6), 2.2, 1.8 * Math.sin((k * PI) / 6)]), [LIGHT, 0xff9ecf, 0xffc83d]);
      break;
    }
    case 'hut': {
      const wall = [0xff5b5b, 0x3d7bff, 0xffc83d][v % 3];
      m.add(B(2.2, 1.5, 2.0, 0.1), wall, 0, 0.75, 0);
      for (const x of [-1.04, 1.04]) for (const z of [-0.94, 0.94]) m.add(B(0.16, 1.5, 0.16, 0.04), W, x, 0.75, z, { line: 0 });
      const gable = new THREE.Shape();
      gable.moveTo(-1.1, 0);
      gable.lineTo(1.1, 0);
      gable.lineTo(0, 0.85);
      m.add(new THREE.ExtrudeGeometry(gable, { depth: 1.9, bevelEnabled: false }).translate(0, 0, -0.95), wall, 0, 1.5, 0);
      for (const side of [-1, 1]) m.add(B(1.6, 0.24, 2.4, 0.1), W, side * 0.62, 1.98, 0, { r: [0, 0, -side * 0.65] });
      m.add(new THREE.CapsuleGeometry(0.16, 2.2, 4, 12), W, 0, 2.48, 0, { r: [PI / 2, 0, 0] });
      for (const side of [-1, 1]) for (const z of [-0.8, -0.3, 0.2, 0.7]) m.add(K(0.06, 0.32, 8), 0xbfeaff, side * 1.28, 1.35, z, { r: [PI, 0, 0], line: 0.02 });
      m.add(B(0.55, 0.95, 0.08, 0.08), 0x8b5638, -0.45, 0.48, 1.0);
      m.add(C(0.22, 0.22, 0.08, 20), LIGHT, 0.5, 0.95, 1.01, { r: [PI / 2, 0, 0], glow: true, line: 0 });
      m.add(R(0.24, 0.05), W, 0.5, 0.95, 1.04);
      m.add(B(0.32, 0.8, 0.32, 0.06), 0xb9b4aa, 0.6, 2.4, -0.4);
      m.add(S(0.22, 14, 8), W, 0.6, 2.82, -0.4, { s: [1, 0.45, 1] });
      m.add(C(0.4, 0.4, 0.03, 24), 0x2f7fcf, 0.65, 0.02, 1.7, { line: 0.02 });
      m.add(T([[1.05, 0.05, 1.35], [0.95, 0.6, 1.55], [0.75, 1.05, 1.75]], 0.025, 12), INK);
      for (let k = 0; k < 3; k++) {
        m.move({ kind: 'puff', amp: 1.6, speed: 0.4, off: k / 3 }, 0.6, 2.85, -0.4);
        m.add(S(0.2, 14, 10), 0xe9f1fb, 0.6, 2.85, -0.4, { line: 0 });
      }
      break;
    }
    case 'pine':
      m.add(C(0.14, 0.2, 0.8, 12), 0x8b5638, 0, 0.4, 0);
      for (let i = 0; i < 3; i++) {
        const r = 1.15 - i * 0.3, y0 = 0.6 + i * 0.85, h = 1.3;
        m.add(L([[0, 0], [r * 0.85, 0], [r, 0.06], [r * 0.35, h * 0.55], [0, h]]), 0x2f9e7a, 0, y0, 0);
        m.add(K(r * 0.58, h * 0.48), W, 0, y0 + h * 0.77, 0);
      }
      if (v % 2) {
        m.add(O(0.24), 0xffc83d, 0, 4.05, 0, { glow: true });
        m.move({ kind: 'pulse', amp: 0.04, speed: 5 }, 0, 2, 0);
        const pts: V3[] = [];
        for (let i = 0; i < 3; i++) {
          const r = 1.05 - i * 0.3;
          for (let k = 0; k < 6; k++) pts.push([Math.cos(k + i) * r, 0.7 + i * 0.85, Math.sin(k + i) * r]);
        }
        bulbs(m, pts, [0xff5b5b, 0xffc83d, 0x7bdff2, 0x6fdc6a], 0.08);
      }
      break;
    case 'snowman':
      m.add(S(0.62), W, 0, 0.55, 0);
      m.add(S(0.46), W, 0, 1.35, 0);
      m.add(S(0.34), W, 0, 1.95, 0);
      m.add(R(0.33, 0.09), 0xff5b5b, 0, 1.7, 0, { r: [PI / 2, 0, 0] });
      m.add(B(0.16, 0.45, 0.08, 0.04), 0xff5b5b, 0.2, 1.48, 0.32, { r: [0, 0, 0.2] });
      m.add(C(0.36, 0.36, 0.06, 24), INK, 0, 2.22, 0);
      m.add(C(0.24, 0.24, 0.4, 20), INK, 0, 2.43, 0);
      m.add(C(0.245, 0.245, 0.08, 20), 0xff5b5b, 0, 2.3, 0, { line: 0 });
      m.add(K(0.06, 0.35, 12), 0xff7a1a, 0, 1.95, 0.45, { r: [PI / 2, 0, 0] });
      for (const x of [-0.11, 0.11]) m.add(S(0.045, 10, 6), INK, x, 2.03, 0.3, { line: 0 });
      for (const [y, z] of [[1.4, 0.45], [1.2, 0.43]]) m.add(S(0.06, 10, 6), INK, 0, y, z, { line: 0 });
      for (const side of [-1, 1]) m.add(T([[side * 0.4, 1.45, 0], [side * 0.75, 1.7, 0.05], [side * 0.95, 1.95, 0]], 0.035, 12), 0x8b5638);
      break;
    case 'snowdrift':
      for (const [x, y, z, r, c] of [[0, 0.15, 0, 0.75, W], [0.55, 0.1, 0.25, 0.5, 0xe9f4ff], [-0.5, 0.1, -0.2, 0.55, 0xf4f8ff]]) {
        m.add(S(r), c, x, y, z, { s: [1, 0.45, 1] });
      }
      break;
    case 'arrowBoard':
      // 화살표는 +x 쪽, 곧 앞면을 마주한 카트의 오른쪽을 가리킨다.
      for (const x of [-1.2, 1.2]) m.add(C(0.07, 0.08, 1.6, 12), 0x8a96a8, x, 0.8, 0);
      m.add(B(3.0, 1.1, 0.12, 0.08), 0x3d7bff, 0, 1.55, 0);
      for (const z of [0.07, -0.07]) {
        for (const x of [-0.8, 0, 0.8]) {
          for (const s of [1, -1]) m.add(B(0.5, 0.13, 0.04, 0.03), W, x, 1.55 + s * 0.17, z, { r: [0, 0, -s * PI / 4], glow: true, line: 0 });
        }
      }
      m.add(B(3.1, 0.16, 0.26, 0.07), W, 0, 2.17, 0);
      for (const [x, r] of [[-0.9, 0.2], [0.2, 0.24], [1.1, 0.18]]) m.add(S(r, 14, 10), W, x, 2.25, 0, { s: [1.6, 0.6, 0.9] });
      for (const x of [-1.2, 1.2]) m.add(S(0.45), 0xf4f8ff, x, 0.1, 0, { s: [1, 0.4, 1] });
      break;
    case 'iceChunk':
      m.add(O(0.4), 0xbfeaff, 0, 0.55, 0, { s: [0.7, 1.6, 0.7] });
      m.add(O(0.28), 0x8fd8ff, 0.35, 0.35, 0.15, { s: [0.7, 1.5, 0.7], r: [0, 0, -0.4] });
      m.add(O(0.22), 0xdff8ff, -0.3, 0.3, -0.1, { s: [0.7, 1.5, 0.7], r: [0, 0, 0.5] });
      break;
    case 'mesa': {
      const c = [[0xc75b3a, 0xe08a52, 0xb54a32, 0xf0b27a], [0xd9774a, 0xf3b16c, 0xc45a3c, 0xffd29a]][v % 2];
      m.add(C(1.55, 1.9, 1.0, 14), c[0], 0, 0.5, 0, { s: [1.1, 1, 0.9] });
      m.add(C(1.45, 1.55, 0.7, 14), c[1], 0.05, 1.35, 0, { s: [1.08, 1, 0.92] });
      m.add(C(1.2, 1.4, 0.9, 14), c[2], -0.05, 2.15, 0.05, { s: [1.1, 1, 0.9] });
      m.add(C(1.1, 1.2, 0.16, 14), c[3], -0.05, 2.68, 0.05, { s: [1.1, 1, 0.9] });
      m.add(I(0.35, 1), c[0], 1.7, 0.2, 0.6);
      m.add(I(0.25, 1), c[2], -1.6, 0.15, -0.8);
      break;
    }
    case 'cactus': {
      const g = 0x3fae55;
      m.add(S(0.4), 0xe8a96a, 0, 0, 0, { s: [1, 0.3, 1], line: 0 });
      m.add(new THREE.CapsuleGeometry(0.32, 2.0, 6, 16), g, 0, 1.3, 0);
      m.add(T([[0.2, 1.1, 0], [0.7, 1.15, 0], [0.75, 1.5, 0], [0.75, 2.0, 0]], 0.2), g);
      m.add(S(0.2), g, 0.75, 2.0, 0);
      if (v % 2 === 0) {
        m.add(T([[-0.2, 1.5, 0], [-0.6, 1.55, 0], [-0.62, 1.8, 0], [-0.62, 2.2, 0]], 0.18), g);
        m.add(S(0.18), g, -0.62, 2.2, 0);
      }
      m.add(S(0.13, 12, 8), 0xff5b9e, 0, 2.65, 0);
      m.add(S(0.07, 10, 6), 0xffc83d, 0, 2.74, 0.06, { line: 0 });
      break;
    }
    case 'camp':
      for (const x of [-1.4, 1.4]) for (const z of [-1.4, 1.4]) m.add(C(0.05, 0.05, 2.0, 8), 0x8a96a8, x, 1.0, z);
      for (let i = 0; i < 8; i++) {
        m.add(new THREE.ConeGeometry(2.1, 0.9, 4, 1, false, (i * PI) / 4, PI / 4), i % 2 ? W : 0xff7a1a, 0, 2.45, 0);
      }
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * 2 * PI;
        m.add(S(0.2, 12, 8), i % 2 ? 0xff7a1a : W, Math.cos(a) * 2.0, 1.95, Math.sin(a) * 2.0, { s: [1, 0.7, 1], line: 0.02 });
      }
      m.add(B(1.2, 0.08, 0.7, 0.04), W, 0.3, 0.75, 0.2);
      for (const x of [-0.2, 0.8]) m.add(C(0.04, 0.04, 0.72, 8), INK, x, 0.36, 0.2);
      m.add(B(0.32, 0.22, 0.22, 0.06), INK, 0.5, 0.9, 0.2);
      for (const [x, z, c] of [[-1.0, -0.6, 0xff5b5b], [-0.55, -1.0, 0x3d7bff]]) {
        m.add(C(0.25, 0.25, 0.6, 16), c, x, 0.3, z);
        m.add(R(0.25, 0.03), W, x, 0.42, z, { r: [PI / 2, 0, 0], line: 0 });
      }
      m.add(C(0.15, 0.15, 0.1, 12), INK, 0, 1.78, 0, { line: 0 });
      m.move({ kind: 'pulse', amp: 0.15, speed: 3 }, 0, 1.6, 0);
      m.add(S(0.15), 0xffd27a, 0, 1.6, 0, { glow: true });
      m.still();
      flag(m, 0, 3.6, 0, 0xffc83d, INK);
      break;
    case 'tent': {
      const c = [0x3d7bff, 0xffc83d, 0x2ec4b6][v % 3];
      m.add(new THREE.SphereGeometry(1, 24, 12, 0, 2 * PI, 0, PI / 2), c, 0, 0, 0, { s: [0.9, 0.75, 1.1] });
      m.add(new THREE.SphereGeometry(0.4, 16, 10, 0, 2 * PI, 0, PI / 2), INK, 0, 0, 1.0, { s: [1, 1.2, 0.3], line: 0 });
      for (const a of [PI / 4, -PI / 4]) m.add(R(1.0, 0.035, PI), W, 0, 0, 0, { r: [0, a, 0], s: [0.92, 0.77, 1], line: 0 });
      break;
    }
    case 'bush':
      for (const [rx, ry] of [[0, 0], [PI / 2, 0], [PI / 4, PI / 2], [PI / 2, PI / 3]]) {
        m.add(R(0.38, 0.05), 0xb98a4f, 0, 0.42, 0, { r: [rx, ry, 0], line: 0.02 });
      }
      m.add(S(0.28), 0x9a6b3a, 0, 0.42, 0);
      break;
    case 'stake':
      for (let i = 0; i < 5; i++) m.add(C(0.07, 0.07, 0.32, 12), i % 2 ? W : 0xff5b5b, 0, 0.16 + i * 0.32, 0);
      m.add(S(0.09, 12, 8), W, 0, 1.65, 0);
      m.move({ kind: 'wave', amp: 0.4, speed: 3 }, 0, 1.45, 0);
      m.add(cloth(0.45, 0.3), 0xff7a1a, 0.04, 1.45, 0);
      break;
    case 'rock': {
      const c = [0xb9684a, 0xd4875e, 0x9a4f38];
      m.add(I(0.6), c[0], 0, 0.35, 0, { s: [1.2, 0.75, 1] });
      m.add(I(0.38), c[1], 0.55, 0.25, 0.3, { s: [1, 0.8, 1] });
      m.add(I(0.28), c[2], -0.5, 0.18, -0.25);
      break;
    }
    case 'iceberg':
      m.move({ kind: 'bob', amp: 0.12, speed: 0.8 });
      if (v % 2) {
        for (const x of [-1.3, 0, 1.3]) m.add(I(1.15, 1), 0x9fe3ff, x, 0.5, 0, { s: [1, 0.8, 0.9] });
        m.add(new THREE.CapsuleGeometry(0.55, 2.6, 6, 16), W, 0, 1.25, 0, { r: [0, 0, PI / 2], s: [1, 0.7, 1] });
        crystal(m, 0.4, 1.4, 0xdff8ff, 0.6, 1.8, 0, -0.2);
      } else {
        m.add(I(1.7, 1), 0x9fe3ff, 0, 0.5, 0, { s: [1.1, 0.7, 1] });
        m.add(S(1.4), W, 0, 1.0, 0, { s: [1.05, 0.35, 0.95] });
        m.add(O(1.0), 0xdff8ff, 0.2, 2.2, 0.1, { s: [0.8, 2.0, 0.8] });
        m.add(O(0.6), 0xbfeaff, -0.8, 1.6, -0.3, { s: [0.8, 1.8, 0.8], r: [0, 0, 0.3] });
      }
      m.still();
      foam(m, v % 2 ? 2.4 : 1.9);
      break;
    case 'icePillar':
      crystal(m, 0.6, 3.6, 0xbfeaff, 0, 1.8, 0, 0);
      crystal(m, 0.4, 2.2, 0x8fd8ff, 0.7, 1.0, 0.2, -0.35);
      crystal(m, 0.32, 1.5, 0xdff8ff, -0.6, 0.7, -0.3, 0.4);
      foam(m, 1.0);
      break;
    case 'floe':
      m.add(C(1.3, 1.2, 0.45, 18), 0xdff8ff, 0, 0.12, 0, { s: [1, 1, 0.8] });
      m.add(S(0.6), W, -0.3, 0.35, 0.1, { s: [1, 0.4, 1] });
      m.add(S(0.45), W, 0.5, 0.33, -0.25, { s: [1, 0.4, 1] });
      for (let i = 0; i < 5; i++) m.add(C(0.06, 0.06, 0.3, 12), i % 2 ? INK : 0xffc83d, 0.6, 0.45 + i * 0.3, 0.3);
      m.move({ kind: 'wave', amp: 0.4, speed: 3 }, 0.6, 1.8, 0.3);
      m.add(cloth(0.6, 0.4), 0xff4b4b, 0.64, 1.8, 0.3);
      m.still();
      foam(m, 1.35);
      break;
  }
  return m;
}

// 위치·법선·색만 남겨 합친다. 색은 부품별 정점 색으로 넣어 재질 하나를 함께 쓴다.
function merge(parts: Part[], pick: (p: Part) => THREE.BufferGeometry | null, colored: boolean): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    const src = pick(p);
    if (!src) continue;
    const g = src.index ? src.toNonIndexed() : src;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (colored) {
      const c = new THREE.Color(p.color);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    geos.push(g);
  }
  return geos.length ? mergeGeometries(geos) : null;
}

const tmpEuler = new THREE.Euler();
const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();

function animMatrix(a: Anim, t: number, ph: number, out: THREE.Matrix4) {
  const w = a.speed * t + ph;
  tmpPos.set(0, 0, 0);
  tmpEuler.set(0, 0, 0);
  tmpScale.set(1, 1, 1);
  switch (a.kind) {
    case 'sway':
      tmpEuler.set(a.amp * 0.6 * Math.sin(w * 0.83 + 1), 0, a.amp * Math.sin(w));
      break;
    case 'wave':
      tmpEuler.set(0, a.amp * Math.sin(w), 0);
      tmpScale.set(1 + 0.08 * Math.sin(2 * w), 1, 1);
      break;
    case 'bob':
      tmpPos.set(0, a.amp * Math.sin(w), 0);
      tmpEuler.set(a.amp * 0.25 * Math.sin(w * 0.7), 0, a.amp * 0.25 * Math.cos(w * 0.9));
      break;
    case 'pulse':
      tmpScale.setScalar(1 + a.amp * Math.sin(w));
      break;
    case 'puff': {
      const f = (((a.speed * t + (a.off ?? 0) + ph / (2 * PI)) % 1) + 1) % 1;
      tmpPos.set(f * 0.3, f * a.amp, 0);
      tmpScale.setScalar((0.5 + f) * Math.sin(PI * f) + 0.001);
      break;
    }
  }
  out.compose(tmpPos, tmpQuat.setFromEuler(tmpEuler), tmpScale);
}

interface Moving {
  meshes: THREE.InstancedMesh[];
  anim: Anim;
  bases: THREE.Matrix4[];
  phases: number[];
}

export class DecorLayer {
  readonly root = new THREE.Group();
  private moving: Moving[] = [];
  private animM = new THREE.Matrix4();
  private outM = new THREE.Matrix4();

  constructor(map: MapData) {
    const solid = toon(W);
    solid.vertexColors = true;
    const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    const line = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

    const groups = new Map<string, Decor[]>();
    for (const d of map.decor) {
      const key = `${d.type}:${d.variant ?? 0}`;
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
    const shadows: Decor[] = [];
    for (const list of groups.values()) {
      const model = build(list[0].type, list[0].variant ?? 0);
      const bases = list.map((d) => {
        const sea = surfaceAtPoint(map, d.x, d.y) === 'sea';
        if (!sea) shadows.push(d);
        const s = d.scale ?? 1;
        return new THREE.Matrix4().compose(
          new THREE.Vector3(d.x, sea ? -SEA_DEPTH : heightAt(map, d.x, d.y), d.y),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, PI / 2 - (d.angle ?? 0), 0)),
          new THREE.Vector3(s, s, s),
        );
      });
      const phases = list.map((d) => ((((Math.sin(d.x * 12.9898 + d.y * 78.233) * 43758.5453) % 1) + 1) % 1) * 2 * PI);
      for (const ch of model.channels) {
        const meshes: THREE.InstancedMesh[] = [];
        const layers: [THREE.BufferGeometry | null, THREE.Material][] = [
          [merge(ch.parts.filter((p) => !p.glow), (p) => p.geo, true), solid],
          [merge(ch.parts.filter((p) => p.glow), (p) => p.geo, true), glow],
          [merge(ch.parts, (p) => p.line, false), line],
        ];
        for (const [geo, mat] of layers) {
          if (!geo) continue;
          const mesh = new THREE.InstancedMesh(geo, mat, list.length);
          meshes.push(mesh);
          this.root.add(mesh);
        }
        const pivot = new THREE.Matrix4().makeTranslation(ch.pivot);
        const chBases = bases.map((b) => b.clone().multiply(pivot));
        if (ch.anim) {
          for (const mesh of meshes) mesh.frustumCulled = false;
          this.moving.push({ meshes, anim: ch.anim, bases: chBases, phases });
        } else {
          for (const mesh of meshes) chBases.forEach((b, i) => mesh.setMatrixAt(i, b));
        }
      }
    }

    const shadow = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 24).rotateX(-PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false }),
      shadows.length,
    );
    shadows.forEach((d, i) => {
      const r = d.radius * 1.35;
      shadow.setMatrixAt(i, new THREE.Matrix4().compose(
        new THREE.Vector3(d.x, heightAt(map, d.x, d.y) + 0.015, d.y),
        new THREE.Quaternion(),
        new THREE.Vector3(r, 1, r),
      ));
    });
    this.root.add(shadow);
    this.update(0);
  }

  update(time: number) {
    for (const mv of this.moving) {
      for (let i = 0; i < mv.bases.length; i++) {
        animMatrix(mv.anim, time, mv.phases[i], this.animM);
        this.outM.multiplyMatrices(mv.bases[i], this.animM);
        for (const mesh of mv.meshes) mesh.setMatrixAt(i, this.outM);
      }
      for (const mesh of mv.meshes) mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
