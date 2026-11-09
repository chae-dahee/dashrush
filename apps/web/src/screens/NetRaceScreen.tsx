import { useEffect, useRef, useState } from 'react';
import { MAPS, RESULTS_MS, TEAM_COLORS, type RoomState } from '@dashrush/shared';
import { NetRace, type NetHud, type NetResult } from '../game/NetRace.ts';
import type { ViewMode } from '../game/RaceView.ts';
import { getSocket } from '../net/socket.ts';
import { hex, Ping } from './common.tsx';
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

  const wins = new Map(room.players.map((p) => [p.id, p.wins]));

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
            <div style={{ fontSize: '0.8em' }}>
              <span style={{ color: '#ff8080' }}>레드 {hud.red}</span> : <span style={{ color: '#8fb4ff' }}>{hud.blue} 블루</span>
            </div>
          )}
          <div ref={limitRef} style={{ fontSize: '0.7em', color: '#ffc83d' }} />
          <Ping />
          {room.players
            .filter((p) => !p.connected)
            .map((p) => (
              <div key={p.id} style={{ fontSize: '0.6em', color: '#ffb3b3' }}>
                {p.nickname} 연결 끊김
              </div>
            ))}
        </>
      }
      overlay={
        result ? (
          <div className="stack">
            <h2 className="title">결과</h2>
            {result.teamScores && (
              <div className="row" style={{ justifyContent: 'center', fontSize: 20 }}>
                <span className="chip" style={{ background: hex(TEAM_COLORS.red[0]) }} />
                {TEAM_NAMES.red} {result.teamScores.red} : {result.teamScores.blue} {TEAM_NAMES.blue}
                <span className="chip" style={{ background: hex(TEAM_COLORS.blue[0]) }} />
                {result.winner && <span className="badge sun">{TEAM_NAMES[result.winner]} 승리</span>}
              </div>
            )}
            <ol className="ranking">
              {result.ranking.map((r, i) => (
                <li key={r.id} className={r.id === meId ? 'me' : ''}>
                  <span className={`rank ${i < 3 && r.timeMs !== null ? 'top' : ''}`}>{i + 1}</span>
                  <span className="name">
                    {r.nickname} {(wins.get(r.id) ?? 0) > 0 && <span className="badge">{wins.get(r.id)}승</span>}
                    <br />
                    <span className="muted">최고 랩 {formatMs(r.bestLapMs)}</span>
                  </span>
                  <span className="time">{r.timeMs === null ? 'DNF' : formatMs(r.timeMs)}</span>
                  {r.points !== undefined && <span className="badge">{r.points}점</span>}
                </li>
              ))}
            </ol>
            {result.record?.newRace && <div className="bubble warn">개인 최고 기록을 갱신했습니다!</div>}
            {result.record?.newLap && <div className="bubble warn">개인 최고 랩을 갱신했습니다!</div>}
            <span className="muted">{RESULTS_MS / 1000}초 뒤 대기실로 돌아갑니다.</span>
            <div className="progress">
              <div style={{ animationDuration: `${RESULTS_MS}ms` }} />
            </div>
          </div>
        ) : (
          hud?.finishMs != null && (
            <div className="stack">
              <div className="logo small">FINISH!</div>
              <div className="title">
                {hud.rank}위 · {formatMs(hud.finishMs)}
              </div>
              <div className="bubble">다른 참가자를 기다리는 중입니다.</div>
            </div>
          )
        )
      }
    />
  );
}
