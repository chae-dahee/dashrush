import { useEffect, useState, type FormEvent } from 'react';
import {
  MAPS,
  MAX_PLAYERS,
  NICKNAME_MAX,
  NICKNAME_MIN,
  QUICK_SIZE_MIN,
  ROOM_CODE_LEN,
  type GuestInfo,
  type RoomState,
} from '@dashrush/shared';
import { createGuest, fetchMe, logout } from './net/api.ts';
import { startClockSync } from './net/clock.ts';
import { getSocket, resetSocket } from './net/socket.ts';
import { MapPreview, Ping } from './screens/common.tsx';
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
  return (
    <Main
      guest={guest}
      onLogout={async () => {
        await logout();
        resetSocket();
        setGuest(null);
      }}
    />
  );
}

const roomParam = () => new URLSearchParams(location.search).get('room');

// 주소에 방 코드를 남겨 새로고침이나 링크 공유로 같은 방에 들어오게 한다.
function syncRoomParam(code: string | null) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

function Main({ guest, onLogout }: { guest: GuestInfo; onLogout: () => void }) {
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
  return <Lobby guest={guest} connected={connected} error={error} onSolo={setSoloMap} onLogout={onLogout} />;
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
    <div className="page center">
      <div className="logo">DashRush</div>
      <form className="card stack" onSubmit={submit}>
        <h2 className="title">닉네임을 정해 주세요</h2>
        <input
          className="input"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder={`${NICKNAME_MIN}~${NICKNAME_MAX}자`}
          maxLength={NICKNAME_MAX}
          autoFocus
        />
        {error && <div className="bubble warn">{error}</div>}
        <button type="submit" className="btn primary big">
          출발!
        </button>
      </form>
    </div>
  );
}

interface LobbyProps {
  guest: GuestInfo;
  connected: boolean;
  error: string;
  onSolo: (mapId: string) => void;
  onLogout: () => void;
}

function Lobby({ guest, connected, error, onSolo, onLogout }: LobbyProps) {
  const [code, setCode] = useState('');
  const [quickSize, setQuickSize] = useState(4);
  const [menuOpen, setMenuOpen] = useState(false);

  const create = () => {
    const map = MAPS.oval;
    getSocket().emit('room:create', { mode: 'race', mapId: map.id, laps: map.laps });
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    getSocket().emit('room:join', { code });
  };

  return (
    <div className="page">
      <header className="topbar">
        <div className="logo small">DashRush</div>
        <div className="row">
          <div className="menu">
            <button className="badge sun" onClick={() => setMenuOpen(!menuOpen)}>
              {guest.nickname} ▾
            </button>
            {menuOpen && (
              <div className="bubble">
                <button className="btn small" onClick={onLogout}>
                  로그아웃
                </button>
              </div>
            )}
          </div>
          {connected ? <Ping /> : <span className="badge">연결 중…</span>}
        </div>
      </header>
      {error && <div className="bubble warn">{error}</div>}

      <div className="grid">
        <section className="card stack">
          <h2 className="title">빠른 매칭</h2>
          <p className="muted">고른 인원에서 모자란 자리는 봇이 채웁니다.</p>
          <div className="pills">
            {Array.from({ length: MAX_PLAYERS - QUICK_SIZE_MIN + 1 }, (_, i) => QUICK_SIZE_MIN + i).map((n) => (
              <button key={n} className={`pill ${n === quickSize ? 'on' : ''}`} onClick={() => setQuickSize(n)}>
                {n}명
              </button>
            ))}
          </div>
          <button
            className="btn primary big"
            disabled={!connected}
            onClick={() => getSocket().emit('room:quickMatch', { size: quickSize })}
          >
            빠른 매칭
          </button>
        </section>

        <section className="card stack">
          <h2 className="title">방 만들기</h2>
          <p className="muted">방을 만들고 초대 링크로 친구를 부릅니다.</p>
          <button className="btn big" disabled={!connected} onClick={create}>
            방 만들기
          </button>
        </section>

        <form className="card stack" onSubmit={join}>
          <h2 className="title">코드로 입장</h2>
          <input
            className="input code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="방 코드"
            maxLength={ROOM_CODE_LEN}
          />
          <button type="submit" className="btn big" disabled={!connected || code.length !== ROOM_CODE_LEN}>
            입장
          </button>
        </form>
      </div>

      <section className="card wide stack">
        <h2 className="title">혼자 달리기</h2>
        <div className="map-cards">
          {Object.values(MAPS).map((m) => (
            <button key={m.id} className="map-card" onClick={() => onSolo(m.id)}>
              <MapPreview mapId={m.id} />
              {m.name}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
