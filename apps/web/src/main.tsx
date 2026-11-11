import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './ui.css';

// iOS WebKit은 user-scalable=no와 touch-action을 무시하고 빠른 연속 탭과 핀치를 확대로 처리한다.
// React 터치 핸들러는 passive라 막을 수 없으므로 문서에 직접 등록한다. 터치 버튼은 pointer 이벤트로 동작하므로 touchstart를 막아도 된다.
const inside = (e: Event, selector: string) => e.target instanceof Element && e.target.closest(selector) !== null;
document.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length > 1 || inside(e, '.touch-btn')) e.preventDefault();
  },
  { passive: false },
);
let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    if (e.timeStamp - lastTouchEnd < 350 && inside(e, '.race')) e.preventDefault();
    lastTouchEnd = e.timeStamp;
  },
  { passive: false },
);
document.addEventListener('gesturestart', (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(<App />);
