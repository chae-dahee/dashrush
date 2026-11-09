import { useEffect, useRef, useState } from 'react';
import { MAPS } from '@dashrush/shared';
import { LocalRace, type RaceHud } from '../game/LocalRace.ts';
import type { ViewMode } from '../game/RaceView.ts';
import { formatMs, RaceShell, updateGauge } from './RaceShell.tsx';

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
          <div style={{ fontSize: '0.7em' }}>
            최근 {formatMs(hud?.lastLapMs ?? null)} · 최고 {formatMs(hud?.bestLapMs ?? null)}
          </div>
        </>
      }
      overlay={
        hud?.finishedMs != null && (
          <div className="stack">
            <div className="logo small">FINISH!</div>
            <div className="title">{formatMs(hud.finishedMs)}</div>
            <span className="muted">이번 최고 랩 {formatMs(hud.bestLapMs)}</span>
            {hud.record?.newRace && <div className="bubble warn">개인 최고 기록을 갱신했습니다!</div>}
            {hud.record?.newLap && <div className="bubble warn">개인 최고 랩을 갱신했습니다!</div>}
            <span className="muted">
              개인 최고 {formatMs(hud.record?.bestRaceMs ?? null)} · 최고 랩 {formatMs(hud.record?.bestLapMs ?? null)}
            </span>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={() => raceRef.current?.restart()}>
                다시 달리기
              </button>
              <button className="btn" onClick={onExit}>
                로비로
              </button>
            </div>
          </div>
        )
      }
    />
  );
}
