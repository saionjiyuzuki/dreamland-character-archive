// @ts-nocheck
// V11 renderer boundary: Canvas note/hold rendering stays isolated from gameplay timing and input.
import { activeNoteSkin } from '../cosmetics/catalog.js';
import { paintTap, LOST_GLOW } from './noteSkins.js';
export interface RendererDeps {
  D: any;
  Layout: { w:number; h:number };
  G: any;
  PERSP: { horizonRatio:number; judgeRatio:number; kTop:number };
  visualPerspective: () => { cx:number; horizonY:number; judgeY:number };
  visualLaneCount: () => number;
  perspectiveProfile: (lanes:number) => { cxRatio:number; horizonRatio:number; judgeRatio:number };
}

export function createNoteRenderer(D:any, Layout:{w:number;h:number}) {
  return {
  canvas:D.noteCanvas,
  ctx:null,
  dpr:1,
  w:0,
  h:0,
  init(){
    this.ctx=this.canvas.getContext('2d',{alpha:true,desynchronized:false});
    this.resize();
  },
  resize(){
    if(!this.canvas || !this.ctx) return;
    const w=Math.max(1,Layout.w || D.gameplay.clientWidth || window.innerWidth);
    const h=Math.max(1,Layout.h || D.gameplay.clientHeight || window.innerHeight);
    const dpr=Math.min(2,window.devicePixelRatio||1);
    this.dpr=dpr; this.w=w; this.h=h;
    this.canvas.width=Math.max(1,Math.floor(w*dpr));
    this.canvas.height=Math.max(1,Math.floor(h*dpr));
    this.canvas.style.width=w+'px';
    this.canvas.style.height=h+'px';
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
    this.ctx.imageSmoothingEnabled=true;
  },
  clear(){
    if(!this.ctx) return;
    this.ctx.save();
    this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
    this.ctx.clearRect(0,0,this.w,this.h);
    this.ctx.restore();
  },
  begin(){
    const c=this.ctx;
    if(!c) return null;
    c.save();
    c.setTransform(this.dpr,0,0,this.dpr,0,0);
    c.clearRect(0,0,this.w,this.h);
    c.globalCompositeOperation='source-over';
    c.globalAlpha=1;
    c.shadowBlur=0;
    c.lineCap='butt';
    c.lineJoin='round';
    return c;
  },
  end(){ if(this.ctx) this.ctx.restore(); },
  roundRectPath(path,x,y,w,h,r){
    const rr=Math.min(r,Math.abs(w)/2,Math.abs(h)/2);
    path.moveTo(x+rr,y);
    path.lineTo(x+w-rr,y);
    path.quadraticCurveTo(x+w,y,x+w,y+rr);
    path.lineTo(x+w,y+h-rr);
    path.quadraticCurveTo(x+w,y+h,x+w-rr,y+h);
    path.lineTo(x+rr,y+h);
    path.quadraticCurveTo(x,y+h,x,y+h-rr);
    path.lineTo(x,y+rr);
    path.quadraticCurveTo(x,y,x+rr,y);
    path.closePath();
  },
  appendHoldPath(path,samples){
    if(!samples.length) return;
    path.moveTo(samples[0].left,samples[0].y);
    for(let i=1;i<samples.length;i++) path.lineTo(samples[i].left,samples[i].y);
    for(let i=samples.length-1;i>=0;i--) path.lineTo(samples[i].right,samples[i].y);
    path.closePath();
  },
  appendCenterLine(path,samples){
    if(!samples.length) return;
    path.moveTo((samples[0].left+samples[0].right)*.5,samples[0].y);
    for(let i=1;i<samples.length;i++) path.lineTo((samples[i].left+samples[i].right)*.5,samples[i].y);
  },
  appendHead(path,head,gray){
    path.moveTo(head.left,head.y);
    path.lineTo(head.right,head.y);
  },
  // Tap notes are painted by the equipped V-PASS note skin (src/render/noteSkins.ts).
  drawSingleTap(c,item){
    const skin=activeNoteSkin();
    c.save();
    c.globalAlpha=item.alpha;
    c.shadowColor=item.gray?LOST_GLOW:skin.glow;
    c.shadowBlur=item.hot?18:11;
    paintTap(c,item,skin,performance.now());
    c.restore();
  },
  // Translucent hold body: one flat tint plus a faint contour, nothing drawn inside.
  // Equipped Coin-shop cosmetics tint it through the --hold CSS variable.
  paintHoldBody(c,body,gray){
    const equippedHoldColor = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue('--hold').trim() : '';
    const color=gray?'rgb(252,165,165)':(equippedHoldColor||'rgb(153,246,228)');
    const a=c.globalAlpha;
    c.fillStyle=color; c.globalAlpha=a*.26; c.fill(body);
    c.strokeStyle=color; c.globalAlpha=a*.55; c.lineWidth=1; c.stroke(body);
    c.globalAlpha=a;
  },
  drawSingleHold(c,item){
    const {samples,alpha,holding,gray}=item;
    if(!samples.length) return;
    c.save(); c.globalAlpha=alpha;
    const body=new Path2D(); this.appendHoldPath(body,samples);
    this.paintHoldBody(c,body,gray);
    const head=new Path2D(); this.appendHead(head,samples[0],gray);
    c.strokeStyle=gray?'rgba(254,202,202,.95)':'rgba(236,254,255,.96)';
    c.lineWidth=Math.max(2,Math.min(4,(samples[0].right-samples[0].left)*.14));
    c.lineCap='round'; c.stroke(head);
    c.restore();
  },
  drawSingleTick(c,item){
    const {x,y,w,alpha,gray}=item;
    c.save();
    c.globalAlpha=alpha;
    c.strokeStyle=gray?'rgba(255,220,220,.92)':'rgba(255,255,255,.94)';
    c.lineWidth=Math.max(1.5,Math.min(3,w*.09));
    c.lineCap='round';
    c.shadowColor=gray?'rgba(248,113,113,.78)':'rgba(110,231,214,.84)'; c.shadowBlur=8;
    c.beginPath(); c.moveTo(x-w/2,y); c.lineTo(x+w/2,y); c.stroke();
    c.lineWidth=Math.max(1.2,Math.min(2.5,w*.08)); c.shadowBlur=5;
    c.beginPath(); c.moveTo(x,y-3); c.lineTo(x,y+3); c.stroke();
    c.restore();
  },
  drawTapBatch(c,items,gray,hot){
    if(!items.length)return;
    const skin=activeNoteSkin(),now=performance.now();
    c.save();c.globalAlpha=1;c.shadowColor=gray?LOST_GLOW:skin.glow;c.shadowBlur=hot?16:10;
    for(const item of items) paintTap(c,item,skin,now);
    c.restore();
  },
  drawHoldBatch(c,items){
    if(!items.length)return;
    for(const item of items){
      const {samples,gray,holding}=item;
      if(!samples.length)continue;
      c.save();
      const body=new Path2D(); this.appendHoldPath(body,samples);
      this.paintHoldBody(c,body,gray);
      const head=new Path2D(); this.appendHead(head,samples[0],gray);
      c.strokeStyle=gray?'rgba(254,202,202,.95)':'rgba(236,254,255,.96)';
      c.lineWidth=Math.max(2,Math.min(4,(samples[0].right-samples[0].left)*.14));
      c.lineCap='round'; c.stroke(head);
      c.restore();
    }
  },
  drawTickBatch(c,items,gray){
    if(!items.length) return;
    const p=new Path2D(), cross=new Path2D();
    let maxW=0;
    for(const item of items){
      p.moveTo(item.x-item.w/2,item.y); p.lineTo(item.x+item.w/2,item.y);
      cross.moveTo(item.x,item.y-3); cross.lineTo(item.x,item.y+3);
      maxW=Math.max(maxW,item.w);
    }
    c.save();
    c.globalAlpha=1;
    c.strokeStyle=gray?'rgba(255,220,220,.92)':'rgba(255,255,255,.94)';
    c.lineWidth=Math.max(1.5,Math.min(3,maxW*.09));
    c.lineCap='round';
    c.shadowColor=gray?'rgba(248,113,113,.78)':'rgba(110,231,214,.84)'; c.shadowBlur=8; c.stroke(p);
    c.lineWidth=Math.max(1.2,Math.min(2.5,maxW*.08)); c.shadowBlur=5; c.stroke(cross);
    c.lineCap='butt'; c.shadowBlur=0; c.restore();
  },
  drawFrame(c,taps,holds,ticks){
    // Fading notes retain per-item alpha via the single-item fallback; steady-state notes are batched.
    const normalTaps=taps.filter(x=>x.alpha>=.999 && !x.gray && !x.hot);
    const hotTaps=taps.filter(x=>x.alpha>=.999 && !x.gray && x.hot);
    const grayTaps=taps.filter(x=>x.alpha>=.999 && x.gray);
    const fadingTaps=taps.filter(x=>x.alpha<.999);
    this.drawHoldBatch(c,holds.filter(x=>x.alpha>=.999));
    const grayTicks=ticks.filter(x=>x.alpha>=.999 && x.gray);
    const normalTicks=ticks.filter(x=>x.alpha>=.999 && !x.gray);
    this.drawTickBatch(c,grayTicks,true);
    this.drawTickBatch(c,normalTicks,false);
    this.drawTapBatch(c,normalTaps,false,false);
    this.drawTapBatch(c,hotTaps,false,true);
    this.drawTapBatch(c,grayTaps,true,false);
    for(const item of fadingTaps) this.drawSingleTap(c,item);
    for(const item of holds) if(item.alpha<.999) this.drawSingleHold(c,item);
    for(const item of ticks) if(item.alpha<.999) this.drawSingleTick(c,item);
  }
  };
}

export function renderLanes(deps:RendererDeps):void {
  const {D, Layout, G, PERSP, visualPerspective, visualLaneCount}=deps;
  const w = Layout.w, h = Layout.h;
  const vp=visualPerspective();
  const cx = vp.cx;
  const horizonY = vp.horizonY;
  const judgeY = vp.judgeY;
  const lc = visualLaneCount();
  const fallTime = G.fallTime || 1500;
  const T = fallTime / 4;

  let svg = `<defs>
    <linearGradient id="lg0" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#05050e"/>
      <stop offset="100%" stop-color="#0c0c1c"/>
    </linearGradient>
    <linearGradient id="lg1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#07070f"/>
      <stop offset="100%" stop-color="#101020"/>
    </linearGradient>
    <linearGradient id="lgJudge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="rgba(125,211,252,0)"/>
      <stop offset="50%" stop-color="rgba(125,211,252,0.9)"/>
      <stop offset="100%" stop-color="rgba(125,211,252,0)"/>
    </linearGradient>
  </defs>`;

  const kBottom = 1.0;
  const kTop = PERSP.kTop;
  const yB = horizonY + (judgeY - horizonY) * kBottom;
  const yT = horizonY + (judgeY - horizonY) * kTop;

  for (let i = 0; i < lc; i++){
    const xLJ = i * w / lc;
    const xRJ = (i + 1) * w / lc;
    const xLT = cx + (xLJ - cx) * kTop;
    const xRT = cx + (xRJ - cx) * kTop;
    svg += `<polygon points="${xLJ},${yB} ${xRJ},${yB} ${xRT},${yT} ${xLT},${yT}" fill="url(#lg${i % 2})" stroke="rgba(125,211,252,0.10)" stroke-width="1"/>`;
  }

  const gridCount = 14;
  for (let i = 1; i < gridCount; i++){
    const dt = (i / gridCount) * fallTime;
    const k = 1 / (1 + dt / T);
    const y = horizonY + (judgeY - horizonY) * k;
    if (y > judgeY - 2) continue;
    const xL = cx + (0 - cx) * k;
    const xR = cx + (w - cx) * k;
    const op = 0.02 + (1 - i / gridCount) * 0.10;
    svg += `<line x1="${xL.toFixed(1)}" y1="${y.toFixed(1)}" x2="${xR.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(125,211,252,${op.toFixed(3)})" stroke-width="1"/>`;
  }

  svg += `<line x1="0" y1="${yB}" x2="${w}" y2="${yB}" stroke="rgba(125,211,252,0.6)" stroke-width="1.5"/>`;
  D.laneSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  D.laneSvg.setAttribute('width', w);
  D.laneSvg.setAttribute('height', h);
  D.laneSvg.innerHTML = svg;
  D.judgeLine.style.top = (judgeY - 1) + 'px';
}
