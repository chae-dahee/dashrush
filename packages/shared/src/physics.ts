import {
  ACCEL,
  BOOST_MUL,
  BOOST_SEC,
  BOOST_USE_COST,
  BOOST_USE_SEC,
  BRAKE,
  DRAG,
  DRIFT_END_BOOST_SEC,
  DRIFT_END_MIN_SEC,
  DRIFT_GRIP_MUL,
  DRIFT_MIN_SPEED,
  DRIFT_SLIP_MIN,
  DRIFT_TURN_MUL,
  FALL_SEC,
  GAUGE_CLEAN_DELAY_SEC,
  GAUGE_CLEAN_RATE,
  GAUGE_CLEAN_SPEED,
  GAUGE_DRIFT_RATE,
  GAUGE_MAX,
  GRIP,
  KART_BOUNCE,
  KART_RADIUS,
  MAX_SPEED,
  OVERSPEED_DECEL,
  REVERSE_ACCEL,
  REVERSE_MAX,
  SPAWN_GHOST_SEC,
  TICK_MS,
  TURN_FULL_SPEED,
  TURN_RATE,
  WALL_BOUNCE,
  WALL_IMPACT_MIN,
  WALL_MIN_BOUNCE,
  WALL_SCRAPE_MAX,
  WALL_SPEED_KEEP,
  WALL_TURN_MAX,
} from './constants.ts';
import { has, INPUT_ACCEL, INPUT_BOOST, INPUT_BRAKE, INPUT_DRIFT, INPUT_LEFT, INPUT_RIGHT } from './input.ts';
import { nearestOnTrack, SURFACE_PARAMS, surfaceAt, surfaceAtPoint, type GridSlot, type MapData } from './map.ts';
import { segmentCross } from './track.ts';

const DT = TICK_MS / 1000;

export interface KartState {
  x: number;
  y: number;
  angle: number; // 0이 +x 방향이고, 화면 기준 시계 방향으로 증가한다.
  vx: number;
  vy: number;
  drifting: boolean;
  driftSlip: number; // 이번 드리프트에서 미끄러진 시간(초)
  gauge: number; // 부스트 게이지(%)
  sinceHit: number; // 마지막으로 벽이나 카트에 부딪힌 뒤 지난 시간(초)
  boostHeld: boolean; // 직전 tick의 부스트 키 상태이며, 누른 순간만 부스트를 쓰게 한다.
  boostLeft: number;
  lap: number; // 완주한 랩 수
  cp: number; // 마지막으로 통과한 체크포인트. 출발 전에는 -1이다.
  finished: boolean;
  fallLeft: number; // 바다에 빠진 뒤 복귀까지 남은 시간(초)
  spawnLeft: number; // 복귀 뒤 다른 카트와 부딪히지 않는 남은 시간(초)
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
    driftSlip: 0,
    gauge: 0,
    sinceHit: 0,
    boostHeld: false,
    boostLeft: 0,
    lap: 0,
    cp: -1,
    finished: false,
    fallLeft: 0,
    spawnLeft: 0,
  };
}

// 마지막으로 통과한 체크포인트 중점에서 다음 체크포인트를 보고 멈춘 채 다시 시작한다. 출발 전이면 첫 그리드로 돌아간다.
function respawn(k: KartState, map: MapData) {
  const cps = map.checkpoints;
  const mid = (i: number) => ({ x: (cps[i].a.x + cps[i].b.x) / 2, y: (cps[i].a.y + cps[i].b.y) / 2 });
  if (k.cp < 0) {
    k.x = map.grid[0].x;
    k.y = map.grid[0].y;
    k.angle = map.grid[0].angle;
  } else {
    const from = mid(k.cp), to = mid((k.cp + 1) % cps.length);
    k.x = from.x;
    k.y = from.y;
    k.angle = Math.atan2(to.y - from.y, to.x - from.x);
  }
  k.vx = k.vy = 0;
  k.boostLeft = 0;
  k.spawnLeft = SPAWN_GHOST_SEC;
}

// 이전 상태, 입력, 맵으로 1 tick 뒤 상태를 만든다. 서버 판정과 클라이언트 예측이 같은 결과를 내도록 순수 함수로 유지한다.
export function stepKart(prev: KartState, bits: number, map: MapData, laps: number): StepResult {
  const k = { ...prev };
  k.spawnLeft = Math.max(0, k.spawnLeft - DT);
  if (k.fallLeft > 0) {
    k.fallLeft = Math.max(0, k.fallLeft - DT);
    if (k.fallLeft === 0) respawn(k, map);
    return { kart: k, passed: null, crossFrac: 0 };
  }
  k.boostLeft = Math.max(0, k.boostLeft - DT);
  k.sinceHit += DT;

  const boostKey = has(bits, INPUT_BOOST);
  if (boostKey && !k.boostHeld && k.gauge >= BOOST_USE_COST) {
    k.gauge -= BOOST_USE_COST;
    k.boostLeft = Math.max(k.boostLeft, BOOST_USE_SEC);
  }
  k.boostHeld = boostKey;

  const surface = surfaceAtPoint(map, k.x, k.y);
  const surf = surface === 'wall' || surface === 'sea' ? SURFACE_PARAMS.asphalt : SURFACE_PARAMS[surface];

  const accel = has(bits, INPUT_ACCEL);
  const brake = has(bits, INPUT_BRAKE);
  const steer = (has(bits, INPUT_RIGHT) ? 1 : 0) - (has(bits, INPUT_LEFT) ? 1 : 0);

  let fx = Math.cos(k.angle), fy = Math.sin(k.angle);
  const fwdBefore = k.vx * fx + k.vy * fy;

  if (!k.drifting && has(bits, INPUT_DRIFT) && steer !== 0 && fwdBefore > DRIFT_MIN_SPEED) {
    k.drifting = true;
    k.driftSlip = 0;
  } else if (k.drifting && (!has(bits, INPUT_DRIFT) || fwdBefore < DRIFT_MIN_SPEED / 2)) {
    if (k.driftSlip >= DRIFT_END_MIN_SEC) k.boostLeft = Math.max(k.boostLeft, DRIFT_END_BOOST_SEC);
    k.drifting = false;
    k.driftSlip = 0;
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
  if (k.drifting && Math.abs(lat) > DRIFT_SLIP_MIN) {
    k.driftSlip += DT;
    k.gauge += GAUGE_DRIFT_RATE * DT;
  } else if (!k.drifting && k.sinceHit >= GAUGE_CLEAN_DELAY_SEC && fwd >= MAX_SPEED * GAUGE_CLEAN_SPEED) {
    k.gauge += GAUGE_CLEAN_RATE * DT;
  }
  k.gauge = Math.min(GAUGE_MAX, k.gauge);

  const boosting = k.boostLeft > 0;
  const maxSpeed = MAX_SPEED * surf.speed * (boosting ? BOOST_MUL : 1);
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
  let wall: WallContact = { impact: 0, nx: 0, ny: 0 };
  for (let i = 0; i < steps; i++) {
    k.x += (k.vx * DT) / steps;
    k.y += (k.vy * DT) / steps;
    const c = resolveWalls(k, map);
    if (c.impact > wall.impact) wall = c;
  }
  if (wall.impact > 0) bounceOffWall(k, wall);

  for (const p of map.boostPads) {
    if (k.x >= p.x && k.x <= p.x + p.w && k.y >= p.y && k.y <= p.y + p.h) {
      k.boostLeft = Math.max(k.boostLeft, BOOST_SEC);
    }
  }

  if (surfaceAtPoint(map, k.x, k.y) === 'sea') {
    k.fallLeft = FALL_SEC;
    k.vx = k.vy = 0;
    k.drifting = false;
    k.driftSlip = 0;
  }

  let passed: number | null = null;
  let crossFrac = 0;
  if (!k.finished) {
    const n = map.checkpoints.length;
    for (let next = (k.cp + 1) % n; ; next = (next + 1) % n) {
      const cp = map.checkpoints[next];
      const t = segmentCross(prev, k, cp.a, cp.b);
      if (t !== null) {
        if (next === 0 && k.cp !== -1) k.lap += 1;
        k.cp = next;
        passed = next;
        crossFrac = t;
        if (k.lap >= laps) k.finished = true;
        break;
      }
      if (!cp.optional) break;
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
  a.sinceHit = b.sinceHit = 0;
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

interface WallContact {
  impact: number; // 벽으로 들어오던 속력
  nx: number;
  ny: number;
}

// 가장 세게 부딪힌 벽의 법선과 충돌 속력을 돌려준다.
function resolveWalls(k: KartState, map: MapData): WallContact {
  const r = KART_RADIUS;
  const hit: WallContact = { impact: 0, nx: 0, ny: 0 };
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
      if (vn < 0) {
        k.vx -= (1 + WALL_BOUNCE) * vn * nx;
        k.vy -= (1 + WALL_BOUNCE) * vn * ny;
        if (-vn > hit.impact) Object.assign(hit, { impact: -vn, nx, ny });
      }
    }
  }
  const t = map.track;
  if (t?.outside === 'wall') {
    const c = nearestOnTrack(t, k.x, k.y);
    const limit = c.halfWidth - r;
    if (c.d > limit) {
      const nx = (c.x - k.x) / c.d, ny = (c.y - k.y) / c.d;
      k.x = c.x - nx * limit;
      k.y = c.y - ny * limit;
      const vn = k.vx * nx + k.vy * ny;
      if (vn < 0) {
        k.vx -= (1 + WALL_BOUNCE) * vn * nx;
        k.vy -= (1 + WALL_BOUNCE) * vn * ny;
        if (-vn > hit.impact) Object.assign(hit, { impact: -vn, nx, ny });
      }
    }
  }
  return hit;
}

const wrapAngle = (a: number) => (a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a);

function bounceOffWall(k: KartState, c: WallContact) {
  if (c.impact > WALL_IMPACT_MIN) {
    k.vx *= WALL_SPEED_KEEP;
    k.vy *= WALL_SPEED_KEEP;
    k.sinceHit = 0;
  }
  if (c.impact <= WALL_SCRAPE_MAX) return;

  const fx = Math.cos(k.angle), fy = Math.sin(k.angle);
  const dot = fx * c.nx + fy * c.ny;
  if (dot < -0.05) {
    let tx = fx - dot * c.nx, ty = fy - dot * c.ny;
    if (Math.hypot(tx, ty) < 1e-6) [tx, ty] = [-c.ny, c.nx];
    const diff = wrapAngle(Math.atan2(ty, tx) - k.angle);
    k.angle = wrapAngle(k.angle + Math.sign(diff) * Math.min(Math.abs(diff), WALL_TURN_MAX));
  }
  const out = k.vx * c.nx + k.vy * c.ny;
  if (out < WALL_MIN_BOUNCE) {
    k.vx += (WALL_MIN_BOUNCE - out) * c.nx;
    k.vy += (WALL_MIN_BOUNCE - out) * c.ny;
  }
}
