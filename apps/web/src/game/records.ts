// 맵별 개인 최고 기록이다. 서버 없이 이 브라우저에만 저장한다.

interface Best {
  race: Record<string, number>; // 랩 수별 완주 기록(ms)
  lap: number | null;
}

const key = (mapId: string) => `dashrush.best.${mapId}`;

function load(mapId: string): Best {
  try {
    const raw = localStorage.getItem(key(mapId));
    if (raw) return JSON.parse(raw) as Best;
  } catch {
    // 읽지 못하면 기록이 없는 것으로 본다.
  }
  return { race: {}, lap: null };
}

export function submitRecord(mapId: string, laps: number, raceMs: number | null, lapMs: number | null) {
  const best = load(mapId);
  const prevRace = best.race[laps];
  const newRace = raceMs !== null && (prevRace === undefined || raceMs < prevRace);
  const newLap = lapMs !== null && (best.lap === null || lapMs < best.lap);
  if (newRace) best.race[laps] = raceMs!;
  if (newLap) best.lap = lapMs;
  try {
    localStorage.setItem(key(mapId), JSON.stringify(best));
  } catch {
    // 저장하지 못해도 이번 결과 표시는 한다.
  }
  return { newRace, newLap, bestRaceMs: best.race[laps] ?? null, bestLapMs: best.lap };
}
