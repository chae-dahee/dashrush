import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 쿠키 인증은 웹과 서버가 같은 출처여야 하므로, 개발 중에도 API·소켓을 Vite 출처로 프록시한다.
const server = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': server,
      '/socket.io': { target: server, ws: true },
    },
  },
});
