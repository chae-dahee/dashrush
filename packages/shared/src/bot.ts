import { INPUT_ACCEL, INPUT_BRAKE, INPUT_LEFT, INPUT_RIGHT } from './input.ts';
import type { MapData } from './map.ts';
import type { KartState } from './physics.ts';

const LOOKAHEAD = 4; // 목표 체크포인트에 이만큼 가까워지면 다음 체크포인트를 본다.
const STEER_DEADZONE = 0.05;
const COAST_ANGLE = 0.9;
const BRAKE_ANGLE = 1.6;
const BRAKE_MIN_SPEED = 4;

// 다음 체크포인트 중점을 향해 조향하는 봇 입력이다. 드리프트는 쓰지 않는다.
export function botInput(k: KartState, map: MapData): number {
  const cps = map.checkpoints;
  const mid = (i: number) => {
    const c = cps[i % cps.length];
    return { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 };
  };
  let target = mid(k.cp + 1);
  if (Math.hypot(target.x - k.x, target.y - k.y) < LOOKAHEAD) target = mid(k.cp + 2);

  let diff = Math.atan2(target.y - k.y, target.x - k.x) - k.angle;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;

  const speed = Math.hypot(k.vx, k.vy);
  const abs = Math.abs(diff);
  let bits = diff > STEER_DEADZONE ? INPUT_RIGHT : diff < -STEER_DEADZONE ? INPUT_LEFT : 0;
  // 회전량은 속력에 비례하므로 거의 멈춘 상태에서는 각도 차가 커도 가속해야 방향을 틀 수 있다.
  if (abs < COAST_ANGLE || speed < BRAKE_MIN_SPEED) bits |= INPUT_ACCEL;
  else if (abs > BRAKE_ANGLE) bits |= INPUT_BRAKE;
  return bits;
}
