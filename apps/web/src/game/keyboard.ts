import { INPUT_ACCEL, INPUT_BRAKE, INPUT_DRIFT, INPUT_LEFT, INPUT_RIGHT } from '@dashrush/shared';

const KEY_BITS: Record<string, number> = {
  ArrowUp: INPUT_ACCEL,
  KeyW: INPUT_ACCEL,
  ArrowDown: INPUT_BRAKE,
  KeyS: INPUT_BRAKE,
  ArrowLeft: INPUT_LEFT,
  KeyA: INPUT_LEFT,
  ArrowRight: INPUT_RIGHT,
  KeyD: INPUT_RIGHT,
  Space: INPUT_DRIFT,
  ShiftLeft: INPUT_DRIFT,
  ShiftRight: INPUT_DRIFT,
};

// 화면 터치 버튼이 누른 입력 비트이다. 키보드 입력과 합쳐 보낸다.
export const touch = { bits: 0 };

export class Keyboard {
  private pressed = new Set<string>();

  private onDown = (e: KeyboardEvent) => {
    if (!(e.code in KEY_BITS)) return;
    e.preventDefault();
    this.pressed.add(e.code);
  };
  private onUp = (e: KeyboardEvent) => this.pressed.delete(e.code);
  // 창이 포커스를 잃으면 keyup이 오지 않아 키가 눌린 채로 남으므로 모두 뗀다.
  private onBlur = () => {
    this.pressed.clear();
    touch.bits = 0;
  };

  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  bits(): number {
    let bits = touch.bits;
    for (const code of this.pressed) bits |= KEY_BITS[code];
    return bits;
  }

  dispose() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
