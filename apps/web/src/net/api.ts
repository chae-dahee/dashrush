import type { GuestInfo } from '@dashrush/shared';

export async function fetchMe(): Promise<GuestInfo | null> {
  const res = await fetch('/api/me');
  return res.ok ? res.json() : null;
}

export async function createGuest(nickname: string): Promise<GuestInfo> {
  const res = await fetch('/api/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname }),
  });
  if (!res.ok) throw new Error(res.status === 400 ? '닉네임은 2~12자여야 합니다.' : '서버에 연결할 수 없습니다.');
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' });
}
