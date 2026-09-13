// 临摹本排版：Canvas 渲染 A4/B5 页面，米字格 / 田字格 / 描红 / 空白
import { lookupChar, isHan } from './data-loader.js';

export const PAPERS = {
  a4: { w: 794, h: 1123, label: 'A4 纵向' },     // 96dpi px
  a4l: { w: 1123, h: 794, label: 'A4 横向' },
  b5: { w: 666, h: 945, label: 'B5' },
};

const GRID_COLOR = '#d9534f';
const INK = '#c0392b';

export async function renderSheet(options) {
  const {
    text, grid = 'tian', cols = 8, rowsPerChar = 2, trace = 0.3,
    paper = 'a4', pinyin = true, order = true, dedupe = false, onProgress, scale = 2,
    header = true, headerTitle = '', headerName = '',
  } = options;

  let chars = Array.from(text).filter(isHan);
  if (dedupe) chars = [...new Set(chars)];
  // 字形去重后并行加载（不同字块并发拉取）
  const uniq = [...new Set(chars)];
  let done = 0;
  const entries = await Promise.all(uniq.map(async (ch) => {
    const g = await lookupChar(ch).catch(() => null);
    done++;
    if (done % 8 === 0 || done === uniq.length) onProgress?.(done, uniq.length);
    return [ch, g];
  }));
  const glyphs = new Map(entries);

  const P = PAPERS[paper];
  const margin = Math.round(P.w * 0.06);
  const rowGap = 16;                 // 行距，用于放拼音
  // 页眉区（标题 + 姓名/日期虚线）；header=true 即保留页眉带（姓名留空则画手写虚线）
  const hasHeader = !!header;
  const headerH = hasHeader ? 64 : 0;
  const topPad = margin + headerH;
  const cell = Math.floor((P.w - margin * 2) / cols);
  const pitchY = cell + rowGap;
  const rowsAvail = Math.max(1, Math.floor((P.h - topPad - margin - 30) / pitchY));
  const cellsPerPage = rowsAvail * cols;

  // 展开成“格子序列”：每个字占 rowsPerChar 行；第一格描红、其余按格子类型
  const seq = [];
  for (const ch of chars) {
    const n = rowsPerChar * cols;
    for (let k = 0; k < n; k++) seq.push({ ch, k });
  }
  const pages = [];
  for (let start = 0; start < seq.length; start += cellsPerPage) {
    pages.push(seq.slice(start, start + cellsPerPage));
  }
  if (!pages.length) pages.push([]);

  const canvases = [];
  pages.forEach((cells, pi) => {
    const cv = document.createElement('canvas');
    cv.width = P.w * scale; cv.height = P.h * scale;
    cv.style.aspectRatio = `${P.w} / ${P.h}`;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, P.w, P.h);

    if (hasHeader) drawHeader(ctx, P, margin, { title: headerTitle, name: headerName, pageNo: pi + 1, pageTotal: pages.length });

    cells.forEach((cell0, idx) => {
      const r = Math.floor(idx / cols), c = idx % cols;
      const x = margin + c * cell, y = topPad + r * pitchY;
      drawGrid(ctx, x, y, cell, grid);
      const g = glyphs.get(cell0.ch);
      if (!g) {
        drawPlain(ctx, cell0.ch, x, y, cell);
        return;
      }
      const first = cell0.k === 0;
      const second = cell0.k === 1;
      if (grid === 'blank' && !first) return;
      // 第一格：较深描红 + 笔顺序号（范字）；第二格：浅描红；其余留空手书
      if (first) {
        drawGlyph(ctx, g, x, y, cell, Math.max(trace, 0.55), order);
      } else if (second || grid === 'miao') {
        drawGlyph(ctx, g, x, y, cell, trace, false);
      }
      if (first && pinyin && g.pinyin) drawPinyin(ctx, g.pinyin, x + cell / 2, y - 14);
    });

    // 页脚
    ctx.fillStyle = '#aaa';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`笔顺字帖 · ${P.label} · 第 ${pi + 1}/${pages.length} 页`, P.w / 2, P.h - 16);
    canvases.push(cv);
  });
  return canvases;
}

function drawHeader(ctx, P, margin, { title, name, pageNo, pageTotal }) {
  const top = margin;
  // 标题：居中大字（无标题时留空，保持姓名行位置一致）
  ctx.save();
  ctx.fillStyle = '#333';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 22px "PingFang SC","Microsoft YaHei","Noto Sans SC",serif';
  if (title) ctx.fillText(title, P.w / 2, top + 26);
  // 右上信息行：班级/姓名/日期，留空画手写虚线
  const lineY = top + 50;
  const dashLine = (x1, x2) => {
    ctx.save();
    ctx.strokeStyle = '#9a9088';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(x1, lineY); ctx.lineTo(x2, lineY); ctx.stroke();
    ctx.restore();
  };
  const fillField = (label, value, xLabelRight, blankW) => {
    ctx.textAlign = 'right';
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#7a7066';
    ctx.fillText(label, xLabelRight, lineY - 3);
    const x1 = xLabelRight + 6, x2 = x1 + blankW;
    if (value) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#333';
      ctx.font = '15px "PingFang SC","Microsoft YaHei",serif';
      ctx.fillText(value, x1 + 2, lineY - 3);
    } else {
      dashLine(x1, x2);
    }
    return x2;
  };
  // 从右向左排：日期、姓名、（标题不画到字段行）
  const rightX = P.w - margin;
  let x = rightX - 70;                 // 日期虚线
  ctx.textAlign = 'right'; ctx.font = '13px sans-serif'; ctx.fillStyle = '#7a7066';
  ctx.fillText('日期', x - 6, lineY - 3);
  dashLine(x, rightX);
  x = fillField('姓名', name, x - 70 - 34, 90);
  // 页眉下细分隔线
  ctx.strokeStyle = '#d8d0c4';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(margin, top + 60); ctx.lineTo(P.w - margin, top + 60); ctx.stroke();
  ctx.restore();
}

function drawGrid(ctx, x, y, s, type) {
  ctx.save();
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
  if (type === 'blank') { ctx.restore(); return; }
  const dash = (x1, y1, x2, y2) => {
    ctx.save();
    ctx.setLineDash([s * 0.05, s * 0.04]);
    ctx.strokeStyle = 'rgba(217,83,79,.55)';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  };
  if (type === 'tian' || type === 'mi' || type === 'miao') {
    dash(x + s / 2, y, x + s / 2, y + s);
    dash(x, y + s / 2, x + s, y + s / 2);
  }
  if (type === 'mi') {
    dash(x, y, x + s, y + s);
    dash(x + s, y, x, y + s);
  }
  ctx.restore();
}

// 把字形 SVG 路径画进格子
function drawGlyph(ctx, g, x, y, s, trace, withOrder) {
  ctx.save();
  ctx.fillStyle = `rgba(192,57,43,${trace})`;
  g.s.forEach((d) => {
    const p = new Path2D(d);
    const pad = s * 0.09;
    ctx.save();
    ctx.translate(x + pad, y + s - pad);
    const sc = (s - pad * 2) / 1024;
    ctx.scale(sc, -sc);
    ctx.fill(p);
    ctx.restore();
  });
  ctx.restore();
  if (withOrder) drawOrderMarks(ctx, g, x, y, s);
}

function drawOrderMarks(ctx, g, x, y, s) {
  const pad = s * 0.09, sc = (s - pad * 2) / 1024;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  g.m.forEach((m, i) => {
    const px = x + pad + m[0][0] * sc;
    const py = y + s - pad - m[0][1] * sc;
    const r = s * 0.052;
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(44,62,80,.85)';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(r * 1.25)}px sans-serif`;
    ctx.fillText(i + 1, px, py + 1);
  });
}

function drawPinyin(ctx, py, cx, y) {
  ctx.fillStyle = '#9b8f80';
  ctx.font = `${Math.round(13)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(py, cx, y);
}

function drawPlain(ctx, ch, x, y, s) {
  ctx.save();
  ctx.fillStyle = '#c9c2b6';
  ctx.font = `${Math.round(s * 0.55)}px serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ch, x + s / 2, y + s / 2 + s * 0.03);
  ctx.restore();
}
