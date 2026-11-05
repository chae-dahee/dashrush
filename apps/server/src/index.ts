import type { Server as HttpServer } from 'node:http';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '@dashrush/shared';
import { authApi, tokenFromCookieHeader, verifyToken } from './auth.ts';
import { PORT } from './env.ts';

const app = new Hono();
app.route('/api', authApi);
app.get('/api/health', (c) => c.json({ ok: true }));

const httpServer = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`server listening on :${info.port}`);
});

const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
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
  socket.on('time:ping', (clientTime) => {
    if (typeof clientTime !== 'number') return;
    socket.emit('time:pong', { clientTime, serverTime: Date.now() });
  });
});
