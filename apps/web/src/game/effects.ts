import * as THREE from 'three';
import { surfaceAtPoint, type MapData } from '@dashrush/shared';
import type { ViewKart } from './scene.ts';

// 효과는 서버와 무관하게 각 클라이언트가 카트 상태(드리프트·노면·충돌)만 보고 만든다.

interface Particle {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  vel: THREE.Vector3;
  grow: number;
}

// 같은 모양의 입자를 돌려 쓰는 풀이다. 가장 오래된 입자부터 다시 쓴다.
class Pool {
  private items: Particle[] = [];
  private next = 0;

  constructor(scene: THREE.Scene, geometry: THREE.BufferGeometry, size: number, flat = false) {
    for (let i = 0; i < size; i++) {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      if (flat) mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.items.push({ mesh, life: 0, maxLife: 1, vel: new THREE.Vector3(), grow: 0 });
    }
  }

  spawn(x: number, y: number, z: number, color: number, life: number, vel = new THREE.Vector3(), grow = 0): Particle {
    const p = this.items[this.next++ % this.items.length];
    p.mesh.position.set(x, y, z);
    p.mesh.scale.setScalar(1);
    p.mesh.material.color.set(color);
    p.mesh.visible = true;
    p.life = p.maxLife = life;
    p.vel.copy(vel);
    p.grow = grow;
    return p;
  }

  update(dtSec: number, opacity: number) {
    for (const p of this.items) {
      if (p.life <= 0) continue;
      p.life -= dtSec;
      const t = Math.max(0, p.life / p.maxLife);
      p.mesh.visible = t > 0;
      p.mesh.position.addScaledVector(p.vel, dtSec);
      if (p.grow) p.mesh.scale.setScalar(1 + (1 - t) * p.grow);
      p.mesh.material.opacity = t * opacity;
    }
  }
}

const DUST_RATE = 18; // 카트 한 대가 초당 내는 먼지 수
const DUST_MIN_SPEED = 2;
const DUST_COLORS = { grass: 0x9fd77a, sand: 0xe8c879, verge: 0x9fd77a, offroad: 0x9fd77a } as const;
const SKID_STEP = 0.15; // 스키드 자국 조각 사이 거리(타일)
const SPARK_COUNT = 10;
const SPARK_COLORS = [0xffe14d, 0xffffff, 0xff9a2e];
const SPLASH_COUNT = 14;
const SPLASH_COLORS = [0xffffff, 0x9fd8ff, 0x5fb4f0];

export class Effects {
  private dust: Pool;
  private skids: Pool;
  private sparks: Pool;
  private dustCarry = new Map<string, number>();
  private lastSkid = new Map<string, { x: number; y: number }>();
  private falling = new Set<string>();

  constructor(scene: THREE.Scene, private map: MapData) {
    this.dust = new Pool(scene, new THREE.SphereGeometry(0.12, 6, 4), 80);
    this.skids = new Pool(scene, new THREE.PlaneGeometry(0.12, 0.2), 400, true);
    this.sparks = new Pool(scene, new THREE.OctahedronGeometry(0.07), 60);
  }

  kart(k: ViewKart, hit: boolean, dtSec: number) {
    if (k.fallLeft > 0) {
      if (!this.falling.has(k.id)) {
        this.falling.add(k.id);
        for (let i = 0; i < SPLASH_COUNT; i++) {
          const a = Math.random() * Math.PI * 2;
          const vel = new THREE.Vector3(Math.cos(a) * 1.5, 2 + Math.random() * 2, Math.sin(a) * 1.5);
          this.sparks.spawn(k.x, 0, k.y, SPLASH_COLORS[i % SPLASH_COLORS.length], 0.6, vel);
        }
      }
      return;
    }
    this.falling.delete(k.id);
    if (k.ghost) return;
    const fx = Math.cos(k.angle), fy = Math.sin(k.angle);
    const at = (back: number, side: number) => ({ x: k.x - fx * back - fy * side, y: k.y - fy * back + fx * side });

    const surface = surfaceAtPoint(this.map, k.x, k.y);
    if ((surface === 'grass' || surface === 'sand' || surface === 'verge' || surface === 'offroad') && k.speed >= DUST_MIN_SPEED) {
      let n = (this.dustCarry.get(k.id) ?? 0) + DUST_RATE * dtSec;
      for (; n >= 1; n--) {
        const p = at(0.45 + Math.random() * 0.2, (Math.random() - 0.5) * 0.6);
        this.dust.spawn(p.x, 0.1, p.y, DUST_COLORS[surface], 0.6, new THREE.Vector3(0, 0.6, 0), 1.5);
      }
      this.dustCarry.set(k.id, n);
    }

    // 드리프트 중 뒷바퀴 자리에 바닥 자국을 남긴다.
    const last = this.lastSkid.get(k.id);
    if (k.drifting && k.speed > 1) {
      if (!last || Math.hypot(k.x - last.x, k.y - last.y) >= SKID_STEP) {
        for (const side of [0.32, -0.32]) {
          const p = at(0.3, side);
          this.skids.spawn(p.x, 0.012, p.y, 0x2b2340, 3).mesh.rotation.z = -k.angle + Math.PI / 2;
        }
        this.lastSkid.set(k.id, { x: k.x, y: k.y });
      }
    } else if (last) {
      this.lastSkid.delete(k.id);
    }

    // 부딪히면 앞쪽에서 별 모양 불꽃이 튄다.
    if (hit) {
      const p = at(-0.5, 0);
      for (let i = 0; i < SPARK_COUNT; i++) {
        const a = Math.random() * Math.PI * 2;
        const vel = new THREE.Vector3(Math.cos(a) * 2, 1.5 + Math.random() * 1.5, Math.sin(a) * 2);
        this.sparks.spawn(p.x, 0.3, p.y, SPARK_COLORS[i % SPARK_COLORS.length], 0.4, vel);
      }
    }
  }

  update(dtSec: number) {
    this.dust.update(dtSec, 0.7);
    this.skids.update(dtSec, 0.35);
    this.sparks.update(dtSec, 1);
  }
}
