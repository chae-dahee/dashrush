import { MAX_SPEED } from './constants.ts';
import { INPUT_ACCEL, INPUT_BOOST, INPUT_BRAKE, INPUT_LEFT, INPUT_RIGHT } from './input.ts';
import type { CurvedTrack, MapData, Vec } from './map.ts';
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
const BOT_SHORTCUT_RATE = 0.5; // 랩마다 지름길 각각을 탈 확률
const BOT_CUT_SPEED_RATIO = 0.5; // 지름길 입구 근처에서는 최고 속도의 이 비율로 줄인다. 좁은 지름길로 급히 꺾다 미끄러져 나가지 않게 한다.
const CUT_SLOW_DIST = 8; // 지름길 입구 앞뒤 이 거리(타일) 안이 입구 근처이다.
const AIM_BASE = 3; // 중심선 위 목표점을 내 위치에서 이만큼(타일) 앞에 둔다.
const AIM_PER_SPEED = 0.25; // 속력 1(타일/초)마다 목표점을 이만큼 더 앞에 둔다.
const MISTAKE_AIM = 1; // 실수하는 구간의 목표점 거리이며, 코너를 늦게 알아채 바깥으로 밀린다.
const WINDOW_MARGIN = 3; // 중심선 투영 구간을 체크포인트 앞뒤로 이만큼 넓힌다.

// 같은 입력이면 같은 값을 내는 0~1 해시이다. 실수 위치를 무작위 값 없이 정한다.
function hash01(...xs: number[]): number {
  let h = 0x9e3779b9;
  for (const x of xs) h = Math.imul(h ^ (x | 0), 0x5bd1e995) ^ (h >>> 15);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 2 ** 32;
}

interface Path {
  line: Vec[];
  cum: number[]; // 각 점까지 선을 따라 간 거리
  length: number;
}

// 지름길이며, 본선의 s0 지점에서 들어가 s1 지점으로 나온다.
interface Cut extends Path {
  halfWidth: number;
  s0: number;
  s1: number;
}

interface Route {
  main: Path;
  cuts: Cut[];
  cpS: number[]; // 체크포인트마다 본선 위 위치 s
}

function path(line: Vec[], closed: boolean): Path {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
  const last = line[line.length - 1];
  const length = cum[cum.length - 1] + (closed ? Math.hypot(line[0].x - last.x, line[0].y - last.y) : 0);
  return { line, cum, length };
}

const mod = (v: number, m: number) => ((v % m) + m) % m;

// p 위에서 (x, y)에 가장 가까운 점까지 간 거리 s와 그 점까지의 거리 d이다. inWindow가 있으면 그 구간의 선분만 본다.
function project(p: Path, x: number, y: number, closed: boolean, inWindow?: (s: number) => boolean) {
  let best = { s: 0, d: Infinity };
  for (let i = 0; i < p.line.length - (closed ? 0 : 1); i++) {
    if (inWindow && !inWindow(p.cum[i])) continue;
    const a = p.line[i], b = p.line[(i + 1) % p.line.length];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (len * len || 1)));
    const d = Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
    if (d < best.d) best = { s: p.cum[i] + len * t, d };
  }
  return best;
}

function pointAt(p: Path, s: number, closed: boolean): Vec {
  s = closed ? mod(s, p.length) : Math.max(0, Math.min(p.length, s));
  let i = p.cum.findIndex((v) => v > s) - 1;
  if (i < 0) i = p.line.length - 1;
  const a = p.line[i], b = p.line[(i + 1) % p.line.length];
  const len = (i + 1 < p.cum.length ? p.cum[i + 1] : p.length) - p.cum[i];
  const t = len ? (s - p.cum[i]) / len : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

const routes = new WeakMap<MapData, Route>();

function routeOf(map: MapData, t: CurvedTrack): Route {
  let r = routes.get(map);
  if (!r) {
    const main = path(t.line, true);
    const shortcuts = [
      ...(t.lanes ?? []).map((l) => ({ line: l.line, halfWidth: t.halfWidth })),
      ...(t.bridges ?? []).map((b) => ({ line: b.line, halfWidth: b.halfWidth })),
    ];
    const cuts = shortcuts.map((c) => {
      const first = c.line[0], last = c.line[c.line.length - 1];
      return { ...path(c.line, false), halfWidth: c.halfWidth, s0: project(main, first.x, first.y, true).s, s1: project(main, last.x, last.y, true).s };
    });
    const cpS = map.checkpoints.map((c) => project(main, (c.a.x + c.b.x) / 2, (c.a.y + c.b.y) / 2, true).s);
    r = { main, cuts, cpS };
    routes.set(map, r);
  }
  return r;
}

// 곡선 트랙의 중심선이나 이번 랩에 고른 지름길을 따라 앞쪽 점을 목표로 삼는다.
// slow는 지름길에 들어가거나 달리는 중이라 속도를 줄여야 하는지이다.
function routeTarget(k: KartState, map: MapData, t: CurvedTrack, seed: number): { target: Vec; slow: boolean } {
  const { main, cuts, cpS } = routeOf(map, t);
  const cps = map.checkpoints;
  const n = cps.length;
  let next = k.cp + 1;
  while (cps[mod(next, n)].optional && next < k.cp + n) next++;
  // 8자 교차점이나 헤어핀 건너편 차로로 투영되지 않도록 지금 달리는 구간만 본다.
  const lo = cpS[mod(k.cp, n)] - WINDOW_MARGIN;
  const span = mod(cpS[mod(next, n)] - lo, main.length) + WINDOW_MARGIN;
  const inWindow = (s: number) => mod(s - lo, main.length) <= span;
  const here = project(main, k.x, k.y, true, inWindow);
  const s = here.s;

  const mistake = hash01(seed, k.lap, k.cp + 1) < BOT_MISTAKE_RATE;
  const aim = mistake ? MISTAKE_AIM : AIM_BASE + Math.hypot(k.vx, k.vy) * AIM_PER_SPEED;

  for (let i = 0; i < cuts.length; i++) {
    const c = cuts[i];
    if (!inWindow(c.s0) || hash01(seed, k.lap, 1000 + i) >= BOT_SHORTCUT_RATE) continue;
    const on = project(c, k.x, k.y, false);
    // 입구 바로 뒤 체크포인트에서 복귀하면 지름길과 본선이 함께 가깝다. 이때는 본선을 따라가야 같은 입구로 다시 꺾다 빠지지 않는다.
    if (on.d < here.d && on.s > 0) {
      const ahead = on.s + aim;
      const target = ahead <= c.length ? pointAt(c, ahead, false) : pointAt(main, c.s1 + ahead - c.length, true);
      return { target, slow: on.s < CUT_SLOW_DIST };
    }
    const before = mod(c.s0 - s, main.length);
    if (before <= aim) return { target: pointAt(c, aim - before, false), slow: true };
    if (before <= CUT_SLOW_DIST) return { target: pointAt(main, s + aim, true), slow: true };
  }
  return { target: pointAt(main, s + aim, true), slow: false };
}

// 봇 입력이다. 드리프트는 쓰지 않는다.
// seed는 봇마다 다른 값이며, 어느 구간에서 코너를 넓게 도는 실수를 할지와 어느 랩에 지름길을 탈지 정한다.
export function botInput(k: KartState, map: MapData, seed = 0): number {
  let target: Vec;
  let slow = false;
  if (map.track) {
    ({ target, slow } = routeTarget(k, map, map.track, seed));
  } else {
    const cps = map.checkpoints;
    const n = cps.length;
    const mid = (i: number) => {
      const c = cps[mod(i, n)];
      return { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 };
    };
    target = mid(k.cp + 1);
    // 실수하는 구간에서는 다음 목표를 미리 보지 않아, 코너 중심까지 간 뒤 늦게 돌다가 바깥 벽에 부딪힌다.
    const mistake = hash01(seed, k.lap, k.cp + 1) < BOT_MISTAKE_RATE;
    if (!mistake && Math.hypot(target.x - k.x, target.y - k.y) < LOOKAHEAD) target = mid(k.cp + 2);
  }

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
  const limit = MAX_SPEED * (slow ? BOT_CUT_SPEED_RATIO : BOT_SPEED_RATIO);
  const tooFast = (k.boostLeft === 0 || slow) && speed > limit;
  if ((abs < COAST_ANGLE && !tooFast) || speed < BRAKE_MIN_SPEED) bits |= INPUT_ACCEL;
  else if (abs > BRAKE_ANGLE || (slow && tooFast)) bits |= INPUT_BRAKE;
  if (!slow && k.gauge >= BOT_BOOST_GAUGE && abs < BOT_BOOST_ALIGN && k.boostLeft === 0) bits |= INPUT_BOOST;
  return bits;
}

// 완주한 카트의 입력이다. 봇 조향으로 도로를 따라가며 브레이크로 세운다. 브레이크는 속도 0에서 멈추므로 후진하지 않는다.
export function finishInput(k: KartState, map: MapData): number {
  const fwd = k.vx * Math.cos(k.angle) + k.vy * Math.sin(k.angle);
  return (botInput(k, map) & (INPUT_LEFT | INPUT_RIGHT)) | (fwd > 0 ? INPUT_BRAKE : 0);
}
