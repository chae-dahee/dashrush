import { useEffect, useState, type FormEvent } from 'react';
import type { GuestInfo } from '@dashrush/shared';
import { createGuest, fetchMe } from './net/api.ts';
import { currentRtt, startClockSync } from './net/clock.ts';
import { getSocket, resetSocket } from './net/socket.ts';
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

function Main({ guest }: { guest: GuestInfo }) {
  const [soloMap, setSoloMap] = useState<string | null>(null);
  if (soloMap) return <SoloRace mapId={soloMap} onExit={() => setSoloMap(null)} />;
  return <Lobby guest={guest} onSolo={() => setSoloMap('oval')} />;
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

function Lobby({ guest, onSolo }: { guest: GuestInfo; onSolo: () => void }) {
  const [connected, setConnected] = useState(false);
  const [ping, setPing] = useState<number | null>(null);

  useEffect(() => {
    const socket = getSocket();
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    const stopClock = startClockSync(socket);
    socket.connect();
    const timer = setInterval(() => setPing(Math.round(currentRtt())), 1000);
    return () => {
      clearInterval(timer);
      stopClock();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return (
    <div>
      <h1>DashRush</h1>
      <p>{guest.nickname}</p>
      <p>{connected ? `연결됨 · 핑 ${ping ?? '-'}ms` : '연결 중…'}</p>
      <button onClick={onSolo}>혼자 달리기 (오벌)</button>
    </div>
  );
}
