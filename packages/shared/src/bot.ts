import { MAX_SPEED } from './constants.ts';
import { INPUT_ACCEL, INPUT_BOOST, INPUT_BRAKE, INPUT_LEFT, INPUT_RIGHT } from './input.ts';
import type { MapData } from './map.ts';
import type { KartState } from './physics.ts';

const LOOKAHEAD = 4; // 목표 체크포인트에 이만큼 가까워지면 다음 체크포인트를 본다.
const STEER_DEADZONE = 0.05;
const COAST_ANGLE = 0.9;
const BRAKE_ANGLE = 1.6;
const BRAKE_MIN_SPEED = 4;
const BOT_SPEED_RATIO = 0.85; // 부스트 중이 아니면 최고 속도의 이 비율까지만 가속한다.
const BOT_BOOST_GAUGE = 50;
const BOT_BOOST_ALIGN = 0.1;
const BOT_STUCK_SPEED = 2; // 이보다 느린 채로 목표가 뒤쪽에 있으면 후진하며 방향을 돌린다.
const BOT_MISTAKE_RATE = 0.12; // 체크포인트 구간마다 실수할 확률

// 같은 입력이면 같은 값을 내는 0~1 해시이다. 실수 위치를 무작위 값 없이 정한다.
function hash01(...xs: number[]): number {
  let h = 0x9e3779b9;
  for (const x of xs) h = Math.imul(h ^ (x | 0), 0x5bd1e995) ^ (h >>> 15);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 2 ** 32;
}

// 다음 체크포인트 중점을 향해 조향하는 봇 입력이다. 드리프트는 쓰지 않는다.
// seed는 봇마다 다른 값이며, 어느 구간에서 코너를 넓게 도는 실수를 할지 정한다.
export function botInput(k: KartState, map: MapData, seed = 0): number {
  const cps = map.checkpoints;
  const n = cps.length;
  const mid = (i: number) => {
    const c = cps[((i % n) + n) % n];
    return { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 };
  };
  let target = mid(k.cp + 1);
  // 실수하는 구간에서는 다음 목표를 미리 보지 않아, 코너 중심까지 간 뒤 늦게 돌다가 바깥 벽에 부딪힌다.
  const mistake = hash01(seed, k.lap, k.cp + 1) < BOT_MISTAKE_RATE;
  if (!mistake && Math.hypot(target.x - k.x, target.y - k.y) < LOOKAHEAD) target = mid(k.cp + 2);

  let diff = Math.atan2(target.y - k.y, target.x - k.x) - k.angle;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;

  const speed = Math.hypot(k.vx, k.vy);
  const abs = Math.abs(diff);
  // 후진할 때는 조향이 반대로 먹으므로, 목표 반대쪽 키를 눌러야 차체가 목표 쪽으로 돈다.
  // 벽에 막혀 멈춘 경우만 후진한다. 벽이 없는 맵에서 후진하면 트랙 밖 경계에서 앞뒤로만 오간다.
  const walled = !map.track || map.track.outside === 'wall';
  if (walled && speed < BOT_STUCK_SPEED && abs > Math.PI / 2) return INPUT_BRAKE | (diff > 0 ? INPUT_LEFT : INPUT_RIGHT);
  let bits = diff > STEER_DEADZONE ? INPUT_RIGHT : diff < -STEER_DEADZONE ? INPUT_LEFT : 0;
  // 회전량은 속력에 비례하므로 거의 멈춘 상태에서는 각도 차가 커도 가속해야 방향을 틀 수 있다.
  const tooFast = k.boostLeft === 0 && speed > MAX_SPEED * BOT_SPEED_RATIO;
  if ((abs < COAST_ANGLE && !tooFast) || speed < BRAKE_MIN_SPEED) bits |= INPUT_ACCEL;
  else if (abs > BRAKE_ANGLE) bits |= INPUT_BRAKE;
  if (k.gauge >= BOT_BOOST_GAUGE && abs < BOT_BOOST_ALIGN && k.boostLeft === 0) bits |= INPUT_BOOST;
  return bits;
}
