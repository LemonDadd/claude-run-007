// 统计各真值笔画类别的特征分布，为阈值设计提供依据
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RAD = Math.PI / 180;

function rdp(points, eps) {
  if (points.length < 3) return points;
  const [x0, y0] = points[0], [x1, y1] = points[points.length - 1];
  const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
  let maxD = -1, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const dist = Math.abs(dy * points[i][0] - dx * points[i][1] + x1 * y0 - y1 * x0) / d;
    if (dist > maxD) { maxD = dist; idx = i; }
  }
  if (maxD > eps) return [...rdp(points.slice(0, idx + 1), eps), ...rdp(points.slice(idx), eps).slice(1)];
  return [points[0], points[points.length - 1]];
}
const cnchar = require('cnchar');
cnchar.use(require('cnchar-order/cnchar.order.min.js'));
const nameToType = (n) => n.includes('折') || n.includes('钩') || n.includes('弯') || n.includes('竖提') || n.includes('撇点') ? 'Z'
  : n.includes('点') ? 'D' : n.includes('横') || n.includes('提') ? 'H' : n.includes('竖') ? 'V'
  : n.includes('撇') ? 'P' : n.includes('捺') ? 'N' : '?';

const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/index.json')));
const cache = {};
const get = (ch) => { const r = idx.chars[ch]; if (!r || r[0] === '~') return null; if (!cache[r[0]]) cache[r[0]] = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data', idx.chunks[r[0]]))); return cache[r[0]].c[ch]; };
const sample = Object.keys(idx.chars).filter((c) => idx.chars[c][0] !== '~').slice(0, 900);
const rows = [];
for (const ch of sample) {
  const g = get(ch); if (!g) continue;
  let truth; try { truth = cnchar.stroke(ch, 'order', 'name')[0]; } catch { continue; }
  if (!Array.isArray(truth) || truth.length !== g.m.length) continue;
  truth.forEach((name, i) => {
    const t = nameToType(name); if (t === '?' || t === 'Z') return;
    const raw = g.m[i].map(([x, y]) => [x, 1024 - y]);
    const simp = rdp(raw, 45);
    const [x0, y0] = simp[0], [x1, y1] = simp[simp.length - 1];
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    const deg = Math.atan2(dy, dx) / RAD;
    let area = 0; for (const [px, py] of raw) area += (dx * (py - y0) - dy * (px - x0)) / (L || 1);
    area /= raw.length;
    const pathLen = simp.reduce((a, p, j) => j ? a + Math.hypot(p[0] - simp[j - 1][0], p[1] - simp[j - 1][1]) : a, 0);
    rows.push({ t, deg, len: L, area, curv: pathLen / (L || 1), name, ch, si: i + 1 });
  });
}
const stat = (arr) => {
  const q = (p) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length * p)];
  return `n=${arr.length} p10=${q(0.1).toFixed(0)} p25=${q(0.25).toFixed(0)} med=${q(0.5).toFixed(0)} p75=${q(0.75).toFixed(0)} p90=${q(0.9).toFixed(0)}`;
};
for (const t of ['H', 'V', 'P', 'N', 'D']) {
  const r = rows.filter((x) => x.t === t);
  console.log(`\n== ${t} (${r.length})`);
  console.log(' deg :', stat(r.map((x) => x.deg)));
  console.log(' len :', stat(r.map((x) => x.len)));
  console.log(' area:', stat(r.map((x) => x.area)));
  console.log(' curv:', stat(r.map((x) => x.curv)));
}
// 交叉：deg 分桶 × 类别
console.log('\ndeg 区间内各类别数量:');
const bins = [
  ['横 [-30,10)', -30, 10], ['右斜下 [10,60)', 10, 60], ['近竖 [60,120)', 60, 120],
  ['左斜下 [120,170)', 120, 170], ['水平左 [170,180]|[-180,-170)', 170, 190],
  ['左斜上 [-170,-120)', -170, -120], ['左陡上 [-120,-60)', -120, -60], ['右斜上 [-60,-30)', -60, -30],
];
for (const [label, a, b] of bins) {
  const r = rows.filter((x) => x.deg >= a && x.deg < b || (label.includes('水平') && Math.abs(x.deg) >= 170));
  const c = {}; r.forEach((x) => c[x.t] = (c[x.t] || 0) + 1);
  console.log(label.padEnd(34), JSON.stringify(c));
}
