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
export const DRIFT_SLIP_MIN = 1; // 측면 속력이 이보다 클 때만 미끄러지는 것으로 본다(타일/초).
export const DRIFT_END_MIN_SEC = 0.4; // 이만큼 미끄러진 드리프트를 끝내면 작은 부스트를 얻는다.
export const DRIFT_END_BOOST_SEC = 0.4;
export const BOOST_MUL = 1.4;
export const BOOST_SEC = 1.2; // 부스트 패드

// 부스트 게이지(%)는 버리지 않고 쌓이며, 부스트를 쓸 때만 줄어든다.
export const GAUGE_MAX = 100;
export const GAUGE_DRIFT_RATE = 25; // 미끄러지는 동안 초당 충전량
export const GAUGE_CLEAN_RATE = 3; // 부딪히지 않고 빠르게 달리는 동안 초당 충전량
export const GAUGE_CLEAN_SPEED = 0.6; // 최고 속도 대비 이 비율 이상이어야 빠르게 달리는 것으로 본다.
export const GAUGE_CLEAN_DELAY_SEC = 2; // 부딪힌 뒤 이 시간이 지나야 다시 찬다.
export const BOOST_USE_COST = 25;
export const BOOST_USE_SEC = 1.5;
export const WALL_BOUNCE = 0.3;
export const WALL_SPEED_KEEP = 0.6;
export const WALL_IMPACT_MIN = 2; // 벽으로 들어오던 속력이 이보다 클 때만 감속하고 충돌로 친다(타일/초).
export const WALL_MIN_BOUNCE = 2; // 벽을 민 뒤 바깥으로 튕겨 나가는 최소 속력(타일/초)
export const WALL_SCRAPE_MAX = 0.5; // 이보다 약하게 미는 것은 벽을 스치는 것으로 보고 튕기지 않는다(타일/초).
export const WALL_TURN_MAX = 0.35; // 벽을 밀 때마다 벽을 따라가는 쪽으로 틀어 주는 최대 각도(라디안)
export const START_BOOST_WINDOW = 0.8; // 출발 뒤 이 시간 안에 부스트 키를 새로 누르면 출발 부스트를 얻는다(초).
export const START_BOOST_SEC = 1;
export const FALL_SEC = 1.5;
export const FALL_DRAG = 0.8; // 바다로 떨어지는 동안의 공기 저항(초당 감쇠율)
export const OFFROAD_RESPAWN_SEC = 3;
export const SPAWN_GHOST_SEC = 1.5;
export const CP_MISS_RATIO = 0.1; // 바퀴마다 필수 체크포인트를 이 비율까지 놓쳐도 랩으로 친다.
export const CP_SKIP_MAX = 3; // 한 번에 건너뛸 수 있는 필수 체크포인트 수이며, 반대편 도로로 구간을 통째로 건너뛰는 것을 막는다.

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
// 카트끼리는 진행 방향 선분을 감싼 캡슐로 판정하며, 모형 크기(앞뒤 약 1.06, 폭 약 0.78)에 맞춘다.
export const KART_HIT_RADIUS = 0.39;
export const KART_HIT_HALF = 0.14; // 캡슐 중심 선분의 반길이
export const FINISH_LIMIT_MS = 20000; // 첫 완주 뒤 나머지에게 주는 제한 시간
export const EVENT_RATE_MAX = TICK_RATE * 2; // 소켓 하나가 1초에 보낼 수 있는 이벤트 수
export const CORRECTION_SNAP = 3; // 예측 보정 차이가 이 거리(타일)를 넘으면 오프셋 없이 바로 맞춘다.

export const DISCONNECT_GRACE_MS = 15000;
export const QUICK_START_MS = 20000; // 공개 방에서 첫 준비 뒤 이 시간이 지나면 준비하지 않은 사람이 있어도 출발한다.
export const QUICK_SIZE_MIN = 2;
export const TEAM_SIZE_MAX = MAX_PLAYERS / 2;
export const TEAM_POINTS = [10, 8, 6, 5, 4, 3, 2, 1]; // 개인 순위별 점수이며 DNF는 0점이다.
// 팀 안에서는 명도로 구분한다.
export const TEAM_COLORS = {
  red: [0xff4d4d, 0xb31b1b, 0xff9a9a, 0x6e0f0f],
  blue: [0x3d7bff, 0x173f99, 0x9cc0ff, 0x0b2154],
} as const;
