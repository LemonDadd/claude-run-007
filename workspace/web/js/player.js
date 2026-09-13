// 笔顺动画：SVG 逐笔绘制，requestAnimationFrame 控制进度
import { lookupChar, FLIP } from './data-loader.js';

const TYPE_NAME = { H: '横', V: '竖', P: '撇', N: '捺', D: '点', Z: '折' };
const TYPE_COLOR = { H: '#c0392b', V: '#2c6e8f', P: '#7d5ba6', N: '#d97c1f', D: '#2e8b57', Z: '#b03a2e' };

export class StrokePlayer {
  constructor(wrapEl, infoEl, listEl) {
    this.wrap = wrapEl;
    this.info = infoEl;
    this.list = listEl;
    this.glyph = null;
    this.char = '';
    this.cur = 0;            // 当前笔画（0 起）
    this.progress = 1;       // 当前笔画绘制进度 0..1
    this.playing = false;
    this.loopMode = 'off';   // 'off' | 'one'（单字循环）| 'list'（列表循环，由外部 oncharend 处理）
    this.autoNext = true;    // 一字播完自动进入下一字（由外部 oncharend 处理）
    this.speed = 1;
    this.hold = 250;         // 每笔结束停留 ms
    this.ghostOpacity = 0.18;
    this.showOutline = true;
    this.showMedian = false;
    this.onstroke = null;
    this.onpause = null;
    this.oncharend = null;  // 整字自然播完（非循环模式）回调
    this.raf = 0;
    this.lastT = 0;
    this.holdLeft = 0;
    this.ended = false;     // 是否已自然播完最后一笔（区别于中途暂停）
    this.buildSvg();
  }

  buildSvg() {
    this.wrap.innerHTML = '';
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 1024 1024');
    const defs = document.createElementNS(NS, 'defs');
    defs.innerHTML = `
      <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.2"/>
      </filter>`;
    const gGhost = document.createElementNS(NS, 'g');
    gGhost.setAttribute('class', 'ghost'); gGhost.setAttribute('transform', FLIP);
    const gDone = document.createElementNS(NS, 'g');
    gDone.setAttribute('class', 'done'); gDone.setAttribute('transform', FLIP);
    const gCur = document.createElementNS(NS, 'g');
    gCur.setAttribute('class', 'cur'); gCur.setAttribute('transform', FLIP);
    // clipPath 放在根坐标系的 defs 中（不随 g 翻转）；clip 路径用屏幕坐标（y 翻转）
    const clip = document.createElementNS(NS, 'clipPath');
    clip.setAttribute('id', 'curClip');
    clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
    const clipPathEl = document.createElementNS(NS, 'path');
    clipPathEl.setAttribute('class', 'clip-path');
    clipPathEl.setAttribute('d', '');
    clipPathEl.setAttribute('fill', 'none');
    clipPathEl.setAttribute('stroke', '#000');
    clipPathEl.setAttribute('stroke-width', '205');
    clipPathEl.setAttribute('stroke-linecap', 'round');
    clipPathEl.setAttribute('stroke-linejoin', 'round');
    clipPathEl.setAttribute('stroke-dasharray', '1 1');
    clipPathEl.setAttribute('stroke-dashoffset', '1');
    clip.appendChild(clipPathEl);
    defs.appendChild(clip);
    const gMedian = document.createElementNS(NS, 'g');
    gMedian.setAttribute('class', 'median-layer');
    const gMarkers = document.createElementNS(NS, 'g');
    gMarkers.setAttribute('class', 'markers');
    svg.append(defs, gGhost, gDone, gCur, gMedian, gMarkers);
    this.svg = svg;
    this.gGhost = gGhost;
    this.gDone = gDone;
    this.gCur = gCur;
    this.clipPath = clipPathEl;
    this.gMedian = gMedian;
    this.gMarkers = gMarkers;
    this.wrap.appendChild(svg);
  }

  // 向后兼容：loop 等价于「单字循环」
  get loop() { return this.loopMode === 'one'; }
  set loop(v) { this.loopMode = v ? 'one' : 'off'; }

  async load(ch) {
    this.pause();
    this.char = ch;
    this.glyph = await lookupChar(ch);
    this.cur = 0;
    this.progress = 1;
    this.holdLeft = 0;
    this.ended = false;
    this.render();
    return this.glyph;
  }

  render() {
    const g = this.glyph;
    if (!g) {
      this.wrap.querySelector('svg')?.remove();
      this.wrap.innerHTML = '<div class="empty">暂无该字笔顺数据</div>';
      this.info.textContent = '';
      this.list.innerHTML = '';
      return;
    }
    if (!this.svg || !this.wrap.contains(this.svg)) this.buildSvg();
    const NS = 'http://www.w3.org/2000/svg';
    this.gGhost.innerHTML = '';
    this.gDone.innerHTML = '';
    this.gCur.innerHTML = '';
    this.gMedian.innerHTML = '';
    this.gMarkers.innerHTML = '';

    // 全部未写笔画的浅灰底（轮廓）；当前笔画也保留，墨迹会随笔锋沿中线覆盖上来
    g.s.forEach((d, i) => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', '#9aa3ab');
      let op = this.showOutline ? this.ghostOpacity : 0;
      if (i < this.cur) op = 0;
      p.setAttribute('opacity', op);
      this.gGhost.appendChild(p);
    });
    // 已完成笔画：墨色实心
    for (let i = 0; i < this.cur; i++) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', g.s[i]);
      p.setAttribute('fill', '#1f2d3d');
      this.gDone.appendChild(p);
    }
    // 当前笔画：用沿 median 推进的粗描边 clip 逐渐露出墨迹（clip 在根坐标系，y 需翻转）
    if (this.cur < g.s.length) {
      const med = g.m[this.cur];
      const medD = med.map(([x, y], j) => `${j ? 'L' : 'M'}${x},${1024 - y}`).join(' ');
      const medLen = pathLen(med);
      this.clipPath.setAttribute('d', medD);
      if (medLen < 1) {
        // 退化的单点笔势：直接整笔显示
        this.clipPath.setAttribute('stroke-dasharray', 'none');
        this.clipPath.setAttribute('stroke-dashoffset', '0');
      } else {
        this.clipPath.setAttribute('stroke-dasharray', `${medLen} ${medLen}`);
        this.clipPath.setAttribute('stroke-dashoffset', String(medLen * (1 - this.progress)));
      }
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', g.s[this.cur]);
      path.setAttribute('fill', '#1f2d3d');
      path.setAttribute('class', 'cur-fill');
      path.setAttribute('clip-path', 'url(#curClip)');
      this.gCur.appendChild(path);
      this.drawMovingBrush();
    }
    if (this.showMedian) this.drawMedians();
    this.drawNumberDots();
    this.updateInfo();
    this.buildChips();
  }

  // 沿当前笔画 median 画一支“笔锋”（粗圆头折线），随进度移动
  drawMovingBrush() {
    const g = this.glyph;
    const NS = 'http://www.w3.org/2000/svg';
    // 清掉上一帧的笔锋（折线 + 笔端圆点，均带 .brush）
    this.gMedian.querySelectorAll('.brush').forEach((el) => el.remove());
    if (this.progress <= 0) return;
    const m = g.m[this.cur].map(([x, y]) => [x, 1024 - y]);
    const total = segLen(m);
    const target = total * this.progress;
    let acc = 0;
    const pts = [m[0]];
    for (let i = 1; i < m.length; i++) {
      const dl = Math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1]);
      if (acc + dl >= target) {
        const r = (target - acc) / dl;
        pts.push([m[i - 1][0] + (m[i][0] - m[i - 1][0]) * r, m[i - 1][1] + (m[i][1] - m[i - 1][1]) * r]);
        break;
      }
      acc += dl;
      pts.push(m[i]);
    }
    if (pts.length < 2 && m.length >= 2) pts.push(m[1]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
    const brush = document.createElementNS(NS, 'path');
    brush.setAttribute('d', d);
    brush.setAttribute('class', 'brush');
    brush.setAttribute('fill', 'none');
    brush.setAttribute('stroke', 'rgba(192,57,43,.85)');
    brush.setAttribute('stroke-width', '26');
    brush.setAttribute('stroke-linecap', 'round');
    brush.setAttribute('stroke-linejoin', 'round');
    this.gMedian.appendChild(brush);
    // 笔端圆点
    const tip = pts[pts.length - 1];
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', tip[0]); c.setAttribute('cy', tip[1]); c.setAttribute('r', 16);
    c.setAttribute('fill', '#c0392b');
    c.setAttribute('class', 'brush');
    this.gMedian.appendChild(c);
  }

  drawMedians() {
    const NS = 'http://www.w3.org/2000/svg';
    this.glyph.m.forEach((mm, i) => {
      if (i > this.cur) return;
      const d = mm.map(([x, y], j) => `${j ? 'L' : 'M'}${x},${1024 - y}`).join(' ');
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', i === this.cur ? 'rgba(192,57,43,.6)' : 'rgba(44,110,143,.35)');
      p.setAttribute('stroke-width', '4');
      p.setAttribute('stroke-dasharray', '10 8');
      this.gMedian.appendChild(p);
    });
  }

  drawNumberDots() {
    const NS = 'http://www.w3.org/2000/svg';
    const g = this.glyph;
    for (let i = 0; i <= Math.min(this.cur, g.s.length - 1); i++) {
      const [x, y0] = g.m[i][0];
      const y = 1024 - y0;
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 22);
      c.setAttribute('fill', i === this.cur ? '#c0392b' : 'rgba(44,62,80,.55)');
      this.gMarkers.appendChild(c);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', x); t.setAttribute('y', y + 8);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size', 26); t.setAttribute('fill', '#fff'); t.setAttribute('font-weight', 'bold');
      t.textContent = i + 1;
      this.gMarkers.appendChild(t);
    }
  }

  buildChips() {
    const g = this.glyph;
    this.list.innerHTML = '';
    g.t.split('').forEach((t, i) => {
      const c = document.createElement('span');
      c.className = `chip ${i < this.cur ? 'done' : ''} ${i === this.cur ? 'cur' : ''}`;
      c.textContent = `${i + 1}.${TYPE_NAME[t]}`;
      c.style.borderColor = i === this.cur ? TYPE_COLOR[t] : '';
      c.onclick = () => { this.cur = i; this.progress = 1; this.holdLeft = 0; this.ended = false; this.pause(); this.render(); };
      this.list.appendChild(c);
    });
  }

  updateInfo() {
    const g = this.glyph;
    const t = g.t[this.cur] || '';
    this.info.innerHTML = `第 <b>${Math.min(this.cur + 1, g.s.length)}</b> / ${g.s.length} 笔 ·
      <b style="color:${TYPE_COLOR[t]}">${TYPE_NAME[t] || ''}</b>
      ${g.pinyin ? `· ${g.pinyin}` : ''} ${g.aliasOf ? `（繁体，对应简体「${g.aliasOf}」字形）` : ''}`;
  }

  play() {
    if (!this.glyph) return;
    // 自然播完后再次播放：从头干净开始
    if (this.ended || this.cur >= this.glyph.s.length) {
      this.cur = 0; this.progress = 0; this.holdLeft = 0; this.ended = false;
      this.render();
    } else if (this.holdLeft <= 0 && this.progress >= 1) {
      // 非 hold 状态下面对已成形的一笔（单步/跳笔后点播放）：重画当前笔
      this.progress = 0;
      this.render();
    }
    // 其余情况（笔锋行进中恢复、hold 停留中恢复）保持现场继续
    this.playing = true;
    this.lastT = performance.now();
    const step = (t) => {
      if (!this.playing) return;
      const dt = Math.min(80, t - this.lastT); // 切后台回来避免跳变
      this.lastT = t;
      if (this.holdLeft > 0) {
        // 停留阶段：继续消耗剩余停留时间，随后干净地进入下一笔
        this.holdLeft -= dt;
        if (this.holdLeft <= 0) this.advance();
        this.raf = requestAnimationFrame(step);
        return;
      }
      const med = this.glyph.m[this.cur];
      const medianLen = segLen(med.map(([x, y]) => [x, 1024 - y]));
      // 每笔时长随笔画长度微调（500–2400ms），受笔速影响
      const dur = Math.min(2400, Math.max(500, medianLen * 1.7)) / this.speed;
      this.progress += dt / dur;
      if (this.progress < 1) {
        // 沿 median 推进 clip：墨迹随进度露出（不重渲染整字）
        this.updateClipReveal(med);
        this.drawMovingBrush();
      } else {
        this.progress = 1;
        this.render();          // 落笔成形
        this.holdLeft = this.hold;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  // 更新当前笔画的 clip 露出长度（clip 路径位于根坐标系，使用翻转后的 y）
  updateClipReveal(med = this.glyph.m[this.cur]) {
    const medLen = pathLen(med);
    if (medLen < 1) return;
    const medD = med.map(([x, y], j) => `${j ? 'L' : 'M'}${x},${1024 - y}`).join(' ');
    this.clipPath.setAttribute('d', medD);
    this.clipPath.setAttribute('stroke-dasharray', `${medLen} ${medLen}`);
    this.clipPath.setAttribute('stroke-dashoffset', String(medLen * (1 - this.progress)));
  }

  advance() {
    this.holdLeft = 0;
    this.cur++;
    this.progress = 0;
    if (this.cur >= this.glyph.s.length) {
      if (this.loopMode === 'one') { this.cur = 0; this.ended = false; this.render(); return; }
      this.cur = this.glyph.s.length - 1;
      this.progress = 1;
      this.ended = true;
      this.pause();
      this.render();
      this.oncharend?.();       // 通知外部：整字自然播完（可连播下一字/列表循环）
      return;
    }
    this.ended = false;
    this.render();
    this.onstroke?.(this.cur);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.onpause?.();
  }
  toggle() { this.playing ? this.pause() : this.play(); }

  next() {
    if (!this.glyph) return;
    this.pause();
    this.holdLeft = 0;
    this.ended = false;
    if (this.cur < this.glyph.s.length - 1) { this.cur++; this.progress = 1; this.render(); }
  }
  prev() {
    if (!this.glyph) return;
    this.pause();
    this.holdLeft = 0;
    this.ended = false;
    if (this.cur > 0) { this.cur--; this.progress = 1; this.render(); }
  }
  restart() {
    if (!this.glyph) return;
    this.pause();
    this.cur = 0; this.progress = 0; this.holdLeft = 0; this.ended = false;
    this.render();
    this.play();
  }
}

function segLen(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}
// 源坐标（未翻转）median 折线长度
function pathLen(m) {
  let l = 0;
  for (let i = 1; i < m.length; i++) l += Math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1]);
  return l;
}
