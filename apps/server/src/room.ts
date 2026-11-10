import type { Server, Socket } from 'socket.io';
import {
  botInput,
  collideKarts,
  COUNTDOWN_MS,
  createKart,
  DISCONNECT_GRACE_MS,
  FINISH_LIMIT_MS,
  finishInput,
  INPUT_MAX,
  INPUT_QUEUE_MAX,
  INPUT_STALE_TICKS,
  KART_COLORS,
  LAPS_MAX,
  LAPS_MIN,
  MAPS,
  MAX_PLAYERS,
  progress,
  QUICK_START_MS,
  RESULTS_MS,
  ROOM_CODE_CHARS,
  ROOM_CODE_LEN,
  stepKart,
  TEAM_COLORS,
  TEAM_POINTS,
  TEAM_SIZE_MAX,
  TICK_MS,
  type ClientToServerEvents,
  type KartSnapshot,
  type KartState,
  type RaceResultEntry,
  type RoomErrorCode,
  type RoomMode,
  type RoomState,
  type RoomStatus,
  type ServerToClientEvents,
  type SocketData,
  type Team,
} from '@dashrush/shared';
import { delayed } from './env.ts';

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type Config = { mode: RoomMode; mapId: string; laps: number };

const MAX_CATCHUP_TICKS = 5;

interface Player {
  id: string;
  nickname: string;
  socketId: string | null; // 봇과 끊긴 사람은 null이다.
  gridSlot: number;
  team: Team | null;
  bot: boolean;
  connected: boolean;
  grace: NodeJS.Timeout | null; // 끊긴 사람의 유예 타이머
  ready: boolean;
  wins: number;
}

interface Racer {
  id: string;
  nickname: string;
  team: Team | null;
  bot: boolean;
  kart: KartState;
  queue: { seq: number; bits: number }[];
  lastSeq: number;
  appliedSeq: number;
  bits: number;
  idleTicks: number;
  lapStartMs: number;
  bestLapMs: number | null;
  finishMs: number | null; // 출발부터 결승선 통과까지의 경주 시간
  ghost: boolean; // 끊긴 동안은 중립 입력이고 다른 카트와 부딪히지 않는다.
  left: boolean; // 경주 중 나가면 결과에 DNF로 남긴다.
}

export class RoomError extends Error {
  constructor(readonly code: RoomErrorCode, message: string) {
    super(message);
  }
}

const rooms = new Map<string, Room>();
const userRoom = new Map<string, Room>();

export const roomOf = (userId: string) => userRoom.get(userId);

function newCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LEN; i++) code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

export function validConfig(p: unknown): p is Config {
  const c = p as { mode?: unknown; mapId?: unknown; laps?: unknown } | null;
  return (
    !!c &&
    (c.mode === 'race' || c.mode === 'team') &&
    typeof c.mapId === 'string' &&
    c.mapId in MAPS &&
    Number.isInteger(c.laps) &&
    (c.laps as number) >= LAPS_MIN &&
    (c.laps as number) <= LAPS_MAX
  );
}

export function createRoom(io: GameServer, config: Config, publicSize: number | null = null): Room {
  const room = new Room(io, newCode(), config, publicSize);
  rooms.set(room.code, room);
  return room;
}

export function findRoom(code: unknown): Room {
  const room = typeof code === 'string' ? rooms.get(code.trim().toUpperCase()) : undefined;
  if (!room) throw new RoomError('NOT_FOUND', '방을 찾을 수 없습니다.');
  return room;
}

export function quickMatch(io: GameServer, socket: GameSocket, size: number) {
  const current = userRoom.get(socket.data.userId);
  if (current) return current.join(socket);
  const open = [...rooms.values()]
    .filter((r) => r.publicSize === size && r.status === 'waiting' && r.size < size)
    .sort((a, b) => b.size - a.size);
  const ids = Object.keys(MAPS);
  const map = MAPS[ids[Math.floor(Math.random() * ids.length)]];
  (open[0] ?? createRoom(io, { mode: 'race', mapId: map.id, laps: map.laps }, size)).join(socket);
}

export class Room {
  status: RoomStatus = 'waiting';
  private hostId: string | null = null;
  private players: Player[] = [];
  private racers = new Map<string, Racer>();
  private raceStartsAt: number | null = null;
  private startTimerEndsAt: number | null = null;
  private deadline: number | null = null; // 첫 완주 뒤 제한 시간이 끝나는 서버 시각
  private tick = 0;
  private botSeq = 0;
  private timer: NodeJS.Timeout | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  private loop: NodeJS.Timeout | null = null;
  private mode: RoomMode;
  private mapId: string;
  private laps: number;

  constructor(
    private io: GameServer,
    readonly code: string,
    config: Config,
    readonly publicSize: number | null,
  ) {
    this.mode = config.mode;
    this.mapId = config.mapId;
    this.laps = config.laps;
  }

  get isPublic() {
    return this.publicSize !== null;
  }

  get size() {
    return this.players.length;
  }

  private humans() {
    return this.players.filter((p) => !p.bot);
  }

  join(socket: GameSocket) {
    const { userId, nickname } = socket.data;
    const existing = this.players.find((p) => p.id === userId);
    if (existing) return this.reconnect(existing, socket);

    if (this.status !== 'waiting') throw new RoomError('RACING', '경주 중인 방입니다.');
    if (this.players.length >= (this.publicSize ?? MAX_PLAYERS)) throw new RoomError('FULL', '방이 가득 찼습니다.');
    userRoom.get(userId)?.leave(userId);
    this.players.push(this.newPlayer(userId, nickname, socket.id, false));
    if (!this.isPublic) this.hostId ??= userId;
    userRoom.set(userId, this);
    socket.join(this.code);
    this.broadcast();
    this.updateStartTimer();
  }

  private newPlayer(id: string, nickname: string, socketId: string | null, bot: boolean): Player {
    const used = new Set(this.players.map((p) => p.gridSlot));
    let slot = 0;
    while (used.has(slot)) slot++;
    return {
      id,
      nickname,
      socketId,
      gridSlot: slot,
      team: this.nextTeam(),
      bot,
      connected: true,
      grace: null,
      ready: bot,
      wins: 0,
    };
  }

  // 새로고침·새 탭·네트워크 복구로 같은 사용자가 다시 들어오면 자리를 유지하고 소켓만 바꾼다.
  private reconnect(player: Player, socket: GameSocket) {
    if (player.grace) clearTimeout(player.grace);
    player.grace = null;
    if (player.socketId && player.socketId !== socket.id) this.io.sockets.sockets.get(player.socketId)?.leave(this.code);
    const wasConnected = player.connected;
    player.socketId = socket.id;
    player.connected = true;

    const racer = this.racers.get(player.id);
    if (racer && !racer.left) {
      // 새 연결의 sequence는 1부터 다시 시작한다.
      Object.assign(racer, { ghost: false, queue: [], lastSeq: 0, appliedSeq: 0, bits: 0 });
    }
    socket.join(this.code);
    if (!wasConnected) delayed(() => this.io.to(this.code).emit('player:reconnected', { userId: player.id }));
    this.broadcast();
  }

  disconnect(userId: string, socketId: string) {
    const player = this.players.find((p) => p.id === userId);
    // 이미 새 소켓으로 들어온 뒤 옛 소켓의 끊김이 늦게 오면 무시한다.
    if (!player || player.socketId !== socketId) return;
    if (this.status === 'waiting') return this.leave(userId);

    player.connected = false;
    player.socketId = null;
    const racer = this.racers.get(userId);
    if (racer) racer.ghost = true;
    player.grace = setTimeout(() => this.leave(userId), DISCONNECT_GRACE_MS);
    delayed(() => this.io.to(this.code).emit('player:disconnected', { userId, graceMs: DISCONNECT_GRACE_MS }));
    this.broadcast();
  }

  leave(userId: string) {
    const player = this.players.find((p) => p.id === userId);
    if (!player) return;
    if (player.grace) clearTimeout(player.grace);
    this.players = this.players.filter((p) => p !== player);
    if (player.socketId) this.io.sockets.sockets.get(player.socketId)?.leave(this.code);
    if (userRoom.get(userId) === this) userRoom.delete(userId);
    const racer = this.racers.get(userId);
    if (racer) racer.left = true;

    if (this.humans().length === 0) return this.dispose();
    if (this.hostId === userId) this.hostId = this.humans()[0].id;
    if (this.status === 'countdown' || this.status === 'racing') this.checkRaceEnd();
    this.broadcast();
    this.updateStartTimer();
  }

  config(userId: string, config: Config) {
    this.requireHostWaiting(userId);
    const modeChanged = config.mode !== this.mode;
    this.mode = config.mode;
    this.mapId = config.mapId;
    this.laps = config.laps;
    if (modeChanged) {
      this.players.forEach((p, i) => (p.team = this.mode === 'team' ? (i % 2 === 0 ? 'red' : 'blue') : null));
    }
    this.broadcast();
  }

  setTeam(userId: string, team: Team) {
    if (this.mode !== 'team' || this.status !== 'waiting') throw new RoomError('INVALID', '팀전 대기 중에만 팀을 바꿀 수 있습니다.');
    const player = this.players.find((p) => p.id === userId)!;
    if (player.team === team) return;
    if (this.teamCount(team) >= TEAM_SIZE_MAX) throw new RoomError('FULL', '팀이 가득 찼습니다.');
    player.team = team;
    this.broadcast();
  }

  addBot(userId: string) {
    this.requireHostWaiting(userId);
    if (this.players.length >= MAX_PLAYERS) throw new RoomError('FULL', '방이 가득 찼습니다.');
    const n = ++this.botSeq;
    this.players.push(this.newPlayer(`bot:${n}`, `봇 ${n}`, null, true));
    this.broadcast();
  }

  removeBot(userId: string, botId: string) {
    this.requireHostWaiting(userId);
    this.players = this.players.filter((p) => !(p.bot && p.id === botId));
    this.broadcast();
  }

  setReady(userId: string, ready: boolean) {
    if (this.status !== 'waiting' || userId === this.hostId) return;
    const player = this.players.find((p) => p.id === userId);
    if (!player || player.ready === ready) return;
    player.ready = ready;
    this.broadcast();
    this.updateStartTimer();
  }

  start(userId: string) {
    this.requireHostWaiting(userId);
    if (this.players.length < 2) throw new RoomError('INVALID', '2명 이상이어야 시작할 수 있습니다.');
    if (this.players.some((p) => p.id !== this.hostId && !p.ready)) {
      throw new RoomError('INVALID', '모두 준비해야 시작할 수 있습니다.');
    }
    if (this.mode === 'team') {
      const red = this.teamCount('red'), blue = this.teamCount('blue');
      if (red !== blue || red < 2) throw new RoomError('INVALID', '두 팀 인원이 같고 팀당 2명 이상이어야 합니다.');
    }
    this.beginCountdown();
  }

  input(userId: string, socketId: string, p: unknown) {
    if (this.status !== 'racing') return;
    const racer = this.racers.get(userId);
    const i = p as { seq?: unknown; bits?: unknown } | null;
    if (!this.players.some((pl) => pl.id === userId && pl.socketId === socketId)) return;
    // 형식이 어긋난 입력은 오류 응답 없이 버린다.
    if (!racer || racer.left || !i || !Number.isInteger(i.seq) || !Number.isInteger(i.bits)) return;
    const seq = i.seq as number, bits = i.bits as number;
    if (seq <= racer.lastSeq || bits < 0 || bits > INPUT_MAX) return;
    racer.lastSeq = seq;
    racer.queue.push({ seq, bits });
    if (racer.queue.length > INPUT_QUEUE_MAX) racer.queue.shift();
  }

  private teamCount(team: Team) {
    return this.players.filter((p) => p.team === team).length;
  }

  private nextTeam(): Team | null {
    if (this.mode !== 'team') return null;
    return this.teamCount('red') <= this.teamCount('blue') ? 'red' : 'blue';
  }

  private requireHostWaiting(userId: string) {
    if (this.hostId !== userId) throw new RoomError('FORBIDDEN', '방장만 할 수 있습니다.');
    if (this.status !== 'waiting') throw new RoomError('RACING', '대기 중에만 할 수 있습니다.');
  }

  private updateStartTimer() {
    if (!this.isPublic || this.status !== 'waiting') return;
    const humans = this.humans();
    if (humans.length > 0 && humans.every((p) => p.ready)) return this.beginCountdown();
    const anyReady = humans.some((p) => p.ready);
    if (anyReady && !this.startTimer) {
      this.startTimerEndsAt = Date.now() + QUICK_START_MS;
      this.startTimer = setTimeout(() => this.beginCountdown(), QUICK_START_MS);
      this.broadcast();
    } else if (!anyReady && this.startTimer) {
      this.clearStartTimer();
      this.broadcast();
    }
  }

  private clearStartTimer() {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
    this.startTimerEndsAt = null;
  }

  private beginCountdown() {
    this.clearStartTimer();
    while (this.publicSize !== null && this.players.length < this.publicSize) {
      const n = ++this.botSeq;
      this.players.push(this.newPlayer(`bot:${n}`, `봇 ${n}`, null, true));
    }
    const map = MAPS[this.mapId];
    this.racers = new Map(
      this.players.map((p) => [
        p.id,
        {
          id: p.id,
          nickname: p.nickname,
          team: p.team,
          bot: p.bot,
          kart: createKart(map.grid[p.gridSlot]),
          queue: [],
          lastSeq: 0,
          appliedSeq: 0,
          bits: 0,
          idleTicks: 0,
          lapStartMs: 0,
          bestLapMs: null,
          finishMs: null,
          ghost: !p.connected,
          left: false,
        },
      ]),
    );
    this.status = 'countdown';
    this.deadline = null;
    this.raceStartsAt = Date.now() + COUNTDOWN_MS;
    this.timer = setTimeout(() => this.startRacing(), COUNTDOWN_MS);
    this.broadcast();
  }

  private startRacing() {
    this.status = 'racing';
    this.tick = 0;
    this.broadcast();

    // 실제 경과 시간만큼 고정 길이 tick을 돌린다.
    let last = performance.now();
    let acc = 0;
    this.loop = setInterval(() => {
      const now = performance.now();
      acc += now - last;
      last = now;
      let n = 0;
      while (acc >= TICK_MS && n < MAX_CATCHUP_TICKS && this.status === 'racing') {
        this.step();
        acc -= TICK_MS;
        n++;
      }
      if (n === MAX_CATCHUP_TICKS) acc = 0;
    }, TICK_MS / 2);
  }

  private step() {
    this.tick++;
    const map = MAPS[this.mapId];
    const active = [...this.racers.values()].filter((r) => !r.left);

    for (const r of active) {
      if (r.bot) {
        r.bits = botInput(r.kart, map, Number(r.id.slice('bot:'.length)));
      } else {
        const next = r.queue.shift();
        if (next) {
          r.bits = next.bits;
          r.appliedSeq = next.seq;
          r.idleTicks = 0;
        } else if (++r.idleTicks > INPUT_STALE_TICKS) {
          r.bits = 0;
        }
      }
      const prev = r.kart;
      const bits = r.ghost ? 0 : prev.finished ? finishInput(prev, map) : r.bits;
      const { kart, passed, crossFrac } = stepKart(prev, bits, map, this.laps);
      r.kart = kart;
      if (passed === 0 && kart.lap > prev.lap) this.onLap(r, (this.tick - 1 + crossFrac) * TICK_MS);
    }

    // 완주한 카트, 끊긴 카트, 바다에 빠졌거나 막 복귀한 카트는 충돌에서 뺀다.
    const colliding = active.filter((r) => !r.kart.finished && !r.ghost && r.kart.fallLeft === 0 && r.kart.spawnLeft === 0);
    for (let i = 0; i < colliding.length; i++) {
      for (let j = i + 1; j < colliding.length; j++) collideKarts(colliding[i].kart, colliding[j].kart);
    }

    const r2 = (v: number) => Math.round(v * 100) / 100;
    const karts: KartSnapshot[] = this.ranked()
      .filter((r) => !r.left)
      .map((r, i) => ({
        id: r.id,
        x: r2(r.kart.x),
        y: r2(r.kart.y),
        angle: Math.round(r.kart.angle * 1000) / 1000,
        vx: r2(r.kart.vx),
        vy: r2(r.kart.vy),
        drifting: r.kart.drifting,
        driftSlip: r2(r.kart.driftSlip),
        gauge: r2(r.kart.gauge),
        sinceHit: r2(r.kart.sinceHit),
        boostHeld: r.kart.boostHeld,
        offroadSec: r2(r.kart.offroadSec),
        startLeft: r2(r.kart.startLeft),
        boostLeft: r2(r.kart.boostLeft),
        fallLeft: r2(r.kart.fallLeft),
        spawnLeft: r2(r.kart.spawnLeft),
        lap: r.kart.lap,
        checkpoint: r.kart.cp,
        rank: i + 1,
        ghost: r.ghost || r.kart.finished,
        lastSeq: r.appliedSeq,
      }));
    const snapshot = { tick: this.tick, serverTime: Date.now(), karts };
    delayed(() => this.io.to(this.code).emit('race:snapshot', snapshot));
    this.checkRaceEnd();
  }

  private onLap(r: Racer, crossMs: number) {
    const lapMs = crossMs - r.lapStartMs;
    r.lapStartMs = crossMs;
    r.bestLapMs = r.bestLapMs === null ? lapMs : Math.min(r.bestLapMs, lapMs);
    if (!r.kart.finished) return;

    r.finishMs = crossMs;
    const first = this.deadline === null;
    if (first) this.deadline = Date.now() + FINISH_LIMIT_MS;
    const finish = {
      userId: r.id,
      rank: this.ranked().indexOf(r) + 1,
      timeMs: crossMs,
      ...(first && { deadline: this.deadline! }),
    };
    delayed(() => this.io.to(this.code).emit('race:finish', finish));
  }

  // 완주자는 완주 시각 순, 나머지는 진행도 순이며, 경주 중 나간 사람은 맨 뒤이다.
  private ranked(): Racer[] {
    const map = MAPS[this.mapId];
    const key = (r: Racer) => (r.left ? 2 : r.finishMs !== null ? 0 : 1);
    return [...this.racers.values()].sort((a, b) => {
      if (key(a) !== key(b)) return key(a) - key(b);
      if (a.finishMs !== null && b.finishMs !== null) return a.finishMs - b.finishMs;
      return progress(map, b.kart) - progress(map, a.kart);
    });
  }

  private checkRaceEnd() {
    const racers = [...this.racers.values()];
    const done = racers.every((r) => r.left || r.kart.finished);
    const timeUp = this.deadline !== null && Date.now() >= this.deadline;
    if (!done && !timeUp) return;

    this.stopTimers();
    const ranked = this.ranked();
    const team = this.mode === 'team';
    const ranking: RaceResultEntry[] = ranked.map((r, i) => ({
      id: r.id,
      nickname: r.nickname,
      timeMs: r.finishMs,
      bestLapMs: r.bestLapMs,
      ...(team && { points: r.finishMs === null ? 0 : TEAM_POINTS[i] }),
    }));

    const winnerId = ranked[0]?.finishMs !== null ? ranked[0]?.id : undefined;
    const winner = this.players.find((p) => p.id === winnerId);
    if (winner) winner.wins++;

    let teamResult = {};
    if (team) {
      const teamScores = { red: 0, blue: 0 };
      ranked.forEach((r, i) => r.team && (teamScores[r.team] += ranking[i].points ?? 0));
      // 동점이면 1위를 낸 팀이 이긴다.
      const winnerTeam =
        teamScores.red !== teamScores.blue
          ? teamScores.red > teamScores.blue ? 'red' : 'blue'
          : (ranked[0]?.finishMs !== null ? ranked[0]?.team : null) ?? undefined;
      teamResult = { teamScores, ...(winnerTeam && { winner: winnerTeam }) };
    }

    this.status = 'results';
    this.timer = setTimeout(() => this.toWaiting(), RESULTS_MS);
    // 결과 화면이 상태 전환과 함께 순위를 그릴 수 있도록 결과를 먼저 보낸다.
    delayed(() => this.io.to(this.code).emit('race:result', { ranking, ...teamResult }));
    this.broadcast();
  }

  private toWaiting() {
    this.stopTimers();
    this.status = 'waiting';
    this.racers.clear();
    this.raceStartsAt = null;
    this.deadline = null;
    if (this.isPublic) this.players = this.players.filter((p) => !p.bot);
    for (const p of this.players) p.ready = p.bot;
    for (const p of this.players.filter((p) => !p.bot && !p.connected)) this.leave(p.id);
    if (rooms.get(this.code) !== this) return;
    this.broadcast();
    this.updateStartTimer();
  }

  private stopTimers() {
    if (this.timer) clearTimeout(this.timer);
    if (this.loop) clearInterval(this.loop);
    this.timer = this.loop = null;
  }

  private dispose() {
    this.stopTimers();
    this.clearStartTimer();
    for (const p of this.players) if (p.grace) clearTimeout(p.grace);
    rooms.delete(this.code);
  }

  state(): RoomState {
    const teamIndex = { red: 0, blue: 0 };
    return {
      code: this.code,
      isPublic: this.isPublic,
      publicSize: this.publicSize,
      mode: this.mode,
      status: this.status,
      hostId: this.hostId,
      mapId: this.mapId,
      laps: this.laps,
      players: this.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        gridSlot: p.gridSlot,
        color: p.team ? TEAM_COLORS[p.team][teamIndex[p.team]++] : KART_COLORS[p.gridSlot],
        team: p.team,
        connected: p.connected,
        bot: p.bot,
        ready: p.ready,
        wins: p.wins,
      })),
      startTimerEndsAt: this.startTimerEndsAt,
      raceStartsAt: this.raceStartsAt,
    };
  }

  private broadcast() {
    const state = this.state();
    delayed(() => this.io.to(this.code).emit('room:state', state));
  }
}
