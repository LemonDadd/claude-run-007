// 校验笔画六类分类（横H 竖V 撇P 捺N 点D 折Z）与 cnchar 真值的一致率
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// 分类器（内联副本，保持与 build-data.mjs 同步）
const RAD = Math.PI / 180;
function rdp(points, eps) {
  if (points.length < 3) return points;
  const [x0, y0] = points[0], [x1, y1] = points[points.length - 1];
  const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
  let maxD = -1, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const dist = Math.abs(dy * px - dx * py + x1 * y0 - y1 * x0) / d;
    if (dist > maxD) { maxD = dist; idx = i; }
  }
  if (maxD > eps) return [...rdp(points.slice(0, idx + 1), eps), ...rdp(points.slice(idx), eps).slice(1)];
  return [points[0], points[points.length - 1]];
}
function classifyStroke(medianRaw) {
  if (medianRaw.length < 2) return 'D';
  const raw = medianRaw.map(([x, y]) => [x, 1024 - y]);
  const simp = rdp(raw, 45);
  if (simp.length >= 3) {
    for (let i = 1; i < simp.length - 1; i++) {
      const a1 = Math.atan2(simp[i][1] - simp[i - 1][1], simp[i][0] - simp[i - 1][0]);
      const a2 = Math.atan2(simp[i + 1][1] - simp[i][1], simp[i + 1][0] - simp[i][0]);
      let d = Math.abs(a1 - a2); if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > 70 * RAD) return 'Z';
    }
  }
  const [x0, y0] = simp[0], [x1, y1] = simp[simp.length - 1];
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy), deg = Math.atan2(dy, dx) / RAD;
  let area = 0;
  for (const [px, py] of raw) area += (dx * (py - y0) - dy * (px - x0)) / (len || 1);
  area /= raw.length;
  if (deg > -30 && deg < 10) return 'H';
  if (deg >= 10 && deg < 60) return (len > 300 && area > 5) ? 'N' : 'D';
  if (deg >= 60 && deg < 120) return (area < -20 && len > 130) ? 'P' : 'V';
  if (deg >= 120 && deg <= 180) return 'P';
  if (deg >= -120 && deg <= -30) return 'H';
  if (deg < -120) return 'P';
  return 'D';
}

const cnchar = require('cnchar');
const order = require('cnchar-order/cnchar.order.min.js');
cnchar.use(order);
function nameToType(n) {
  if (n.includes('折') || n.includes('钩') || n.includes('弯') || n.includes('竖提') || n.includes('撇点')) return 'Z';
  if (n.includes('点')) return 'D';
  if (n.includes('横') || n.includes('提')) return 'H';
  if (n.includes('竖')) return 'V';
  if (n.includes('撇')) return 'P';
  if (n.includes('捺')) return 'N';
  return '?';
}

const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/index.json')));
const chunkCache = {};
function get(ch) {
  const r = idx.chars[ch]; if (!r || r[0] === '~') return null;
  if (!chunkCache[r[0]]) chunkCache[r[0]] = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data', idx.chunks[r[0]])));
  return chunkCache[r[0]].c[ch];
}

const sample = Object.keys(idx.chars).filter((c) => idx.chars[c][0] !== '~').slice(0, 500);
let total = 0, matched = 0;
const confusion = {};
const bad = [];
for (const ch of sample) {
  const g = get(ch); if (!g) continue;
  let truth;
  try { truth = cnchar.stroke(ch, 'order', 'name')[0]; } catch { continue; }
  if (!Array.isArray(truth) || truth.length !== g.m.length) continue;
  truth.forEach((name, i) => {
    const t = nameToType(name); if (t === '?') return;
    const mine = classifyStroke(g.m[i]);
    total++;
    if (mine === t) matched++;
    else {
      confusion[`${t}→${mine}`] = (confusion[`${t}→${mine}`] || 0) + 1;
      if (bad.length < 25) bad.push(`${ch}#${i + 1} ${name} 真${t} 分${mine}`);
    }
  });
}
console.log(`样本字: ${sample.length}  笔画: ${total}  六类一致率: ${(matched / total * 100).toFixed(1)}%`);
console.log('混淆:', Object.entries(confusion).sort((a, b) => b[1] - a[1]).slice(0, 10));
console.log(bad.join('\n'));
