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
import { countdownText, RaceView, TickClock, wrapAngle, WrongWay, type ViewMode } from './RaceView.ts';
import { submitRecord } from './records.ts';
import { RaceSound, sfx } from './sound.ts';

export interface RaceHud {
  lap: number;
  laps: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  finishedMs: number | null;
  record?: ReturnType<typeof submitRecord>; // 완주 때 개인 최고 기록 갱신 여부
}

interface Options {
  host: HTMLElement;
  minimap: HTMLCanvasElement;
  map: MapData;
  laps: number;
  color: number;
  onHud: (hud: RaceHud) => void;
  onTime: (ms: number) => void;
  onGauge: (g: { drifting: boolean; driftCharge: number; boostLeft: number }) => void;
  onWrongWay: (wrongWay: boolean) => void;
  onCountdown: (text: string | null) => void;
  onView: (view: ViewMode) => void;
}

const ME = 'me';

// 서버 없이 혼자 달리는 경주이다.
export class LocalRace {
  private view: RaceView;
  private keyboard = new Keyboard();
  private clock = new TickClock();
  private sound = new RaceSound();
  private wrongWay = new WrongWay();
  private wasWrongWay = false;
  private prev: KartState;
  private kart: KartState;
  private startAt = 0; // performance.now() 기준 출발 시각
  private raceTicks = 0;
  private lapStartMs = 0;
  private hud!: RaceHud;
  private countdown: string | null = null;

  constructor(private opts: Options) {
    const errors = validateMap(opts.map);
    if (errors.length) throw new Error(errors.join('\n'));
    this.view = new RaceView(opts.host, opts.minimap, opts.map, opts.onView);
    this.kart = createKart(opts.map.grid[0]);
    this.prev = this.kart;
    this.restart();
    this.view.renderer.setAnimationLoop(() => this.frame());
  }

  restart() {
    this.kart = createKart(this.opts.map.grid[0]);
    this.prev = this.kart;
    this.clock.reset();
    this.raceTicks = 0;
    this.lapStartMs = 0;
    this.view.resetCamera();
    this.startAt = performance.now() + COUNTDOWN_MS;
    this.hud = { lap: 1, laps: this.opts.laps, lastLapMs: null, bestLapMs: null, finishedMs: null };
    this.opts.onHud(this.hud);
    this.opts.onTime(0);
  }

  toggleView() {
    this.view.toggleView();
  }

  private frame() {
    const { dtSec, alpha, now } = this.clock.advance(() => this.tick());
    const p = this.prev, k = this.kart;
    const me = {
      id: ME,
      x: p.x + (k.x - p.x) * alpha,
      y: p.y + (k.y - p.y) * alpha,
      angle: p.angle + wrapAngle(k.angle - p.angle) * alpha,
      color: this.opts.color,
      drifting: k.drifting,
      driftCharge: k.driftCharge,
      boostLeft: k.boostLeft,
      speed: Math.hypot(k.vx, k.vy),
      ghost: false,
    };
    const hit = this.view.draw([me], ME, dtSec, now);
    this.sound.frame(me, hit);
    this.opts.onGauge(me);
    const wrongWay = this.wrongWay.update(this.opts.map, k, dtSec);
    if (wrongWay !== this.wasWrongWay) this.opts.onWrongWay((this.wasWrongWay = wrongWay));

    const text = countdownText(this.startAt - now);
    if (text !== this.countdown) {
      this.countdown = text;
      this.opts.onCountdown(text);
      this.sound.countdown(text);
    }
    if (this.hud.finishedMs === null) this.opts.onTime(this.raceTicks * TICK_MS);
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
      if (kart.finished) {
        sfx.finish();
        this.hud.record = submitRecord(this.opts.map.id, this.opts.laps, crossMs, this.hud.bestLapMs);
      } else {
        sfx.lap();
      }
      this.opts.onHud(this.hud);
    }
  }

  destroy() {
    this.sound.stop();
    this.keyboard.dispose();
    this.view.destroy();
  }
}
