import type { Server as HttpServer } from 'node:http';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { Server } from 'socket.io';
import { EVENT_RATE_MAX, MAPS, MAX_PLAYERS, QUICK_SIZE_MIN, validateMap, type ClientToServerEvents, type ServerToClientEvents, type SocketData } from '@dashrush/shared';
import { authApi, tokenFromCookieHeader, verifyToken } from './auth.ts';
import { delayed, LAG_MS, PORT } from './env.ts';
import { createRoom, findRoom, quickMatch, RoomError, roomOf, validConfig, type GameServer } from './room.ts';

const mapErrors = Object.values(MAPS).flatMap(validateMap);
if (mapErrors.length) throw new Error(mapErrors.join('\n'));

const app = new Hono();
app.route('/api', authApi);
app.get('/api/health', (c) => c.json({ ok: true }));
app.use('*', serveStatic({ root: '../web/dist' }));

const httpServer = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`server listening on :${info.port}${LAG_MS ? ` (인위적 지연 ${LAG_MS}ms)` : ''}`);
});

const io: GameServer = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
  httpServer as HttpServer,
);

io.use(async (socket, next) => {
  const guest = await verifyToken(tokenFromCookieHeader(socket.handshake.headers.cookie));
  if (!guest) return next(new Error('UNAUTHORIZED'));
  socket.data.userId = guest.userId;
  socket.data.nickname = guest.nickname;
  next();
});

io.on('connection', (socket) => {
  const { userId } = socket.data;

  let windowStart = 0;
  let count = 0;
  socket.use((_, next) => {
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      count = 0;
    }
    if (++count > EVENT_RATE_MAX) return;
    delayed(next);
  });

  const handle = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      if (!(err instanceof RoomError)) throw err;
      const error = { code: err.code, message: err.message };
      delayed(() => socket.emit('room:error', error));
    }
  };
  const invalid = () => {
    throw new RoomError('INVALID', '잘못된 요청입니다.');
  };

  socket.on('time:ping', (clientTime) => {
    if (typeof clientTime !== 'number') return;
    const pong = { clientTime, serverTime: Date.now() };
    delayed(() => socket.emit('time:pong', pong));
  });

  socket.on('room:create', (p) =>
    handle(() => {
      if (!validConfig(p)) invalid();
      createRoom(io, p).join(socket);
    }),
  );
  socket.on('room:join', (p) => handle(() => findRoom(p?.code).join(socket)));
  socket.on('room:leave', () => roomOf(userId)?.leave(userId));
  socket.on('room:config', (p) =>
    handle(() => {
      if (!validConfig(p)) invalid();
      roomOf(userId)?.config(userId, p);
    }),
  );
  socket.on('room:quickMatch', (p) =>
    handle(() => {
      const size = p?.size;
      if (!Number.isInteger(size) || size < QUICK_SIZE_MIN || size > MAX_PLAYERS) invalid();
      quickMatch(io, socket, size);
    }),
  );
  socket.on('room:ready', (p) => {
    if (typeof p?.ready === 'boolean') roomOf(userId)?.setReady(userId, p.ready);
  });
  socket.on('room:team', (p) =>
    handle(() => {
      if (p?.team !== 'red' && p?.team !== 'blue') invalid();
      roomOf(userId)?.setTeam(userId, p.team);
    }),
  );
  socket.on('room:bot', (p) =>
    handle(() => {
      const room = roomOf(userId);
      if (p?.action === 'add') room?.addBot(userId);
      else if (p?.action === 'remove' && typeof p.botId === 'string') room?.removeBot(userId, p.botId);
      else invalid();
    }),
  );
  socket.on('room:start', () => handle(() => roomOf(userId)?.start(userId)));
  socket.on('race:input', (p) => roomOf(userId)?.input(userId, socket.id, p));
  socket.on('disconnect', () => roomOf(userId)?.disconnect(userId, socket.id));

  // 진행 중인 방이 있으면 유예를 풀고 이 소켓을 그 방에 되돌린다.
  roomOf(userId)?.join(socket);
});
