import { useEffect, useState } from 'react';
import {
  LAPS_MAX,
  LAPS_MIN,
  MAPS,
  MAX_PLAYERS,
  TEAM_COLORS,
  type PlayerInfo,
  type RoomMode,
  type RoomState,
  type Team,
} from '@dashrush/shared';
import { serverNow } from '../net/clock.ts';
import { getSocket } from '../net/socket.ts';
import { hex, MapPreview } from './common.tsx';
import { TEAM_NAMES } from './RaceShell.tsx';

interface Props {
  room: RoomState;
  meId: string;
  error: string;
  onLeave: () => void;
}

export const inviteUrl = (code: string) => `${location.origin}/?room=${code}`;

const MODES: [RoomMode, string][] = [
  ['race', '일반 레이스'],
  ['team', '팀전'],
];
const LAPS = Array.from({ length: LAPS_MAX - LAPS_MIN + 1 }, (_, i) => LAPS_MIN + i);

export function RoomScreen({ room, meId, error, onLeave }: Props) {
  const isHost = room.hostId === meId;
  const me = room.players.find((p) => p.id === meId);
  const socket = getSocket();
  const [copied, setCopied] = useState(false);
  const allReady = room.players.every((p) => p.id === room.hostId || p.ready);
  const config = (patch: Partial<{ mode: RoomMode; mapId: string; laps: number }>) =>
    socket.emit('room:config', { mode: room.mode, mapId: room.mapId, laps: room.laps, ...patch });

  const copy = async () => {
    await navigator.clipboard.writeText(inviteUrl(room.code));
    setCopied(true);
  };

  const player = (p: PlayerInfo) => (
    <li key={p.id} className={`player ${p.id === meId ? 'me' : ''}`}>
      <span className="chip" style={{ background: hex(p.color) }} />
      <span className="name">{p.nickname}</span>
      {p.id === room.hostId && <span className="badge ink">방장</span>}
      {p.bot && <span className="badge">봇</span>}
      {!p.bot && p.id !== room.hostId && <span className={`badge ${p.ready ? 'sun' : ''}`}>{p.ready ? '준비' : '대기'}</span>}
      {p.wins > 0 && <span className="badge">{p.wins}승</span>}
      {isHost && p.bot && (
        <button className="btn small" onClick={() => socket.emit('room:bot', { action: 'remove', botId: p.id })}>
          빼기
        </button>
      )}
    </li>
  );

  const team = (t: Team) => (
    <div className="stack">
      <div className="row">
        <span className="chip" style={{ background: hex(TEAM_COLORS[t][0]) }} />
        {TEAM_NAMES[t]}
      </div>
      <ul className="players">{room.players.filter((p) => p.team === t).map(player)}</ul>
    </div>
  );

  return (
    <div className="page">
      <header className="topbar">
        <h1 className="title">{room.isPublic ? '빠른 매칭' : `방 ${room.code}`}</h1>
        {!room.isPublic && (
          <button className="btn" onClick={copy}>
            {copied ? '복사했습니다' : '초대 링크 복사'}
          </button>
        )}
      </header>

      <div className="grid">
        <section className="card stack">
          <MapPreview mapId={room.mapId} />
          <h2 className="title">{MAPS[room.mapId].name}</h2>
          {room.publicSize !== null ? (
            <div className="bubble">
              {room.publicSize}명 경주입니다. 지금 {room.players.length}명이 있고, 모자란 자리는 출발할 때 봇이 채웁니다.
            </div>
          ) : (
            <>
              <Pills label="모드" disabled={!isHost} items={MODES} value={room.mode} onPick={(mode) => config({ mode })} />
              <Pills
                label="맵"
                disabled={!isHost}
                items={Object.values(MAPS).map((m) => [m.id, m.name])}
                value={room.mapId}
                onPick={(mapId) => config({ mapId })}
              />
              <Pills
                label="랩"
                disabled={!isHost}
                items={LAPS.map((n) => [n, String(n)])}
                value={room.laps}
                onPick={(laps) => config({ laps })}
              />
            </>
          )}
          <p className="muted">방향키·WASD로 주행, Shift로 드리프트, Space로 부스트, V로 시점 전환</p>
        </section>

        <section className="card stack">
          <h2 className="title">
            참가자 {room.players.length}/{room.publicSize ?? MAX_PLAYERS}
          </h2>
          {room.mode === 'team' ? (
            <div className="teams">
              {team('red')}
              {team('blue')}
            </div>
          ) : (
            <ul className="players">{room.players.map(player)}</ul>
          )}
          <div className="row">
            {room.mode === 'team' && me?.team && (
              <button className="btn small" onClick={() => socket.emit('room:team', { team: me.team === 'red' ? 'blue' : 'red' })}>
                {TEAM_NAMES[me.team === 'red' ? 'blue' : 'red']} 팀으로
              </button>
            )}
            {isHost && room.players.length < MAX_PLAYERS && (
              <button className="btn small" onClick={() => socket.emit('room:bot', { action: 'add' })}>
                봇 추가
              </button>
            )}
          </div>
        </section>
      </div>

      <div className="actionbar">
        {error ? (
          <div className="bubble warn">{error}</div>
        ) : (
          room.isPublic && <StartTimer endsAt={room.startTimerEndsAt} />
        )}
        {isHost ? (
          <button className="btn primary" disabled={!allReady} onClick={() => socket.emit('room:start')}>
            {allReady ? '시작' : '모두 준비하면 시작'}
          </button>
        ) : (
          me && (
            <button className={`btn ${me.ready ? '' : 'primary'}`} onClick={() => socket.emit('room:ready', { ready: !me.ready })}>
              {me.ready ? '준비 취소' : '준비'}
            </button>
          )
        )}
        <button className="btn" onClick={onLeave}>
          나가기
        </button>
      </div>
    </div>
  );
}

function Pills<T extends string | number>(props: {
  label: string;
  disabled: boolean;
  items: [T, string][];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="muted">{props.label}</span>
      <div className="pills">
        {props.items.map(([v, text]) => (
          <button
            key={v}
            className={`pill ${v === props.value ? 'on' : ''}`}
            disabled={props.disabled}
            onClick={() => props.onPick(v)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function StartTimer({ endsAt }: { endsAt: number | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="bubble">
      {endsAt === null
        ? '모두 준비하면 바로 출발합니다.'
        : `${Math.max(0, Math.ceil((endsAt - serverNow()) / 1000))}초 뒤 준비하지 않은 사람이 있어도 출발합니다.`}
    </div>
  );
}
