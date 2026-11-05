import { useEffect, useRef, useState } from 'react';
import { MAPS } from '@dashrush/shared';
import { LocalRace, type RaceHud, type ViewMode } from '../game/LocalRace.ts';

const formatMs = (ms: number | null) => {
  if (ms === null) return '-';
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
};

export function SoloRace({ mapId, onExit }: { mapId: string; onExit: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const raceRef = useRef<LocalRace | null>(null);
  const [hud, setHud] = useState<RaceHud | null>(null);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('third');

  useEffect(() => {
    const map = MAPS[mapId];
    const race = new LocalRace({
      host: hostRef.current!,
      minimap: minimapRef.current!,
      map,
      laps: map.laps,
      color: 0xff6f91,
      onHud: setHud,
      // 경주 시간은 매 프레임 바뀌므로 React state 대신 DOM을 직접 갱신한다.
      onTime: (ms) => {
        if (timeRef.current) timeRef.current.textContent = formatMs(ms);
      },
      onCountdown: setCountdown,
      onView: setView,
    });
    raceRef.current = race;
    return () => race.destroy();
  }, [mapId]);

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', fontFamily: 'system-ui, sans-serif' }}>
      <style>{`@keyframes pop { from { transform: translate(-50%, -50%) scale(1.8); opacity: 0.4 } to { transform: translate(-50%, -50%) scale(1); opacity: 1 } }`}</style>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />

      <div style={hudStyle}>
        <div>
          LAP {hud?.lap ?? 1}/{hud?.laps ?? '-'}
        </div>
        <div>
          <span ref={timeRef}>0:00.00</span>
        </div>
        <div style={{ fontSize: 14 }}>
          최근 {formatMs(hud?.lastLapMs ?? null)} · 최고 {formatMs(hud?.bestLapMs ?? null)}
        </div>
      </div>

      <canvas ref={minimapRef} style={minimapStyle} />

      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8 }}>
        <button style={buttonStyle} onClick={() => raceRef.current?.toggleView()}>
          {view === 'third' ? '1인칭' : '3인칭'} (V)
        </button>
        <button style={buttonStyle} onClick={onExit}>
          나가기
        </button>
      </div>

      {countdown && (
        <div key={countdown} style={countdownStyle}>
          {countdown}
        </div>
      )}

      {hud?.finishedMs != null && (
        <div style={resultStyle}>
          <div style={{ fontSize: 36, fontWeight: 900 }}>FINISH!</div>
          <div>기록 {formatMs(hud.finishedMs)}</div>
          <div>최고 랩 {formatMs(hud.bestLapMs)}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={buttonStyle} onClick={() => raceRef.current?.restart()}>
              다시 달리기
            </button>
            <button style={buttonStyle} onClick={onExit}>
              로비로
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const hudStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  padding: '8px 14px',
  borderRadius: 16,
  background: 'rgba(43,35,64,0.75)',
  color: '#fff',
  fontWeight: 800,
  fontSize: 20,
  fontVariantNumeric: 'tabular-nums',
};

const minimapStyle: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  bottom: 12,
  width: 'min(32vw, 240px)',
  borderRadius: 12,
  border: '3px solid #2b2340',
  opacity: 0.9,
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 999,
  border: '3px solid #2b2340',
  background: '#ffc83d',
  fontWeight: 800,
  cursor: 'pointer',
};

const countdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '35%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  fontSize: 120,
  fontWeight: 900,
  color: '#fff',
  WebkitTextStroke: '6px #2b2340',
  animation: 'pop 0.35s ease-out',
  pointerEvents: 'none',
};

const resultStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  padding: '20px 28px',
  borderRadius: 24,
  border: '4px solid #2b2340',
  background: '#fff',
  textAlign: 'center',
  fontWeight: 700,
};
