import { useEffect, useRef, useState } from 'react';
import { MAPS } from '@dashrush/shared';
import { drawFloorCanvas } from '../game/scene.ts';
import { currentRtt } from '../net/clock.ts';

export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

export function MapPreview({ mapId }: { mapId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const floor = drawFloorCanvas(MAPS[mapId], 4);
    const canvas = ref.current!;
    canvas.width = floor.width;
    canvas.height = floor.height;
    canvas.getContext('2d')!.drawImage(floor, 0, 0);
  }, [mapId]);
  return <canvas ref={ref} className="map-preview" />;
}

const PING_WARN_MS = 150;
const PING_BAD_MS = 300;

export function Ping() {
  const [ping, setPing] = useState<number | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setPing(Math.round(currentRtt())), 1000);
    return () => clearInterval(timer);
  }, []);
  const level = ping === null ? '' : ping >= PING_BAD_MS ? 'bad' : ping >= PING_WARN_MS ? 'warn' : '';
  return (
    <span className={`badge ping ${level}`}>
      핑 {ping ?? '-'}ms{level && ' !'}
    </span>
  );
}
