import * as THREE from 'three';
import {
  COUNTDOWN_MS,
  createKart,
  stepKart,
  TICK_MS,
  validateMap,
  type KartState,
  type MapData,
} from '@dashrush/shared';
import { Keyboard } from './keyboard.ts';
import { Minimap } from './minimap.ts';
import { buildTrack, KartModel } from './scene.ts';

export interface RaceHud {
  lap: number;
  laps: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  finishedMs: number | null;
}

export type ViewMode = 'third' | 'first';

interface Options {
  host: HTMLElement;
  minimap: HTMLCanvasElement;
  map: MapData;
  laps: number;
  color: number;
  onHud: (hud: RaceHud) => void;
  onTime: (ms: number) => void;
  onCountdown: (text: string | null) => void;
  onView: (view: ViewMode) => void;
}

const MAX_CATCHUP_TICKS = 5;
const VIEW_KEY = 'dashrush.view';

const CAM = {
  third: { back: 3.2, height: 1.5, lookAhead: 2.5, lookHeight: 0.35, fov: 68 },
  first: { eyeForward: 0.1, eyeHeight: 0.5, fov: 78 },
  boostFov: 10,
  yawFollow: 8, // 초당 따라잡는 비율
  driftYawFollow: 3,
};

function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'first' ? 'first' : 'third';
  } catch {
    return 'third';
  }
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// 서버 없이 혼자 달리는 경주이다. 3단계에서 이 tick 루프가 내 카트 예측 루프가 된다.
export class LocalRace {
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(CAM.third.fov, 1, 0.05, 400);
  private keyboard = new Keyboard();
  private kartModel: KartModel;
  private minimap: Minimap;
  private resizeObserver: ResizeObserver;

  private prev: KartState;
  private kart: KartState;
  private acc = 0;
  private lastFrame = performance.now();
  private startAt = 0; // performance.now() 기준 출발 시각
  private raceTicks = 0;
  private lapStartMs = 0;
  private hud!: RaceHud;
  private countdown: string | null = null;
  private view: ViewMode = loadView();
  private camYaw = 0;
  private fov = CAM.third.fov;

  constructor(private opts: Options) {
    const errors = validateMap(opts.map);
    if (errors.length) throw new Error(errors.join('\n'));

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    opts.host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x9fdcff);
    this.scene.fog = new THREE.Fog(0x9fdcff, 30, 90);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x7fd35b, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, 2, -1.5);
    this.scene.add(sun);
    this.scene.add(buildTrack(opts.map, this.renderer));

    this.kartModel = new KartModel(opts.color);
    this.scene.add(this.kartModel.root);
    this.minimap = new Minimap(opts.minimap, opts.map);

    this.kart = createKart(opts.map.grid[0]);
    this.prev = this.kart;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(opts.host);
    this.resize();
    window.addEventListener('keydown', this.onKey);

    opts.onView(this.view);
    this.restart();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  restart() {
    this.kart = createKart(this.opts.map.grid[0]);
    this.prev = this.kart;
    this.acc = 0;
    this.raceTicks = 0;
    this.lapStartMs = 0;
    this.camYaw = this.kart.angle;
    this.startAt = performance.now() + COUNTDOWN_MS;
    this.hud = { lap: 1, laps: this.opts.laps, lastLapMs: null, bestLapMs: null, finishedMs: null };
    this.opts.onHud(this.hud);
    this.opts.onTime(0);
  }

  toggleView() {
    this.view = this.view === 'third' ? 'first' : 'third';
    try {
      localStorage.setItem(VIEW_KEY, this.view);
    } catch {
      // 저장하지 못해도 이번 경주에서는 전환된 시점을 쓴다.
    }
    this.opts.onView(this.view);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyV' && !e.repeat) this.toggleView();
  };

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.opts.host;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min(now - this.lastFrame, 250);
    this.lastFrame = now;

    this.acc += dt;
    let n = 0;
    while (this.acc >= TICK_MS && n < MAX_CATCHUP_TICKS) {
      this.tick();
      this.acc -= TICK_MS;
      n++;
    }
    if (n === MAX_CATCHUP_TICKS) this.acc = 0;
    this.render(this.acc / TICK_MS, dt / 1000, now);
  }

  private tick() {
    const racing = performance.now() >= this.startAt;
    const bits = racing && !this.kart.finished ? this.keyboard.bits() : 0;
    this.prev = this.kart;
    const { kart, passed, crossFrac } = stepKart(this.kart, bits, this.opts.map, this.opts.laps);
    this.kart = kart;
    if (!racing) return;

    this.raceTicks++;
    if (passed === 0 && kart.lap > this.prev.lap) {
      // tick 경계가 아니라 결승선을 실제로 넘은 지점의 시각으로 기록한다.
      const crossMs = (this.raceTicks - 1 + crossFrac) * TICK_MS;
      const lapMs = crossMs - this.lapStartMs;
      this.lapStartMs = crossMs;
      this.hud = {
        ...this.hud,
        lap: Math.min(kart.lap + 1, this.opts.laps),
        lastLapMs: lapMs,
        bestLapMs: this.hud.bestLapMs === null ? lapMs : Math.min(this.hud.bestLapMs, lapMs),
        finishedMs: kart.finished ? crossMs : null,
      };
      this.opts.onHud(this.hud);
    }
  }

  private render(alpha: number, dtSec: number, now: number) {
    const p = this.prev, k = this.kart;
    const x = p.x + (k.x - p.x) * alpha;
    const y = p.y + (k.y - p.y) * alpha;
    const angle = p.angle + wrapAngle(k.angle - p.angle) * alpha;
    this.kartModel.update(k, x, y, angle, now / 1000);

    const boostFov = k.boostLeft > 0 ? CAM.boostFov : 0;
    if (this.view === 'third') {
      // 카메라 방향이 차체를 늦게 따라가게 해, 드리프트 때 차체가 옆으로 미끄러지는 모습이 보이게 한다.
      const follow = k.drifting ? CAM.driftYawFollow : CAM.yawFollow;
      this.camYaw += wrapAngle(angle - this.camYaw) * (1 - Math.exp(-follow * dtSec));
      const fx = Math.cos(this.camYaw), fz = Math.sin(this.camYaw);
      const c = CAM.third;
      this.camera.position.set(x - fx * c.back, c.height, y - fz * c.back);
      this.camera.lookAt(x + fx * c.lookAhead, c.lookHeight, y + fz * c.lookAhead);
      this.fov += (c.fov + boostFov - this.fov) * (1 - Math.exp(-6 * dtSec));
      this.kartModel.body.visible = true;
    } else {
      this.camYaw = angle;
      const fx = Math.cos(angle), fz = Math.sin(angle);
      const c = CAM.first;
      this.camera.position.set(x + fx * c.eyeForward, c.eyeHeight, y + fz * c.eyeForward);
      this.camera.lookAt(x + fx * 10, c.eyeHeight * 0.6, y + fz * 10);
      this.fov += (c.fov + boostFov - this.fov) * (1 - Math.exp(-6 * dtSec));
      this.kartModel.body.visible = false;
    }
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);

    this.minimap.draw([{ x, y, angle, color: '#' + this.opts.color.toString(16).padStart(6, '0'), me: true }]);
    this.updateCountdown(now);
    if (this.hud.finishedMs === null) this.opts.onTime(this.raceTicks * TICK_MS);
  }

  private updateCountdown(now: number) {
    const left = this.startAt - now;
    const text = left > 0 ? String(Math.ceil(left / 1000)) : left > -700 ? 'GO!' : null;
    if (text !== this.countdown) {
      this.countdown = text;
      this.opts.onCountdown(text);
    }
  }

  destroy() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.onKey);
    this.keyboard.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          (m as THREE.MeshBasicMaterial).map?.dispose();
          m.dispose();
        }
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
