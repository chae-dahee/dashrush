import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { DRIFT_TIERS, driftTier, INPUT_ACCEL, INPUT_BRAKE, INPUT_DRIFT, INPUT_LEFT, INPUT_RIGHT } from '@dashrush/shared';
import { touch } from '../game/keyboard.ts';
import type { ViewMode } from '../game/RaceView.ts';
import { DRIFT_TIER_COLORS } from '../game/scene.ts';
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
  drifting: boolean;
  driftCharge: number;
  boostLeft: number;
}

export function updateGauge(el: HTMLDivElement | null, g: GaugeState) {
  if (!el) return;
  let from = 0;
  el.querySelectorAll<HTMLDivElement>('[data-seg]').forEach((seg, i) => {
    const to = DRIFT_TIERS[i].charge;
    const fill = g.drifting ? Math.min(1, Math.max(0, (g.driftCharge - from) / (to - from))) : 0;
    seg.style.width = `${fill * 100}%`;
    from = to;
  });
  const label = el.querySelector<HTMLDivElement>('[data-label]')!;
  const tier = driftTier(g.driftCharge);
  label.textContent = g.boostLeft > 0 ? 'BOOST!' : g.drifting ? (tier > 0 ? `${tier}단` : '드리프트') : '';
  el.style.opacity = g.drifting || g.boostLeft > 0 ? '1' : '0.4';
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
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', fontFamily: 'system-ui, sans-serif' }}>
      <style>{`@keyframes pop { from { transform: translate(-50%, -50%) scale(1.8); opacity: 0.4 } to { transform: translate(-50%, -50%) scale(1); opacity: 1 } }`}</style>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={hudStyle}>{hud}</div>
      <canvas ref={minimapRef} style={minimapStyle} />
      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8 }}>
        <button style={buttonStyle} onClick={toggleMute}>
          {mute ? '소리 켜기' : '소리 끄기'}
        </button>
        <button style={buttonStyle} onClick={onToggleView}>
          {view === 'third' ? '1인칭' : '3인칭'} (V)
        </button>
        <button style={buttonStyle} onClick={onExit}>
          나가기
        </button>
      </div>
      <div ref={gaugeRef} style={gaugeStyle}>
        <div data-label style={{ height: 20, fontWeight: 900, color: '#fff', WebkitTextStroke: '1px #2b2340' }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {DRIFT_TIER_COLORS.map((c) => (
            <div key={c} style={gaugeSlotStyle}>
              <div data-seg style={{ height: '100%', width: 0, background: '#' + c.toString(16).padStart(6, '0') }} />
            </div>
          ))}
        </div>
      </div>
      {wrongWay && <div style={wrongWayStyle}>역주행!</div>}
      {countdown && (
        <div key={countdown} style={countdownStyle}>
          {countdown}
        </div>
      )}
      {overlay && <div style={overlayStyle}>{overlay}</div>}
      {isTouch && <TouchControls />}
    </div>
  );
}

const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const TOUCH_LEFT = [
  { label: '가속', bit: INPUT_ACCEL },
  { label: '브레이크', bit: INPUT_BRAKE },
  { label: '드리프트', bit: INPUT_DRIFT },
];
const TOUCH_RIGHT = [
  { label: '◀', bit: INPUT_LEFT },
  { label: '▶', bit: INPUT_RIGHT },
];

// 왼손은 가속·브레이크·드리프트, 오른손은 좌·우 회전이다.
function TouchControls() {
  useEffect(() => () => void (touch.bits = 0), []);
  const button = ({ label, bit }: { label: string; bit: number }) => {
    const press = (e: React.PointerEvent) => {
      e.preventDefault();
      touch.bits |= bit;
    };
    const release = () => (touch.bits &= ~bit);
    return (
      <button
        key={label}
        style={touchButtonStyle}
        onPointerDown={press}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={release}
        onContextMenu={(e) => e.preventDefault()}
      >
        {label}
      </button>
    );
  };
  return (
    <>
      <div style={{ ...touchPadStyle, left: 12 }}>{TOUCH_LEFT.map(button)}</div>
      <div style={{ ...touchPadStyle, right: 12 }}>{TOUCH_RIGHT.map(button)}</div>
    </>
  );
}

export const TEAM_NAMES = { red: '레드', blue: '블루' } as const;

export const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 999,
  border: '3px solid #2b2340',
  background: '#ffc83d',
  fontWeight: 800,
  cursor: 'pointer',
};

const hudStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  padding: '8px 14px',
  borderRadius: 16,
  background: 'rgba(43,35,64,0.75)',
  color: '#fff',
  fontWeight: 800,
  fontSize: 20,
  fontVariantNumeric: 'tabular-nums',
};

// 오른쪽 아래는 터치 버튼 자리라 미니맵은 오른쪽 위 버튼 아래에 둔다.
const minimapStyle: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  top: 64,
  width: 'min(32vw, 240px)',
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
  fontSize: 32,
  fontWeight: 900,
  pointerEvents: 'none',
};

const gaugeStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  textAlign: 'center',
  fontSize: 18,
  opacity: 0.4,
  pointerEvents: 'none',
};

const gaugeSlotStyle: React.CSSProperties = {
  width: 'min(14vw, 80px)',
  height: 14,
  borderRadius: 7,
  border: '3px solid #2b2340',
  background: 'rgba(255,255,255,0.6)',
  overflow: 'hidden',
};

const touchPadStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 16,
  display: 'flex',
  gap: 10,
  touchAction: 'none',
  userSelect: 'none',
};

const touchButtonStyle: React.CSSProperties = {
  width: 72,
  height: 72,
  borderRadius: '50%',
  border: '3px solid rgba(43,35,64,0.6)',
  background: 'rgba(255,255,255,0.35)',
  fontWeight: 800,
  fontSize: 14,
  touchAction: 'none',
  WebkitUserSelect: 'none',
};

const countdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '35%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  fontSize: 120,
  fontWeight: 900,
  color: '#fff',
  WebkitTextStroke: '6px #2b2340',
  animation: 'pop 0.35s ease-out',
  pointerEvents: 'none',
};

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  padding: '20px 28px',
  borderRadius: 24,
  border: '4px solid #2b2340',
  background: '#fff',
  textAlign: 'center',
  fontWeight: 700,
};
