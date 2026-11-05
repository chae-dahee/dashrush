// 서버는 이 값을 판정 기준으로 쓰고, 클라이언트는 표시와 예측에만 쓴다.

export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;

export const TOKEN_COOKIE = 'dashrush_token';
export const TOKEN_TTL_SEC = 7 * 24 * 60 * 60;

export const PING_INTERVAL_MS = 2000;

export const COUNTDOWN_MS = 3000;

// 물리 상수는 타일·초 단위이다. 초기값이며 플레이 테스트로 조정한다.
export const KART_RADIUS = 0.375;
export const MAX_SPEED = 9;
export const ACCEL = 7;
export const BRAKE = 14;
export const REVERSE_ACCEL = 5;
export const REVERSE_MAX = 3;
export const DRAG = 0.6;
export const OVERSPEED_DECEL = 12;
export const TURN_RATE = 3;
export const TURN_FULL_SPEED = 3; // 이 속력부터 회전량이 최대가 된다.
export const GRIP = 10;
export const DRIFT_TURN_MUL = 1.35;
export const DRIFT_GRIP_MUL = 0.25;
export const DRIFT_MIN_SPEED = 3;
export const DRIFT_CHARGE_SEC = 0.8;
export const DRIFT_BOOST_SEC = 0.6;
export const BOOST_MUL = 1.4;
export const BOOST_SEC = 1.2;
export const WALL_BOUNCE = 0.3;
export const WALL_SPEED_KEEP = 0.6;
