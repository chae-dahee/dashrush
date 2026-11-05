const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET 환경 변수가 필요하다.');

export const JWT_SECRET: string = secret;
export const PORT = Number(process.env.PORT ?? 3000);
