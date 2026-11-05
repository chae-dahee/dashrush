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
  if (!res.ok) throw new Error('닉네임은 2~12자여야 합니다.');
  return res.json();
}
