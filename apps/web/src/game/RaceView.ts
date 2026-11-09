import * as THREE from 'three';
import { heightAt, TICK_MS, trackDirection, type KartState, type MapData } from '@dashrush/shared';
import { DecorLayer } from './decor.ts';
import { Effects } from './effects.ts';
import { Minimap } from './minimap.ts';
import { buildTrack, KartModel, type ViewKart } from './scene.ts';

export type ViewMode = 'third' | 'first';

const VIEW_KEY = 'dashrush.view';

const CAM = {
  third: { back: 3.0, lookAhead: 2.0, lookHeight: 0.35, pitchDeg: 20, fov: 68 },
  first: { eyeForward: 0.1, eyeHeight: 1.2, pitchDeg: 9, fov: 78 },
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

export function wrapAngle(a: number) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

const MAX_CATCHUP_TICKS = 5;

// 브라우저 프레임 사이 경과 시간을 고정 길이 tick으로 바꾼다. 탭이 멈췄다 돌아와도 tick을 몰아서 돌리지 않는다.
export class TickClock {
  private acc = 0;
  private last = performance.now();

  // 프레임마다 부르며, 이번 프레임의 경과 초와 tick 사이 보간 비율을 돌려준다.
  advance(onTick: () => void): { dtSec: number; alpha: number; now: number } {
    const now = performance.now();
    const dt = Math.min(now - this.last, 250);
    this.last = now;
    this.acc += dt;
    let n = 0;
    while (this.acc >= TICK_MS && n < MAX_CATCHUP_TICKS) {
      onTick();
      this.acc -= TICK_MS;
      n++;
    }
    if (n === MAX_CATCHUP_TICKS) this.acc = 0;
    return { dtSec: dt / 1000, alpha: this.acc / TICK_MS, now };
  }

  reset() {
    this.acc = 0;
  }
}

const WRONG_WAY_ANGLE = (120 * Math.PI) / 180;
const WRONG_WAY_MIN_SPEED = 1; // 타일/초
const WRONG_WAY_SEC = 1;
const WRONG_WAY_CLEAR_ANGLE = Math.PI / 2;
const WRONG_WAY_CLEAR_SEC = 0.5;

// 화면 표시용 역주행 판정이다. 서버 판정에는 영향이 없다.
export class WrongWay {
  private sec = 0;
  private okSec = 0;
  private shown = false;

  update(map: MapData, k: KartState, dtSec: number): boolean {
    const speed = Math.hypot(k.vx, k.vy);
    const diff = Math.abs(wrapAngle(Math.atan2(k.vy, k.vx) - trackDirection(map, k)));
    const moving = speed > WRONG_WAY_MIN_SPEED;
    if (this.shown) {
      const ok = k.finished || (moving && diff < WRONG_WAY_CLEAR_ANGLE);
      this.okSec = ok ? this.okSec + dtSec : 0;
      if (this.okSec > WRONG_WAY_CLEAR_SEC) this.shown = false;
    } else {
      const wrong = !k.finished && moving && diff > WRONG_WAY_ANGLE;
      this.sec = wrong ? this.sec + dtSec : Math.max(0, this.sec - dtSec);
      if (this.sec > WRONG_WAY_SEC) {
        this.shown = true;
        this.sec = 0;
        this.okSec = 0;
      }
    }
    return this.shown;
  }
}

export function countdownText(msLeft: number): string | null {
  return msLeft > 0 ? String(Math.ceil(msLeft / 1000)) : msLeft > -700 ? 'GO!' : null;
}

// 카트 상태를 받아 장면을 그리는 계층이다. 혼자 달리기와 멀티플레이 경주가 함께 쓴다.
export class RaceView {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(CAM.third.fov, 1, 0.05, 400);
  private models = new Map<string, KartModel>();
  private nextLayer = 0;
  private minimap: Minimap;
  private effects: Effects;
  private decor: DecorLayer;
  private resizeObserver: ResizeObserver;
  private view: ViewMode = loadView();
  private camYaw: number | null = null;
  private fov = CAM.third.fov;

  constructor(
    private host: HTMLElement,
    minimap: HTMLCanvasElement,
    private map: MapData,
    private onView: (view: ViewMode) => void,
  ) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x9fdcff);
    this.scene.fog = new THREE.Fog(0x9fdcff, 30, 90);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x7fd35b, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, 2, -1.5);
    this.scene.add(sun);
    this.scene.add(buildTrack(map, this.renderer));
    this.minimap = new Minimap(minimap, map);
    this.effects = new Effects(this.scene, map);
    this.decor = new DecorLayer(map);
    this.scene.add(this.decor.root);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    window.addEventListener('keydown', this.onKey);
    onView(this.view);
  }

  toggleView() {
    this.view = this.view === 'third' ? 'first' : 'third';
    try {
      localStorage.setItem(VIEW_KEY, this.view);
    } catch {
      // 저장하지 못해도 이번 경주에서는 전환된 시점을 쓴다.
    }
    this.onView(this.view);
  }

  // 다음 경주에서 카메라가 이전 방향에서 돌아 들어오지 않게 한다.
  resetCamera() {
    this.camYaw = null;
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyV' && !e.repeat) this.toggleView();
  };

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  // 반환값은 이번 프레임에 내 카트가 부딪혔는지이다.
  draw(karts: ViewKart[], meId: string, dtSec: number, now: number): boolean {
    let meHit = false;
    for (const k of karts) {
      let model = this.models.get(k.id);
      if (!model) {
        model = new KartModel(k.color, k.id === meId ? undefined : k.label, this.nextLayer++);
        this.models.set(k.id, model);
        this.scene.add(model.root);
      }
      const hit = model.update(k, now / 1000, dtSec, this.map);
      if (k.id === meId) meHit = hit;
      model.body.visible = k.id !== meId || this.view === 'third';
      this.effects.kart(k, hit, dtSec);
    }
    for (const [id, model] of this.models) {
      if (!karts.some((k) => k.id === id)) {
        model.dispose();
        this.models.delete(id);
      }
    }
    this.effects.update(dtSec);
    this.decor.update(now / 1000);

    const me = karts.find((k) => k.id === meId);
    if (me) this.followCamera(me, dtSec);
    this.renderer.render(this.scene, this.camera);
    this.minimap.draw(
      karts.map((k) => ({ ...k, color: '#' + k.color.toString(16).padStart(6, '0'), me: k.id === meId })),
    );
    return meHit;
  }

  private followCamera(me: ViewKart, dtSec: number) {
    const boostFov = me.boostLeft > 0 ? CAM.boostFov : 0;
    const ground = heightAt(this.map, me.x, me.y);
    if (this.view === 'third') {
      const follow = me.drifting ? CAM.driftYawFollow : CAM.yawFollow;
      this.camYaw ??= me.angle;
      this.camYaw += wrapAngle(me.angle - this.camYaw) * (1 - Math.exp(-follow * dtSec));
      const fx = Math.cos(this.camYaw), fz = Math.sin(this.camYaw);
      const c = CAM.third;
      // 시선이 수평에서 pitchDeg만큼 내려다보도록 카메라 높이를 정한다.
      const height = c.lookHeight + (c.back + c.lookAhead) * Math.tan((c.pitchDeg * Math.PI) / 180);
      this.camera.position.set(me.x - fx * c.back, ground + height, me.y - fz * c.back);
      this.camera.lookAt(me.x + fx * c.lookAhead, ground + c.lookHeight, me.y + fz * c.lookAhead);
      this.fov += (c.fov + boostFov - this.fov) * (1 - Math.exp(-6 * dtSec));
    } else {
      this.camYaw = me.angle;
      const fx = Math.cos(me.angle), fz = Math.sin(me.angle);
      const c = CAM.first;
      this.camera.position.set(me.x + fx * c.eyeForward, ground + c.eyeHeight, me.y + fz * c.eyeForward);
      this.camera.lookAt(me.x + fx * 10, ground + c.eyeHeight - 10 * Math.tan((c.pitchDeg * Math.PI) / 180), me.y + fz * 10);
      this.fov += (c.fov + boostFov - this.fov) * (1 - Math.exp(-6 * dtSec));
    }
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  destroy() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.onKey);
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
