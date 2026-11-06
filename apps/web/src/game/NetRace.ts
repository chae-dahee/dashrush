import {
  CORRECTION_SNAP,
  createKart,
  EXTRAPOLATE_MAX_MS,
  INTERP_DELAY_MS,
  stepKart,
  TEAM_POINTS,
  type KartSnapshot,
  type KartState,
  type MapData,
  type PlayerInfo,
  type RaceResultEntry,
  type Team,
} from '@dashrush/shared';
import { serverNow } from '../net/clock.ts';
import type { GameSocket } from '../net/socket.ts';
import { Keyboard } from './keyboard.ts';
import { countdownText, RaceView, TickClock, wrapAngle, WrongWay, type ViewMode } from './RaceView.ts';
import { submitRecord } from './records.ts';
import { RaceSound, sfx } from './sound.ts';
import type { ViewKart } from './scene.ts';

export interface NetHud {
  lap: number;
  rank: number;
  total: number;
  finishMs: number | null; // 서버가 기록한 내 완주 시간
  deadline: number | null; // 첫 완주 뒤 제한 시간이 끝나는 서버 시각
  red: number | null; // 팀전 실시간 팀 점수(현재 순위 기준 추정)
  blue: number | null;
}

export interface NetResult {
  ranking: RaceResultEntry[];
  teamScores?: Record<Team, number>;
  winner?: Team;
  record: ReturnType<typeof submitRecord> | null; // 내 개인 최고 기록 갱신 여부
}

interface Options {
  host: HTMLElement;
  minimap: HTMLCanvasElement;
  socket: GameSocket;
  map: MapData;
  laps: number;
  meId: string;
  players: PlayerInfo[];
  raceStartsAt: number; // 서버 시각
  onHud: (hud: NetHud) => void;
  onTime: (raceMs: number, limitLeftMs: number | null) => void;
  onGauge: (g: { gauge: number; boostLeft: number }) => void;
  onWrongWay: (wrongWay: boolean) => void;
  onCountdown: (text: string | null) => void;
  onView: (view: ViewMode) => void;
  onResult: (result: NetResult) => void;
}

interface Frame {
  t: number;
  karts: Map<string, KartSnapshot>;
}

const BUFFER_MS = 1000;
const OFFSET_DECAY = 10; // 보정 오프셋이 초당 줄어드는 비율

export class NetRace {
  private view: RaceView;
  private keyboard = new Keyboard();
  private clock = new TickClock();
  private players: PlayerInfo[];
  private frames: Frame[] = [];
  private hud: NetHud;
  private countdown: string | null = null;
  private sound = new RaceSound();
  private wrongWay = new WrongWay();
  private wasWrongWay = false;

  // 내 카트는 입력 즉시 shared 물리로 미리 움직이고, 스냅샷이 오면 서버 값에서 다시 계산한다.
  private pred: KartState;
  private prevPred: KartState;
  private pending: { seq: number; bits: number }[] = [];
  private seq = 0;
  private offset = { x: 0, y: 0, angle: 0 };

  constructor(private opts: Options) {
    this.players = opts.players;
    this.hud = { lap: 1, rank: 0, total: opts.players.length, finishMs: null, deadline: null, red: null, blue: null };
    const me = opts.players.find((p) => p.id === opts.meId)!;
    this.pred = this.prevPred = createKart(opts.map.grid[me.gridSlot]);
    this.view = new RaceView(opts.host, opts.minimap, opts.map, opts.onView);
    opts.socket.on('race:snapshot', this.onSnapshot);
    opts.socket.on('race:finish', this.onFinish);
    opts.socket.on('race:result', this.onResult);
    opts.onHud(this.hud);
    this.view.renderer.setAnimationLoop(() => this.frame());
  }

  setPlayers(players: PlayerInfo[]) {
    this.players = players;
  }

  toggleView() {
    this.view.toggleView();
  }

  private setHud(patch: Partial<NetHud>) {
    if (Object.entries(patch).every(([k, v]) => this.hud[k as keyof NetHud] === v)) return;
    this.hud = { ...this.hud, ...patch };
    this.opts.onHud(this.hud);
  }

  private onSnapshot = (s: { serverTime: number; karts: KartSnapshot[] }) => {
    this.frames.push({ t: s.serverTime, karts: new Map(s.karts.map((k) => [k.id, k])) });
    while (this.frames.length > 2 && this.frames[0].t < s.serverTime - BUFFER_MS) this.frames.shift();

    const me = s.karts.find((k) => k.id === this.opts.meId);
    if (!me) return;
    if (me.lap > this.hud.lap - 1 && me.lap < this.opts.laps) sfx.lap();
    this.setHud({ lap: Math.min(me.lap + 1, this.opts.laps), rank: me.rank, total: s.karts.length, ...this.teamScores(s.karts) });
    this.reconcile(me);
  };

  private teamScores(karts: KartSnapshot[]) {
    const scores = { red: null as number | null, blue: null as number | null };
    for (const k of karts) {
      const team = this.players.find((p) => p.id === k.id)?.team;
      if (team) scores[team] = (scores[team] ?? 0) + (TEAM_POINTS[k.rank - 1] ?? 0);
    }
    return scores;
  }

  private onFinish = (f: { userId: string; timeMs: number; deadline?: number }) => {
    if (f.deadline) this.setHud({ deadline: f.deadline });
    if (f.userId === this.opts.meId) {
      sfx.finish();
      this.setHud({ finishMs: f.timeMs });
    }
  };

  private onResult = (r: Omit<NetResult, 'record'>) => {
    const mine = r.ranking.find((e) => e.id === this.opts.meId);
    const record = mine ? submitRecord(this.opts.map.id, this.opts.laps, mine.timeMs, mine.bestLapMs) : null;
    this.opts.onResult({ ...r, record });
  };

  // 서버 상태에서 아직 적용되지 않은 입력을 다시 적용하고, 그 차이는 화면 오프셋으로 흡수한다.
  private reconcile(s: KartSnapshot) {
    // 완주 뒤의 주행은 판정에 영향이 없으므로 보정하지 않아 결승선 뒤로 되돌아가는 모습을 막는다.
    if (this.pred.finished) return;
    this.pending = this.pending.filter((i) => i.seq > s.lastSeq);
    let k: KartState = {
      x: s.x,
      y: s.y,
      angle: s.angle,
      vx: s.vx,
      vy: s.vy,
      drifting: s.drifting,
      driftSlip: s.driftSlip,
      gauge: s.gauge,
      sinceHit: s.sinceHit,
      boostHeld: s.boostHeld,
      boostLeft: s.boostLeft,
      lap: s.lap,
      cp: s.checkpoint,
      finished: s.lap >= this.opts.laps,
      fallLeft: s.fallLeft,
      spawnLeft: s.spawnLeft,
    };
    for (const i of this.pending) k = stepKart(k, i.bits, this.opts.map, this.opts.laps).kart;

    const dx = this.pred.x - k.x, dy = this.pred.y - k.y, da = wrapAngle(this.pred.angle - k.angle);
    if (Math.hypot(dx, dy) > CORRECTION_SNAP) {
      this.offset = { x: 0, y: 0, angle: 0 };
      this.prevPred = k;
    } else {
      this.offset = { x: this.offset.x + dx, y: this.offset.y + dy, angle: this.offset.angle + da };
      this.prevPred = { ...this.prevPred, x: this.prevPred.x - dx, y: this.prevPred.y - dy, angle: this.prevPred.angle - da };
    }
    this.pred = k;
  }

  private tick() {
    if (serverNow() < this.opts.raceStartsAt) return;
    let bits = 0;
    if (!this.pred.finished) {
      bits = this.keyboard.bits();
      this.seq++;
      this.opts.socket.emit('race:input', { seq: this.seq, bits });
      this.pending.push({ seq: this.seq, bits });
    }
    this.prevPred = this.pred;
    this.pred = stepKart(this.pred, bits, this.opts.map, this.opts.laps).kart;
  }

  private frame() {
    const { dtSec, alpha, now } = this.clock.advance(() => this.tick());
    const decay = Math.exp(-OFFSET_DECAY * dtSec);
    this.offset = { x: this.offset.x * decay, y: this.offset.y * decay, angle: this.offset.angle * decay };

    const sNow = serverNow();
    const renderAt = sNow - INTERP_DELAY_MS;
    const karts = this.players.map((p) => (p.id === this.opts.meId ? this.predicted(p, alpha) : this.sample(p, renderAt)));
    const hit = this.view.draw(karts, this.opts.meId, dtSec, now);
    const me = karts.find((k) => k.id === this.opts.meId)!;
    this.sound.frame(me, hit);
    this.opts.onGauge(this.pred);
    const wrongWay = this.wrongWay.update(this.opts.map, this.pred, dtSec);
    if (wrongWay !== this.wasWrongWay) this.opts.onWrongWay((this.wasWrongWay = wrongWay));
    this.sound.otherEngines(
      karts
        .filter((k) => k.id !== me.id && !k.ghost)
        .map((k) => ({ id: k.id, speed: k.speed, dist: Math.hypot(k.x - me.x, k.y - me.y) })),
    );

    const text = countdownText(this.opts.raceStartsAt - sNow);
    if (text !== this.countdown) {
      this.countdown = text;
      this.opts.onCountdown(text);
      this.sound.countdown(text);
    }
    const { finishMs, deadline } = this.hud;
    this.opts.onTime(
      finishMs ?? Math.max(0, sNow - this.opts.raceStartsAt),
      deadline !== null && finishMs === null ? Math.max(0, deadline - sNow) : null,
    );
  }

  private predicted(p: PlayerInfo, alpha: number): ViewKart {
    const a = this.prevPred, b = this.pred;
    return {
      id: p.id,
      color: p.color,
      x: a.x + (b.x - a.x) * alpha + this.offset.x,
      y: a.y + (b.y - a.y) * alpha + this.offset.y,
      angle: a.angle + wrapAngle(b.angle - a.angle) * alpha + this.offset.angle,
      drifting: b.drifting,
      driftSlip: b.driftSlip,
      boostLeft: b.boostLeft,
      speed: Math.hypot(b.vx, b.vy),
      ghost: false,
      fallLeft: b.fallLeft,
      spawnLeft: b.spawnLeft,
    };
  }

  // renderAt을 사이에 두는 두 스냅샷을 보간한다. 다음 스냅샷이 없으면 마지막 속도로 잠시 외삽한다.
  private sample(p: PlayerInfo, renderAt: number): ViewKart {
    const base = { id: p.id, color: p.color, label: p.nickname };
    const frames = this.frames.filter((f) => f.karts.has(p.id));
    if (frames.length === 0) {
      const k = createKart(this.opts.map.grid[p.gridSlot]);
      return { ...base, x: k.x, y: k.y, angle: k.angle, drifting: false, driftSlip: 0, boostLeft: 0, speed: 0, ghost: !p.connected, fallLeft: 0, spawnLeft: 0 };
    }

    let i = frames.length - 1;
    while (i > 0 && frames[i].t > renderAt) i--;
    const a = frames[i].karts.get(p.id)!;
    const next = frames[i + 1];
    if (next && frames[i].t <= renderAt) {
      const b = next.karts.get(p.id)!;
      const u = (renderAt - frames[i].t) / (next.t - frames[i].t);
      return {
        ...base,
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        angle: a.angle + wrapAngle(b.angle - a.angle) * u,
        drifting: b.drifting,
        driftSlip: b.driftSlip,
        boostLeft: b.boostLeft,
        speed: Math.hypot(b.vx, b.vy),
        ghost: b.ghost,
        fallLeft: b.fallLeft,
        spawnLeft: b.spawnLeft,
      };
    }
    const ahead = Math.min(Math.max(renderAt - frames[i].t, 0), EXTRAPOLATE_MAX_MS) / 1000;
    return {
      ...base,
      x: a.x + a.vx * ahead,
      y: a.y + a.vy * ahead,
      angle: a.angle,
      drifting: a.drifting,
      driftSlip: a.driftSlip,
      boostLeft: a.boostLeft,
      speed: Math.hypot(a.vx, a.vy),
      ghost: a.ghost,
      fallLeft: a.fallLeft,
      spawnLeft: a.spawnLeft,
    };
  }

  destroy() {
    this.sound.stop();
    this.opts.socket.off('race:snapshot', this.onSnapshot);
    this.opts.socket.off('race:finish', this.onFinish);
    this.opts.socket.off('race:result', this.onResult);
    this.keyboard.dispose();
    this.view.destroy();
  }
}
