import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@dashrush/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

export function getSocket(): GameSocket {
  socket ??= io({ autoConnect: false });
  return socket;
}

// 토큰이 바뀌면 새 쿠키로 handshake를 다시 하도록 기존 연결을 버린다.
export function resetSocket(): GameSocket {
  socket?.disconnect();
  socket = null;
  return getSocket();
}
