// V12.9 tap-note skins. Pure Canvas2D painters so gameplay and the loadout preview draw identical notes.
import type { NoteSkin } from '../cosmetics/catalog.js';

export interface TapItem { x:number; y:number; w:number; h:number; hot?:boolean; gray?:boolean }

const LOST_FILL = ['rgba(255,220,220,.96)', 'rgba(248,113,113,.88)', 'rgba(126,58,58,.92)'];
const LOST_STROKE = 'rgba(255,235,235,.72)';
export const LOST_GLOW = 'rgba(248,113,113,.55)';

function roundRect(path:Path2D, x:number, y:number, w:number, h:number, r:number):void {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  path.moveTo(x + rr, y);
  path.lineTo(x + w - rr, y); path.quadraticCurveTo(x + w, y, x + w, y + rr);
  path.lineTo(x + w, y + h - rr); path.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  path.lineTo(x + rr, y + h); path.quadraticCurveTo(x, y + h, x, y + h - rr);
  path.lineTo(x, y + rr); path.quadraticCurveTo(x, y, x + rr, y);
  path.closePath();
}

function bodyPath(item:TapItem, shape:NoteSkin['shape']):Path2D {
  const p = new Path2D(), x = item.x - item.w / 2, y = item.y - item.h / 2;
  const r = shape === 'capsule' ? item.h / 2 : Math.max(1.5, Math.min(5, item.w * .16));
  roundRect(p, x, y, item.w, item.h, r);
  return p;
}

/**
 * Paints one tap note. The caller owns shadowColor/shadowBlur for the body glow;
 * strokes and premium details are drawn without shadow to keep the batch cheap.
 */
export function paintTap(c:CanvasRenderingContext2D, item:TapItem, skin:NoteSkin, timeMs:number):void {
  const gray = !!item.gray, hot = !!item.hot;
  const p = bodyPath(item, skin.shape);
  const y0 = item.y - item.h / 2, y1 = Math.max(y0 + 1, item.y + item.h / 2);
  let fill:CanvasGradient;
  if (!gray && skin.shape === 'prism') {
    fill = c.createLinearGradient(item.x - item.w / 2, 0, item.x + item.w / 2, 0);
    const hue = (timeMs / 9) % 360;
    for (let i = 0; i <= 4; i++) fill.addColorStop(i / 4, `hsla(${(hue + i * 72) % 360},95%,${hot ? 88 : 80}%,.97)`);
  } else {
    fill = c.createLinearGradient(0, y0, 0, y1);
    const stops = gray ? LOST_FILL : [skin.top, hot ? skin.hotMid : skin.mid, skin.bottom];
    fill.addColorStop(0, stops[0]); fill.addColorStop(.55, stops[1]); fill.addColorStop(1, stops[2]);
  }
  c.fillStyle = fill; c.fill(p);

  const blur = c.shadowBlur; c.shadowBlur = 0;
  c.strokeStyle = gray ? LOST_STROKE : skin.stroke;
  c.lineWidth = skin.shape === 'neon' && !gray ? Math.max(1.4, Math.min(2.6, item.h * .2)) : 1.15;
  c.stroke(p);
  if (!gray) paintDetail(c, item, skin);
  c.shadowBlur = blur;
}

function paintDetail(c:CanvasRenderingContext2D, item:TapItem, skin:NoteSkin):void {
  const { x, y, w, h } = item;
  if (skin.shape === 'gem') {
    const s = Math.max(3, h * .78);
    const gem = new Path2D();
    gem.moveTo(x, y - s); gem.lineTo(x + s, y); gem.lineTo(x, y + s); gem.lineTo(x - s, y); gem.closePath();
    const g = c.createLinearGradient(x, y - s, x, y + s);
    g.addColorStop(0, '#ffffff'); g.addColorStop(.5, skin.accent); g.addColorStop(1, 'rgba(120,53,15,.95)');
    c.fillStyle = g; c.fill(gem);
    c.strokeStyle = 'rgba(255,251,235,.95)'; c.lineWidth = 1; c.stroke(gem);
  } else if (skin.shape === 'neon') {
    c.strokeStyle = skin.accent; c.lineWidth = Math.max(1, h * .12); c.lineCap = 'round';
    c.beginPath(); c.moveTo(x - w * .34, y); c.lineTo(x + w * .34, y); c.stroke(); c.lineCap = 'butt';
  } else if (skin.shape === 'prism') {
    c.fillStyle = 'rgba(255,255,255,.42)';
    c.fillRect(x - w * .42, y - h * .42, w * .84, Math.max(1, h * .22));
  } else if (skin.grade !== 'default') {
    // Basic skins get a single specular line so they read as a distinct tier from the default note.
    c.fillStyle = 'rgba(255,255,255,.35)';
    c.fillRect(x - w * .38, y - h * .36, w * .76, Math.max(1, h * .14));
  }
}
