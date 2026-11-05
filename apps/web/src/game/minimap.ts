import type { MapData } from '@dashrush/shared';
import { drawFloorCanvas } from './scene.ts';

const PX = 3;

// 시점 뷰에서 보이지 않는 트랙 전체와 카트 위치를 위에서 본 그림으로 보여 준다.
export class Minimap {
  private track: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement, private map: MapData) {
    this.track = drawFloorCanvas(map, PX);
    canvas.width = map.width * PX;
    canvas.height = map.height * PX;
    this.ctx = canvas.getContext('2d')!;
  }

  draw(karts: { x: number; y: number; angle: number; color: string; me: boolean }[]) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.track, 0, 0);
    for (const k of karts) {
      ctx.save();
      ctx.translate(k.x * PX, k.y * PX);
      ctx.rotate(k.angle);
      const r = k.me ? 7 : 5;
      ctx.fillStyle = k.color;
      ctx.strokeStyle = '#2b2340';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(r * 1.4, 0);
      ctx.lineTo(-r, r);
      ctx.lineTo(-r, -r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}
