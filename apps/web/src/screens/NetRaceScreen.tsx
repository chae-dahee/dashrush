import { useEffect, useRef, useState } from 'react';
import { MAPS, RESULTS_MS, type RoomState } from '@dashrush/shared';
import { NetRace, type NetHud, type NetResult } from '../game/NetRace.ts';
import type { ViewMode } from '../game/RaceView.ts';
import { currentRtt } from '../net/clock.ts';
import { getSocket } from '../net/socket.ts';
import { formatMs, RaceShell, TEAM_NAMES, updateGauge } from './RaceShell.tsx';

interface Props {
  room: RoomState;
  meId: string;
  onLeave: () => void;
}

export function NetRaceScreen({ room, meId, onLeave }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const limitRef = useRef<HTMLDivElement>(null);
  const gaugeRef = useRef<HTMLDivElement>(null);
  const raceRef = useRef<NetRace | null>(null);
  const [hud, setHud] = useState<NetHud | null>(null);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('third');
  const [wrongWay, setWrongWay] = useState(false);
  const [result, setResult] = useState<NetResult | null>(null);
  const [ping, setPing] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setPing(Math.round(currentRtt())), 1000);
    return () => clearInterval(timer);
  }, []);

  // 경주 하나가 화면 하나이다. 경주 중 방 정보가 바뀌어도 장면을 새로 만들지 않는다.
  useEffect(() => {
    const race = new NetRace({
      host: hostRef.current!,
      minimap: minimapRef.current!,
      socket: getSocket(),
      map: MAPS[room.mapId],
      laps: room.laps,
      meId,
      players: room.players,
      raceStartsAt: room.raceStartsAt!,
      onHud: setHud,
      // 시간은 매 프레임 바뀌므로 React state 대신 DOM을 직접 갱신한다.
      onTime: (ms, limitLeft) => {
        if (timeRef.current) timeRef.current.textContent = formatMs(ms);
        if (limitRef.current) limitRef.current.textContent = limitLeft === null ? '' : `제한 ${Math.ceil(limitLeft / 1000)}초`;
      },
      onGauge: (g) => updateGauge(gaugeRef.current, g),
      onWrongWay: setWrongWay,
      onCountdown: setCountdown,
      onView: setView,
      onResult: setResult,
    });
    raceRef.current = race;
    return () => race.destroy();
  }, []);

  useEffect(() => {
    raceRef.current?.setPlayers(room.players);
  }, [room.players]);

  return (
    <RaceShell
      hostRef={hostRef}
      minimapRef={minimapRef}
      gaugeRef={gaugeRef}
      view={view}
      countdown={countdown}
      wrongWay={wrongWay}
      onToggleView={() => raceRef.current?.toggleView()}
      onExit={onLeave}
      hud={
        <>
          <div>
            {hud?.rank || '-'}/{hud?.total ?? room.players.length}위 · LAP {hud?.lap ?? 1}/{room.laps}
          </div>
          <div>
            <span ref={timeRef}>0:00.00</span>
          </div>
          {hud?.red != null && (
            <div style={{ fontSize: 16 }}>
              <span style={{ color: '#ff8080' }}>레드 {hud.red}</span> : <span style={{ color: '#8fb4ff' }}>{hud.blue} 블루</span>
            </div>
          )}
          <div ref={limitRef} style={{ fontSize: 14, color: '#ffc83d' }} />
          <div style={{ fontSize: 12, opacity: 0.8 }}>핑 {ping}ms</div>
          {room.players
            .filter((p) => !p.connected)
            .map((p) => (
              <div key={p.id} style={{ fontSize: 12, color: '#ffb3b3' }}>
                {p.nickname} 연결 끊김
              </div>
            ))}
        </>
      }
      overlay={
        result ? (
          <>
            <div style={{ fontSize: 28, fontWeight: 900 }}>결과</div>
            {result.teamScores && (
              <div style={{ fontSize: 20 }}>
                레드 {result.teamScores.red} : {result.teamScores.blue} 블루
                {result.winner && ` · ${TEAM_NAMES[result.winner]} 승리`}
              </div>
            )}
            <table style={{ margin: '8px auto', borderSpacing: '12px 2px' }}>
              <tbody>
                {result.ranking.map((r, i) => (
                  <tr key={r.id} style={{ fontWeight: r.id === meId ? 900 : 600 }}>
                    <td>{i + 1}</td>
                    <td>{r.nickname}</td>
                    <td>{r.timeMs === null ? 'DNF' : formatMs(r.timeMs)}</td>
                    <td style={{ fontSize: 13 }}>최고 랩 {formatMs(r.bestLapMs)}</td>
                    {r.points !== undefined && <td>{r.points}점</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {result.record?.newRace && <div style={{ color: '#e8452c' }}>개인 최고 기록 갱신!</div>}
            {result.record?.newLap && <div style={{ color: '#e8452c' }}>개인 최고 랩 갱신!</div>}
            <div style={{ fontSize: 13 }}>{RESULTS_MS / 1000}초 뒤 대기실로 돌아갑니다.</div>
          </>
        ) : (
          hud?.finishMs != null && (
            <>
              <div style={{ fontSize: 36, fontWeight: 900 }}>FINISH!</div>
              <div>
                {hud.rank}위 · {formatMs(hud.finishMs)}
              </div>
            </>
          )
        )
      }
    />
  );
}
