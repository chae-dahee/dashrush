import { useEffect, useState, type FormEvent } from 'react';
import { MAPS, ROOM_CODE_LEN, type GuestInfo, type RoomState } from '@dashrush/shared';
import { createGuest, fetchMe } from './net/api.ts';
import { currentRtt, startClockSync } from './net/clock.ts';
import { getSocket, resetSocket } from './net/socket.ts';
import { NetRaceScreen } from './screens/NetRaceScreen.tsx';
import { RoomScreen } from './screens/RoomScreen.tsx';
import { SoloRace } from './screens/SoloRace.tsx';

export function App() {
  const [guest, setGuest] = useState<GuestInfo | null | undefined>(undefined);

  useEffect(() => {
    fetchMe().then(setGuest);
  }, []);

  if (guest === undefined) return null;
  if (guest === null) {
    return (
      <NicknameForm
        onDone={(g) => {
          resetSocket();
          setGuest(g);
        }}
      />
    );
  }
  return <Main guest={guest} />;
}

const roomParam = () => new URLSearchParams(location.search).get('room');

// 주소에 방 코드를 남겨 새로고침이나 링크 공유로 같은 방에 들어오게 한다.
function syncRoomParam(code: string | null) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

function Main({ guest }: { guest: GuestInfo }) {
  const [soloMap, setSoloMap] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const socket = getSocket();
    const onConnect = () => {
      setConnected(true);
      // 초대 링크로 들어왔으면 닉네임 입력 뒤 바로 그 방으로 간다.
      const code = roomParam();
      if (code) socket.emit('room:join', { code });
    };
    const onDisconnect = () => {
      setConnected(false);
      setRoom(null);
    };
    const onState = (s: RoomState) => {
      setRoom(s);
      setError('');
      syncRoomParam(s.code);
    };
    const onError = (e: { code: string; message: string }) => {
      setError(e.message);
      if (e.code === 'NOT_FOUND' || e.code === 'RACING' || e.code === 'FULL') syncRoomParam(null);
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onState);
    socket.on('room:error', onError);
    const stopClock = startClockSync(socket);
    socket.connect();
    return () => {
      stopClock();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onState);
      socket.off('room:error', onError);
    };
  }, []);

  const leave = () => {
    getSocket().emit('room:leave');
    setRoom(null);
    syncRoomParam(null);
  };

  if (soloMap) return <SoloRace mapId={soloMap} onExit={() => setSoloMap(null)} />;
  if (room?.status === 'waiting') return <RoomScreen room={room} meId={guest.userId} error={error} onLeave={leave} />;
  if (room) return <NetRaceScreen key={room.raceStartsAt} room={room} meId={guest.userId} onLeave={leave} />;
  return <Lobby guest={guest} connected={connected} error={error} onSolo={setSoloMap} />;
}

function NicknameForm({ onDone }: { onDone: (g: GuestInfo) => void }) {
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      onDone(await createGuest(nickname));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit}>
      <h1>DashRush</h1>
      <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="닉네임" />
      <button type="submit">시작</button>
      {error && <p>{error}</p>}
    </form>
  );
}

interface LobbyProps {
  guest: GuestInfo;
  connected: boolean;
  error: string;
  onSolo: (mapId: string) => void;
}

function Lobby({ guest, connected, error, onSolo }: LobbyProps) {
  const [ping, setPing] = useState<number | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setPing(Math.round(currentRtt())), 1000);
    return () => clearInterval(timer);
  }, []);

  const create = () => {
    const map = MAPS.oval;
    getSocket().emit('room:create', { mode: 'race', mapId: map.id, laps: map.laps });
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    getSocket().emit('room:join', { code });
  };

  return (
    <div>
      <h1>DashRush</h1>
      <p>{guest.nickname}</p>
      <p>{connected ? `연결됨 · 핑 ${ping ?? '-'}ms` : '연결 중…'}</p>
      <button disabled={!connected} onClick={() => getSocket().emit('room:quickMatch')}>
        빠른 매칭
      </button>
      <button disabled={!connected} onClick={create}>
        방 만들기
      </button>
      <form onSubmit={join}>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="방 코드" maxLength={ROOM_CODE_LEN} />
        <button type="submit" disabled={!connected}>
          입장
        </button>
      </form>
      {error && <p>{error}</p>}
      <p>
        혼자 달리기{' '}
        {Object.values(MAPS).map((m) => (
          <button key={m.id} onClick={() => onSolo(m.id)}>
            {m.name}
          </button>
        ))}
      </p>
    </div>
  );
}
