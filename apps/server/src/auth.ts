import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import { parse } from 'hono/utils/cookie';
import {
  NICKNAME_MAX,
  NICKNAME_MIN,
  TOKEN_COOKIE,
  TOKEN_TTL_SEC,
  type GuestInfo,
} from '@dashrush/shared';
import { COOKIE_SECURE, JWT_SECRET } from './env.ts';

export async function verifyToken(token: string | undefined): Promise<GuestInfo | null> {
  if (!token) return null;
  try {
    const payload = await verify(token, JWT_SECRET, 'HS256');
    if (typeof payload.sub !== 'string' || typeof payload.nick !== 'string') return null;
    return { userId: payload.sub, nickname: payload.nick };
  } catch {
    return null;
  }
}

export function tokenFromCookieHeader(header: string | undefined): string | undefined {
  return header ? parse(header)[TOKEN_COOKIE] : undefined;
}

export const authApi = new Hono();

authApi.post('/guest', async (c) => {
  const body = await c.req.json().catch(() => null);
  const nickname = typeof body?.nickname === 'string' ? body.nickname.trim() : '';
  const len = [...nickname].length;
  if (len < NICKNAME_MIN || len > NICKNAME_MAX) {
    return c.json({ error: 'INVALID_NICKNAME' }, 400);
  }

  const userId = randomUUID();
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
  const token = await sign({ sub: userId, nick: nickname, exp }, JWT_SECRET, 'HS256');
  setCookie(c, TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'Lax',
    path: '/',
    maxAge: TOKEN_TTL_SEC,
  });
  return c.json({ userId, nickname } satisfies GuestInfo);
});

authApi.post('/logout', (c) => {
  deleteCookie(c, TOKEN_COOKIE, { path: '/', secure: COOKIE_SECURE });
  return c.body(null, 204);
});

// HttpOnly 쿠키는 스크립트가 읽을 수 없어, 재방문 시 닉네임 입력을 건너뛸지 판단하려면 서버에 물어야 한다.
authApi.get('/me', async (c) => {
  const guest = await verifyToken(getCookie(c, TOKEN_COOKIE));
  return guest ? c.json(guest) : c.json({ error: 'UNAUTHORIZED' }, 401);
});
