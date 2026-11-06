import { useEffect, useState } from 'react';
import { LAPS_MAX, LAPS_MIN, MAPS, MAX_PLAYERS, type RoomMode, type RoomState } from '@dashrush/shared';
import { serverNow } from '../net/clock.ts';
import { getSocket } from '../net/socket.ts';
import { TEAM_NAMES } from './RaceShell.tsx';

interface Props {
  room: RoomState;
  meId: string;
  error: string;
  onLeave: () => void;
}

export const inviteUrl = (code: string) => `${location.origin}/?room=${code}`;

// 방 대기 화면이다. 비공개 방은 방장이 설정하고 출발시키며, 공개 방은 시작 타이머로 출발한다.
export function RoomScreen({ room, meId, error, onLeave }: Props) {
  const isHost = room.hostId === meId;
  const me = room.players.find((p) => p.id === meId);
  const socket = getSocket();
  const [copied, setCopied] = useState(false);
  const config = (patch: Partial<{ mode: RoomMode; mapId: string; laps: number }>) =>
    socket.emit('room:config', { mode: room.mode, mapId: room.mapId, laps: room.laps, ...patch });

  const copy = async () => {
    await navigator.clipboard.writeText(inviteUrl(room.code));
    setCopied(true);
  };

  return (
    <div>
      <h2>{room.isPublic ? `빠른 매칭 · ${MAPS[room.mapId].name}` : `방 ${room.code}`}</h2>
      {!room.isPublic && <button onClick={copy}>{copied ? '복사됨' : '초대 링크 복사'}</button>}

      <ul>
        {room.players.map((p) => (
          <li key={p.id}>
            <span style={{ color: '#' + p.color.toString(16).padStart(6, '0') }}>●</span> {p.nickname}
            {p.bot && ' [봇]'}
            {p.team && ` (${TEAM_NAMES[p.team]})`}
            {p.id === room.hostId && ' (방장)'}
            {p.id === meId && ' (나)'}
            {p.wins > 0 && ` · ${p.wins}승`}
            {isHost && p.bot && (
              <button onClick={() => socket.emit('room:bot', { action: 'remove', botId: p.id })}>빼기</button>
            )}
          </li>
        ))}
      </ul>

      {!room.isPublic && (
        <p>
          모드{' '}
          <select disabled={!isHost} value={room.mode} onChange={(e) => config({ mode: e.target.value as RoomMode })}>
            <option value="race">일반 레이스</option>
            <option value="team">팀전</option>
          </select>{' '}
          맵{' '}
          <select disabled={!isHost} value={room.mapId} onChange={(e) => config({ mapId: e.target.value })}>
            {Object.values(MAPS).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>{' '}
          랩{' '}
          <select disabled={!isHost} value={room.laps} onChange={(e) => config({ laps: Number(e.target.value) })}>
            {Array.from({ length: LAPS_MAX - LAPS_MIN + 1 }, (_, i) => LAPS_MIN + i).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </p>
      )}

      {room.mode === 'team' && me?.team && (
        <button onClick={() => socket.emit('room:team', { team: me.team === 'red' ? 'blue' : 'red' })}>
          {TEAM_NAMES[me.team === 'red' ? 'blue' : 'red']} 팀으로 옮기기
        </button>
      )}
      {isHost && room.players.length < MAX_PLAYERS && (
        <button onClick={() => socket.emit('room:bot', { action: 'add' })}>봇 추가</button>
      )}

      <p>조작: 방향키 또는 WASD로 주행, Space·Shift로 드리프트, V로 시점 전환</p>

      {room.isPublic ? (
        <StartTimer endsAt={room.startTimerEndsAt} />
      ) : isHost ? (
        <button onClick={() => socket.emit('room:start')}>시작</button>
      ) : (
        <p>방장이 시작하기를 기다리는 중…</p>
      )}
      <button onClick={onLeave}>나가기</button>
      {error && <p>{error}</p>}
    </div>
  );
}

function StartTimer({ endsAt }: { endsAt: number | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, []);
  if (endsAt === null) return <p>다른 참가자를 기다리는 중…</p>;
  return <p>{Math.max(0, Math.ceil((endsAt - serverNow()) / 1000))}초 뒤 출발합니다.</p>;
}
