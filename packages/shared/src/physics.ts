import {
  ACCEL,
  BOOST_MUL,
  BOOST_SEC,
  BRAKE,
  DRAG,
  DRIFT_GRIP_MUL,
  DRIFT_MIN_SPEED,
  DRIFT_SLIP_MIN,
  DRIFT_TIERS,
  DRIFT_TURN_MUL,
  GRIP,
  KART_BOUNCE,
  KART_RADIUS,
  MAX_SPEED,
  OVERSPEED_DECEL,
  REVERSE_ACCEL,
  REVERSE_MAX,
  TICK_MS,
  TURN_FULL_SPEED,
  TURN_RATE,
  WALL_BOUNCE,
  WALL_SPEED_KEEP,
} from './constants.ts';
import { has, INPUT_ACCEL, INPUT_BRAKE, INPUT_DRIFT, INPUT_LEFT, INPUT_RIGHT } from './input.ts';
import { SURFACE_PARAMS, surfaceAt, type GridSlot, type MapData } from './map.ts';
import { segmentCross } from './track.ts';

const DT = TICK_MS / 1000;

export interface KartState {
  x: number;
  y: number;
  angle: number; // 0이 +x 방향이고, 화면 기준 시계 방향으로 증가한다.
  vx: number;
  vy: number;
  drifting: boolean;
  driftCharge: number;
  boostLeft: number;
  lap: number; // 완주한 랩 수
  cp: number; // 마지막으로 통과한 체크포인트. 출발 전에는 -1이다.
  finished: boolean;
}

export interface StepResult {
  kart: KartState;
  passed: number | null; // 이번 tick에 통과한 체크포인트
  crossFrac: number; // 통과 지점의 tick 내 비율
}

export function createKart(slot: GridSlot): KartState {
  return {
    x: slot.x,
    y: slot.y,
    angle: slot.angle,
    vx: 0,
    vy: 0,
    drifting: false,
    driftCharge: 0,
    boostLeft: 0,
    lap: 0,
    cp: -1,
    finished: false,
  };
}

// 드리프트 게이지 단계이다. 0은 아직 부스트를 얻지 못하는 상태이다.
export function driftTier(charge: number): number {
  let tier = 0;
  while (tier < DRIFT_TIERS.length && charge >= DRIFT_TIERS[tier].charge) tier++;
  return tier;
}

// 이전 상태, 입력, 맵으로 1 tick 뒤 상태를 만든다. 서버 판정과 클라이언트 예측이 같은 결과를 내도록 순수 함수로 유지한다.
export function stepKart(prev: KartState, bits: number, map: MapData, laps: number): StepResult {
  const k = { ...prev };
  k.boostLeft = Math.max(0, k.boostLeft - DT);

  const surface = surfaceAt(map, Math.floor(k.x), Math.floor(k.y));
  const surf = surface === 'wall' ? SURFACE_PARAMS.asphalt : SURFACE_PARAMS[surface];

  const accel = has(bits, INPUT_ACCEL);
  const brake = has(bits, INPUT_BRAKE);
  const steer = (has(bits, INPUT_RIGHT) ? 1 : 0) - (has(bits, INPUT_LEFT) ? 1 : 0);

  let fx = Math.cos(k.angle), fy = Math.sin(k.angle);
  const fwdBefore = k.vx * fx + k.vy * fy;

  let kick = 0;
  if (!k.drifting && has(bits, INPUT_DRIFT) && steer !== 0 && fwdBefore > DRIFT_MIN_SPEED) {
    k.drifting = true;
    k.driftCharge = 0;
  } else if (k.drifting && (!has(bits, INPUT_DRIFT) || fwdBefore < DRIFT_MIN_SPEED / 2)) {
    const tier = driftTier(k.driftCharge);
    if (tier > 0) {
      k.boostLeft = Math.max(k.boostLeft, DRIFT_TIERS[tier - 1].boostSec);
      kick = DRIFT_TIERS[tier - 1].kick;
    }
    k.drifting = false;
    k.driftCharge = 0;
  }
  const turnFactor = Math.max(-1, Math.min(1, fwdBefore / TURN_FULL_SPEED));
  k.angle += steer * TURN_RATE * (k.drifting ? DRIFT_TURN_MUL : 1) * turnFactor * DT;
  if (k.angle > Math.PI) k.angle -= 2 * Math.PI;
  else if (k.angle < -Math.PI) k.angle += 2 * Math.PI;

  // 방향만 돌리고 속도 벡터는 그대로 둔 채 새 방향 기준으로 나누므로, 측면 성분이 미끄러짐이 된다.
  fx = Math.cos(k.angle);
  fy = Math.sin(k.angle);
  let fwd = k.vx * fx + k.vy * fy;
  let lat = -k.vx * fy + k.vy * fx;
  // 게이지는 옆으로 미끄러지는 동안 쌓인다. 코너를 도는 내내 차고, 직선에서 키만 누르고 있으면 차지 않는다.
  if (k.drifting && Math.abs(lat) > DRIFT_SLIP_MIN) k.driftCharge += DT;

  const boosting = k.boostLeft > 0;
  const maxSpeed = MAX_SPEED * surf.speed * (boosting ? BOOST_MUL : 1);
  // 드리프트를 푸는 순간 속도를 바로 올려, 줄어든 속도를 되찾는 데 부스트를 다 쓰지 않게 한다.
  if (kick > 0) fwd = Math.max(fwd, Math.min(fwd + kick, maxSpeed));
  if (accel || boosting) fwd += ACCEL * (boosting ? BOOST_MUL : 1) * DT;
  if (brake) {
    fwd = fwd > 0 ? Math.max(0, fwd - BRAKE * DT) : Math.max(-REVERSE_MAX, fwd - REVERSE_ACCEL * DT);
  }
  if (!accel && !brake && !boosting) fwd *= Math.exp(-DRAG * DT);
  if (fwd > maxSpeed) fwd = Math.max(maxSpeed, fwd - OVERSPEED_DECEL * DT);

  lat *= Math.exp(-GRIP * surf.grip * (k.drifting ? DRIFT_GRIP_MUL : 1) * DT);

  k.vx = fx * fwd - fy * lat;
  k.vy = fy * fwd + fx * lat;

  // 1 tick 이동이 반지름보다 길면 나눠 움직여 얇은 벽을 뚫지 않게 한다.
  const steps = Math.max(1, Math.ceil((Math.hypot(k.vx, k.vy) * DT) / KART_RADIUS));
  let hitWall = false;
  for (let i = 0; i < steps; i++) {
    k.x += (k.vx * DT) / steps;
    k.y += (k.vy * DT) / steps;
    hitWall = resolveWalls(k, map) || hitWall;
  }
  if (hitWall) {
    k.vx *= WALL_SPEED_KEEP;
    k.vy *= WALL_SPEED_KEEP;
  }

  for (const p of map.boostPads) {
    if (k.x >= p.x && k.x <= p.x + p.w && k.y >= p.y && k.y <= p.y + p.h) {
      k.boostLeft = Math.max(k.boostLeft, BOOST_SEC);
    }
  }

  let passed: number | null = null;
  let crossFrac = 0;
  if (!k.finished) {
    const n = map.checkpoints.length;
    const next = (k.cp + 1) % n;
    const cp = map.checkpoints[next];
    const t = segmentCross(prev, k, cp.a, cp.b);
    if (t !== null) {
      if (next === 0 && k.cp === n - 1) k.lap += 1;
      k.cp = next;
      passed = next;
      crossFrac = t;
      if (k.lap >= laps) k.finished = true;
    }
  }

  return { kart: k, passed, crossFrac };
}

// 두 카트를 원으로 보고 겹친 만큼 절반씩 밀어내며, 서로 다가오는 속도에 반발 계수를 적용한다. 서버만 쓴다.
export function collideKarts(a: KartState, b: KartState) {
  let dx = b.x - a.x, dy = b.y - a.y;
  let d = Math.hypot(dx, dy);
  const overlap = 2 * KART_RADIUS - d;
  if (overlap <= 0) return;
  if (d === 0) {
    dx = 1;
    dy = 0;
    d = 1;
  }
  const nx = dx / d, ny = dy / d;
  a.x -= (nx * overlap) / 2;
  a.y -= (ny * overlap) / 2;
  b.x += (nx * overlap) / 2;
  b.y += (ny * overlap) / 2;
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn >= 0) return;
  const j = ((1 + KART_BOUNCE) * vn) / 2;
  a.vx += j * nx;
  a.vy += j * ny;
  b.vx -= j * nx;
  b.vy -= j * ny;
}

function resolveWalls(k: KartState, map: MapData): boolean {
  const r = KART_RADIUS;
  let hit = false;
  for (let ty = Math.floor(k.y - r); ty <= Math.floor(k.y + r); ty++) {
    for (let tx = Math.floor(k.x - r); tx <= Math.floor(k.x + r); tx++) {
      if (surfaceAt(map, tx, ty) !== 'wall') continue;
      const cx = Math.max(tx, Math.min(k.x, tx + 1));
      const cy = Math.max(ty, Math.min(k.y, ty + 1));
      let dx = k.x - cx, dy = k.y - cy;
      let d = Math.hypot(dx, dy);
      if (d >= r) continue;
      if (d === 0) {
        // 중심이 벽 안에 들어간 경우 타일 중심에서 멀어지는 방향으로 밀어낸다.
        dx = k.x - (tx + 0.5);
        dy = k.y - (ty + 0.5);
        d = Math.hypot(dx, dy) || 1;
      }
      const nx = dx / d, ny = dy / d;
      k.x = cx + nx * r;
      k.y = cy + ny * r;
      const vn = k.vx * nx + k.vy * ny;
      // 벽을 향해 들어온 경우만 충돌로 보고 감속한다. 벽을 따라 미끄러질 때는 감속하지 않는다.
      if (vn < 0) {
        k.vx -= (1 + WALL_BOUNCE) * vn * nx;
        k.vy -= (1 + WALL_BOUNCE) * vn * ny;
        hit = true;
      }
    }
  }
  return hit;
}
