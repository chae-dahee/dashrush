export const INPUT_ACCEL = 1;
export const INPUT_BRAKE = 2;
export const INPUT_LEFT = 4;
export const INPUT_RIGHT = 8;
export const INPUT_DRIFT = 16;
export const INPUT_MAX = 31;

export const has = (bits: number, flag: number) => (bits & flag) !== 0;
