import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import {
  BOOST_USE_COST,
  GAUGE_MAX,
  INPUT_BOOST,
  INPUT_BRAKE,
  INPUT_DRIFT,
  INPUT_LEFT,
  INPUT_RIGHT,
} from '@dashrush/shared';
import { touch } from '../game/keyboard.ts';
import type { ViewMode } from '../game/RaceView.ts';
import { isMuted, setMuted } from '../game/sound.ts';

export const formatMs = (ms: number | null) => {
  if (ms === null) return '-';
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
};

interface Props {
  hostRef: RefObject<HTMLDivElement>;
  minimapRef: RefObject<HTMLCanvasElement>;
  gaugeRef: RefObject<HTMLDivElement>;
  hud: ReactNode;
  view: ViewMode;
  countdown: string | null;
  wrongWay: boolean;
  overlay?: ReactNode;
  onToggleView: () => void;
  onExit: () => void;
}

// 경주 화면의 공통 틀이다. 장면, HUD, 미니맵, 시점·나가기 버튼, 카운트다운을 배치한다.
export interface GaugeState {
  gauge: number;
  boostLeft: number;
  vx: number;
  vy: number;
}

const GAUGE_SLOTS = GAUGE_MAX / BOOST_USE_COST;
const KMH_PER_TILE = 20; // 화면에 보이는 속도(km/h)로 바꾸는 배율이며, 최고 속도 9타일/초가 180km/h가 된다.

// 게이지는 부스트 1회 사용량 단위로 칸을 나눠, 지금 몇 번 쓸 수 있는지 보이게 한다.
export function updateGauge(el: HTMLDivElement | null, g: GaugeState) {
  if (!el) return;
  el.querySelectorAll<HTMLDivElement>('[data-seg]').forEach((seg, i) => {
    const fill = Math.min(1, Math.max(0, (g.gauge - i * BOOST_USE_COST) / BOOST_USE_COST));
    seg.style.width = `${fill * 100}%`;
  });
  const uses = Math.floor(g.gauge / BOOST_USE_COST);
  el.querySelector<HTMLDivElement>('[data-label]')!.textContent =
    g.boostLeft > 0 ? 'BOOST!' : uses > 0 ? `부스트 ${uses}회` : '';
  el.querySelector<HTMLDivElement>('[data-meter]')!.style.opacity = uses > 0 || g.boostLeft > 0 ? '1' : '0.6';
  el.querySelector<HTMLDivElement>('[data-speed]')!.textContent = String(Math.round(Math.hypot(g.vx, g.vy) * KMH_PER_TILE));
}

export function RaceShell({
  hostRef,
  minimapRef,
  gaugeRef,
  hud,
  view,
  countdown,
  wrongWay,
  overlay,
  onToggleView,
  onExit,
}: Props) {
  const [mute, setMute] = useState(isMuted());
  const toggleMute = () => {
    setMuted(!mute);
    setMute(!mute);
  };
  return (
    <div className="race">
      <style>{`@keyframes pop { from { transform: translate(-50%, -50%) scale(1.8); opacity: 0.4 } to { transform: translate(-50%, -50%) scale(1); opacity: 1 } }`}</style>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={hudStyle}>{hud}</div>
      <canvas ref={minimapRef} style={minimapStyle} />
      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8 }}>
        <button className="btn primary small" onClick={toggleMute}>
          {mute ? '소리 켜기' : '소리 끄기'}
        </button>
        <button className="btn primary small" onClick={onToggleView}>
          {view === 'third' ? '1인칭' : '3인칭'} (V)
        </button>
        <button className="btn primary small" onClick={onExit}>
          나가기
        </button>
      </div>
      <div ref={gaugeRef} style={gaugeStyle}>
        <div style={speedStyle}>
          <span data-speed>0</span>
          <span style={{ fontSize: '0.45em', marginLeft: 4 }}>km/h</span>
        </div>
        <div data-meter style={{ opacity: 0.4 }}>
          <div data-label style={{ height: '1.2em', fontWeight: 900, color: '#fff', WebkitTextStroke: '1px #2b2340' }} />
          <div style={{ display: 'flex', gap: 4 }}>
            {Array.from({ length: GAUGE_SLOTS }, (_, i) => (
              <div key={i} style={gaugeSlotStyle}>
                <div data-seg style={{ height: '100%', width: 0, background: 'var(--sun)' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
      {wrongWay && <div style={wrongWayStyle}>역주행!</div>}
      {countdown && (
        <div key={countdown} style={countdownStyle}>
          {countdown}
        </div>
      )}
      {countdown && <div style={startHintStyle}>GO! 때 부스트</div>}
      {overlay && <div className="card overlay">{overlay}</div>}
      {isTouch && <TouchControls />}
    </div>
  );
}

const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

interface TouchKey {
  name: string;
  label?: string;
  bit: number;
  icon: ReactNode;
}

const TOUCH_LEFT: TouchKey[] = [
  { name: 'left', bit: INPUT_LEFT, icon: <polyline points="15,5 8,12 15,19" /> },
  { name: 'right', bit: INPUT_RIGHT, icon: <polyline points="9,5 16,12 9,19" /> },
];
const TOUCH_RIGHT: TouchKey[] = [
  { name: 'brake', label: '브레이크', bit: INPUT_BRAKE, icon: <rect x="6" y="6" width="12" height="12" rx="2" /> },
  { name: 'drift', label: '드리프트', bit: INPUT_DRIFT, icon: <path d="M5 19 C5 11 9 7 18 7 M14 3 L18 7 L14 11" /> },
];
const TOUCH_BOOST: TouchKey = { name: 'boost', label: '부스트', bit: INPUT_BOOST, icon: <polygon points="13,2 5,14 11,14 10,22 19,9 13,9" /> };

function TouchControls() {
  useEffect(() => {
    return () => {
      touch.bits = 0;
    };
  }, []);
  // 누른 표시는 다시 그리지 않고 data-on 속성으로만 바꾼다.
  const button = ({ name, label, bit, icon }: TouchKey) => {
    const press = (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      touch.bits |= bit;
      e.currentTarget.dataset.on = '';
    };
    const release = (e: React.PointerEvent<HTMLButtonElement>) => {
      touch.bits &= ~bit;
      delete e.currentTarget.dataset.on;
    };
    return (
      <button
        key={name}
        className={`touch-btn ${name}`}
        onPointerDown={press}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={release}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg viewBox="0 0 24 24">{icon}</svg>
        {label}
      </button>
    );
  };
  return (
    <>
      <div className="touch-pad" style={{ left: 12 }}>{TOUCH_LEFT.map(button)}</div>
      <div className="touch-pad right">
        {button(TOUCH_BOOST)}
        <div style={{ display: 'flex', gap: 10 }}>{TOUCH_RIGHT.map(button)}</div>
      </div>
    </>
  );
}

export const TEAM_NAMES = { red: '레드', blue: '블루' } as const;

const hudStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  padding: '0.4em 0.7em',
  borderRadius: 16,
  background: 'rgba(43,35,64,0.75)',
  color: '#fff',
  fontWeight: 800,
  fontSize: 'clamp(11px, 3.2cqh, 20px)',
  fontVariantNumeric: 'tabular-nums',
};

// 오른쪽 아래는 터치 버튼 자리라 미니맵은 오른쪽 위 버튼 아래에 둔다.
const minimapStyle: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  top: 'clamp(40px, 11cqh, 64px)',
  width: 'min(24cqw, 240px, 32cqh)',
  borderRadius: 12,
  border: '3px solid #2b2340',
  opacity: 0.9,
};

const wrongWayStyle: React.CSSProperties = {
  position: 'absolute',
  top: '22%',
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '6px 22px',
  borderRadius: 999,
  border: '4px solid #2b2340',
  background: '#e8452c',
  color: '#fff',
  fontSize: 'clamp(16px, 6cqh, 32px)',
  fontWeight: 900,
  pointerEvents: 'none',
};

const gaugeStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 'clamp(10px, 4cqh, 24px)',
  left: '50%',
  transform: 'translateX(-50%)',
  textAlign: 'center',
  fontSize: 'clamp(11px, 3cqh, 18px)',
  pointerEvents: 'none',
};

const speedStyle: React.CSSProperties = {
  fontSize: '2em',
  fontWeight: 900,
  fontStyle: 'italic',
  fontVariantNumeric: 'tabular-nums',
  color: '#fff',
  WebkitTextStroke: '1.5px #2b2340',
  lineHeight: 1,
};

const gaugeSlotStyle: React.CSSProperties = {
  width: 'min(14cqw, 80px)',
  height: 'clamp(8px, 2.4cqh, 14px)',
  borderRadius: 7,
  border: '3px solid #2b2340',
  background: 'rgba(255,255,255,0.6)',
  overflow: 'hidden',
};

const countdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '35%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  fontSize: 'min(120px, 30cqh)',
  fontWeight: 900,
  color: '#fff',
  WebkitTextStroke: '6px #2b2340',
  animation: 'pop 0.35s ease-out',
  pointerEvents: 'none',
};

const startHintStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(35% + min(80px, 20cqh))',
  left: '50%',
  transform: 'translateX(-50%)',
  fontSize: 'clamp(13px, 4cqh, 22px)',
  fontWeight: 900,
  color: '#fff',
  WebkitTextStroke: '1.5px #2b2340',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
};
