// 시각 값은 모두 서버 기준 epoch 밀리초이다.

export type RoomMode = 'race' | 'team';
export type Team = 'red' | 'blue';
export type RoomStatus = 'waiting' | 'countdown' | 'racing' | 'results';

export interface PlayerInfo {
  id: string;
  nickname: string;
  gridSlot: number;
  color: number;
  team: Team | null;
  connected: boolean;
  bot: boolean;
  ready: boolean; // 봇은 항상 true이고, 비공개 방 방장은 쓰지 않는다.
  wins: number; // 이 방에서 1등 한 횟수이며, 방이 해산되면 사라진다.
}

export interface RoomState {
  code: string;
  isPublic: boolean;
  publicSize: number | null;
  mode: RoomMode;
  status: RoomStatus;
  hostId: string | null;
  mapId: string;
  laps: number;
  players: PlayerInfo[];
  startTimerEndsAt: number | null;
  raceStartsAt: number | null;
}

export type RoomErrorCode = 'NOT_FOUND' | 'FULL' | 'RACING' | 'FORBIDDEN' | 'INVALID';

export interface KartSnapshot {
  id: string;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  drifting: boolean;
  // 아래 다섯 값은 내 카트 예측을 서버 값에서 다시 계산할 때 필요하다.
  driftSlip: number;
  gauge: number;
  sinceHit: number;
  boostHeld: boolean;
  offroadSec: number;
  boostLeft: number;
  fallLeft: number;
  spawnLeft: number;
  lap: number;
  checkpoint: number;
  rank: number;
  ghost: boolean;
  lastSeq: number;
}

export interface RaceResultEntry {
  id: string;
  nickname: string;
  timeMs: number | null; // null이면 DNF이다.
  bestLapMs: number | null;
  points?: number;
}

export interface ClientToServerEvents {
  'room:create': (p: { mode: RoomMode; mapId: string; laps: number }) => void;
  'room:join': (p: { code: string }) => void;
  'room:quickMatch': (p: { size: number }) => void;
  'room:ready': (p: { ready: boolean }) => void;
  'room:leave': () => void;
  'room:config': (p: { mode: RoomMode; mapId: string; laps: number }) => void;
  'room:team': (p: { team: Team }) => void;
  'room:bot': (p: { action: 'add' } | { action: 'remove'; botId: string }) => void;
  'room:start': () => void;
  'race:input': (p: { seq: number; bits: number }) => void;
  'time:ping': (clientTime: number) => void;
}

export interface ServerToClientEvents {
  'room:state': (s: RoomState) => void;
  'room:error': (e: { code: RoomErrorCode; message: string }) => void;
  'race:snapshot': (s: { tick: number; serverTime: number; karts: KartSnapshot[] }) => void;
  'race:finish': (p: { userId: string; rank: number; timeMs: number; deadline?: number }) => void;
  'race:result': (p: {
    ranking: RaceResultEntry[];
    teamScores?: Record<Team, number>;
    winner?: Team;
  }) => void;
  'player:disconnected': (p: { userId: string; graceMs: number }) => void;
  'player:reconnected': (p: { userId: string }) => void;
  'time:pong': (p: { clientTime: number; serverTime: number }) => void;
}

export interface SocketData {
  userId: string;
  nickname: string;
}

export interface GuestInfo {
  userId: string;
  nickname: string;
}
