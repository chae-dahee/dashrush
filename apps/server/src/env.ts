const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET 환경 변수가 필요하다.');

export const JWT_SECRET: string = secret;
export const PORT = Number(process.env.PORT ?? 3000);

// 개발용 인위적 지연이다. 받는 쪽과 보내는 쪽에 절반씩 걸어 왕복 지연이 이 값이 되게 한다.
export const LAG_MS = Number(process.env.LAG_MS ?? 0);

export function delayed(fn: () => void) {
  if (LAG_MS > 0) setTimeout(fn, LAG_MS / 2);
  else fn();
}
