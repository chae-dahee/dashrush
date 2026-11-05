import { PING_INTERVAL_MS } from '@dashrush/shared';
import type { GameSocket } from './socket.ts';

interface Sample {
  rtt: number;
  offset: number;
}

const MAX_SAMPLES = 10;
const BEST_SAMPLES = 3;

let samples: Sample[] = [];
let offset = 0;
let rtt = 0;

export const serverNow = () => Date.now() + offset;
export const currentRtt = () => rtt;

// 왕복이 짧은 측정일수록 비대칭 지연 오차가 작으므로, 가장 짧은 측정들의 평균 차이를 쓴다.
function addSample(s: Sample) {
  samples = [...samples, s].slice(-MAX_SAMPLES);
  const best = [...samples].sort((a, b) => a.rtt - b.rtt).slice(0, BEST_SAMPLES);
  offset = best.reduce((sum, b) => sum + b.offset, 0) / best.length;
  rtt = s.rtt;
}

export function startClockSync(socket: GameSocket): () => void {
  const ping = () => socket.emit('time:ping', Date.now());
  const onPong = ({ clientTime, serverTime }: { clientTime: number; serverTime: number }) => {
    const now = Date.now();
    const r = now - clientTime;
    addSample({ rtt: r, offset: serverTime + r / 2 - now });
  };

  socket.on('time:pong', onPong);
  socket.on('connect', ping);
  if (socket.connected) ping();
  const timer = setInterval(ping, PING_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    socket.off('time:pong', onPong);
    socket.off('connect', ping);
    samples = [];
  };
}
