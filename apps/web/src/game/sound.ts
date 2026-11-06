// 효과음은 에셋 없이 Web Audio로 합성한다. 브라우저는 사용자 입력 전에는 소리를 막으므로 첫 입력에서 시작한다.

const MUTE_KEY = 'dashrush.muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
})();

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return { ctx, out: master! };
}

for (const ev of ['keydown', 'pointerdown']) window.addEventListener(ev, () => audio(), { passive: true });

export const isMuted = () => muted;

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // 저장하지 못해도 이번 접속에서는 설정을 쓴다.
  }
  if (master) master.gain.value = value ? 0 : 0.5;
}

function tone(freq: number, durSec: number, type: OscillatorType = 'square', gain = 0.2, delaySec = 0) {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime + delaySec;
  const osc = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + durSec);
  osc.connect(g).connect(a.out);
  osc.start(t);
  osc.stop(t + durSec);
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function noise(durSec: number, freq: number, gain: number) {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime;
  const src = a.ctx.createBufferSource();
  src.buffer = noiseBuffer(a.ctx);
  const filter = a.ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(freq, t);
  filter.frequency.exponentialRampToValueAtTime(freq * 3, t + durSec);
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + durSec);
  src.connect(filter).connect(g).connect(a.out);
  src.start(t);
  src.stop(t + durSec);
}

export const sfx = {
  countdown: (text: string) => (text === 'GO!' ? tone(1046, 0.5, 'square', 0.18) : tone(523, 0.18, 'square', 0.18)),
  lap: () => {
    tone(784, 0.12, 'triangle', 0.25);
    tone(1046, 0.2, 'triangle', 0.25, 0.1);
  },
  finish: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'triangle', 0.25, i * 0.12)),
  boost: () => noise(0.5, 400, 0.35),
  bump: () => tone(110, 0.15, 'sine', 0.5),
};

// 경주 화면에서 매 프레임 내 카트 상태를 보고 효과음을 낸다.
export class RaceSound {
  private engine = new EngineSound();
  private others = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
  private boosting = false;

  // 다른 카트 엔진음은 내 카트와의 거리에 따라 줄여, 8대가 한꺼번에 시끄럽게 겹치지 않게 한다.
  otherEngines(karts: { id: string; speed: number; dist: number }[]) {
    const a = audio();
    if (!a || a.ctx.state !== 'running') return;
    const t = a.ctx.currentTime;
    for (const k of karts) {
      let e = this.others.get(k.id);
      if (!e) {
        const osc = a.ctx.createOscillator();
        osc.type = 'sawtooth';
        const lowpass = a.ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 500;
        const gain = a.ctx.createGain();
        gain.gain.value = 0;
        osc.connect(lowpass).connect(gain).connect(a.out);
        osc.start();
        e = { osc, gain };
        this.others.set(k.id, e);
      }
      e.osc.frequency.setTargetAtTime(50 + k.speed * 13, t, 0.05);
      e.gain.gain.setTargetAtTime(Math.max(0, 1 - k.dist / OTHER_ENGINE_RANGE) * 0.04, t, 0.1);
    }
    for (const [id, e] of this.others) {
      if (karts.some((k) => k.id === id)) continue;
      e.osc.stop();
      this.others.delete(id);
    }
  }

  frame(me: { speed: number; drifting: boolean; boostLeft: number }, hit: boolean) {
    this.engine.update(me.speed, me.drifting);
    if (me.boostLeft > 0 && !this.boosting) sfx.boost();
    this.boosting = me.boostLeft > 0;
    if (hit) sfx.bump();
  }

  countdown(text: string | null) {
    if (text) sfx.countdown(text);
  }

  stop() {
    this.engine.stop();
    for (const e of this.others.values()) e.osc.stop();
    this.others.clear();
  }
}

const OTHER_ENGINE_RANGE = 15; // 이 거리(타일)보다 먼 카트의 엔진음은 들리지 않는다.

// 내 카트의 엔진과 드리프트 소리이다. 속력에 따라 음높이를 바꾼다.
class EngineSound {
  private osc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private skidGain: GainNode | null = null;
  private skid: AudioBufferSourceNode | null = null;

  update(speed: number, drifting: boolean) {
    const a = audio();
    if (!a || a.ctx.state !== 'running') return;
    if (!this.osc) {
      this.osc = a.ctx.createOscillator();
      this.osc.type = 'sawtooth';
      const lowpass = a.ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 600;
      this.engineGain = a.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.osc.connect(lowpass).connect(this.engineGain).connect(a.out);
      this.osc.start();

      this.skid = a.ctx.createBufferSource();
      this.skid.buffer = noiseBuffer(a.ctx);
      this.skid.loop = true;
      const band = a.ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2200;
      this.skidGain = a.ctx.createGain();
      this.skidGain.gain.value = 0;
      this.skid.connect(band).connect(this.skidGain).connect(a.out);
      this.skid.start();
    }
    const t = a.ctx.currentTime;
    this.osc.frequency.setTargetAtTime(55 + speed * 14, t, 0.05);
    this.engineGain!.gain.setTargetAtTime(0.05 + Math.min(speed, 12) * 0.006, t, 0.1);
    this.skidGain!.gain.setTargetAtTime(drifting ? 0.12 : 0, t, 0.05);
  }

  stop() {
    this.osc?.stop();
    this.skid?.stop();
    this.osc = this.skid = null;
  }
}
