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
export const DRIFT_SLIP_MIN = 1; // 측면 속력이 이보다 클 때만 드리프트 게이지가 쌓인다(타일/초).
// 드리프트 게이지 단계이다. 오래 충전할수록 부스트가 길고, 드리프트를 푸는 순간 앞쪽 속도가 더 크게 뛴다.
export const DRIFT_TIERS = [
  { charge: 0.6, boostSec: 0.8, kick: 2 },
  { charge: 1.4, boostSec: 1.3, kick: 3 },
  { charge: 2.2, boostSec: 1.8, kick: 4 },
] as const;
export const BOOST_MUL = 1.4;
export const BOOST_SEC = 1.2;
export const WALL_BOUNCE = 0.3;
export const WALL_SPEED_KEEP = 0.6;

export const MAX_PLAYERS = 8;
export const LAPS_MIN = 1;
export const LAPS_MAX = 5;
export const ROOM_CODE_LEN = 6;
// 말로 불러 주거나 옮겨 적을 때 헷갈리는 0/O, 1/I/L을 뺐다.
export const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const RESULTS_MS = 10000;

export const INPUT_QUEUE_MAX = 10;
export const INPUT_STALE_TICKS = 6; // 이만큼 새 입력이 없으면 중립 입력으로 바꾼다.
export const INTERP_DELAY_MS = 100;
export const EXTRAPOLATE_MAX_MS = 100;

// 그리드 슬롯 순서이다.
export const KART_COLORS = [0xff6f91, 0x3d7bff, 0xffc83d, 0x6a3fb5, 0x4fd18b, 0xe8452c, 0x7fe3ff, 0x2b6b4a];

export const KART_BOUNCE = 0.5; // 카트끼리 부딪힐 때 반발 계수
export const FINISH_LIMIT_MS = 20000; // 첫 완주 뒤 나머지에게 주는 제한 시간
export const EVENT_RATE_MAX = TICK_RATE * 2; // 소켓 하나가 1초에 보낼 수 있는 이벤트 수
export const CORRECTION_SNAP = 3; // 예측 보정 차이가 이 거리(타일)를 넘으면 오프셋 없이 바로 맞춘다.

export const DISCONNECT_GRACE_MS = 15000;
export const QUICK_START_MS = 20000; // 공개 방에 2명이 모이면 도는 시작 타이머
export const TEAM_SIZE_MAX = MAX_PLAYERS / 2;
export const TEAM_POINTS = [10, 8, 6, 5, 4, 3, 2, 1]; // 개인 순위별 점수이며 DNF는 0점이다.
// 팀 안에서는 명도로 구분한다.
export const TEAM_COLORS = {
  red: [0xff4d4d, 0xb31b1b, 0xff9a9a, 0x6e0f0f],
  blue: [0x3d7bff, 0x173f99, 0x9cc0ff, 0x0b2154],
} as const;
