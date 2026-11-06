import { useEffect, useRef, useState } from 'react';
import { MAPS } from '@dashrush/shared';
import { LocalRace, type RaceHud } from '../game/LocalRace.ts';
import type { ViewMode } from '../game/RaceView.ts';
import { buttonStyle, formatMs, RaceShell, updateGauge } from './RaceShell.tsx';

export function SoloRace({ mapId, onExit }: { mapId: string; onExit: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const gaugeRef = useRef<HTMLDivElement>(null);
  const raceRef = useRef<LocalRace | null>(null);
  const [hud, setHud] = useState<RaceHud | null>(null);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('third');
  const [wrongWay, setWrongWay] = useState(false);

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
      onGauge: (g) => updateGauge(gaugeRef.current, g),
      onWrongWay: setWrongWay,
      onCountdown: setCountdown,
      onView: setView,
    });
    raceRef.current = race;
    return () => race.destroy();
  }, [mapId]);

  return (
    <RaceShell
      hostRef={hostRef}
      minimapRef={minimapRef}
      gaugeRef={gaugeRef}
      view={view}
      countdown={countdown}
      wrongWay={wrongWay}
      onToggleView={() => raceRef.current?.toggleView()}
      onExit={onExit}
      hud={
        <>
          <div>
            LAP {hud?.lap ?? 1}/{hud?.laps ?? '-'}
          </div>
          <div>
            <span ref={timeRef}>0:00.00</span>
          </div>
          <div style={{ fontSize: 14 }}>
            최근 {formatMs(hud?.lastLapMs ?? null)} · 최고 {formatMs(hud?.bestLapMs ?? null)}
          </div>
        </>
      }
      overlay={
        hud?.finishedMs != null && (
          <>
            <div style={{ fontSize: 36, fontWeight: 900 }}>FINISH!</div>
            <div>기록 {formatMs(hud.finishedMs)}</div>
            <div>최고 랩 {formatMs(hud.bestLapMs)}</div>
            {hud.record?.newRace && <div style={{ color: '#e8452c' }}>개인 최고 기록 갱신!</div>}
            {hud.record?.newLap && <div style={{ color: '#e8452c' }}>개인 최고 랩 갱신!</div>}
            <div style={{ fontSize: 13 }}>
              개인 최고 {formatMs(hud.record?.bestRaceMs ?? null)} · 최고 랩 {formatMs(hud.record?.bestLapMs ?? null)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button style={buttonStyle} onClick={() => raceRef.current?.restart()}>
                다시 달리기
              </button>
              <button style={buttonStyle} onClick={onExit}>
                로비로
              </button>
            </div>
          </>
        )
      }
    />
  );
}
