// 在确定性分类器结构上微调三个阈值
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
const chars = Object.keys(idx.chars).filter((c) => idx.chars[c][0] !== '~');
const train = chars.slice(0, 900), testSet = chars.slice(900, 1500);
function buildRows(sample) {
  const rows = [];
  for (const ch of sample) {
    const g = get(ch); if (!g) continue;
    let truth; try { truth = cnchar.stroke(ch, 'order', 'name')[0]; } catch { continue; }
    if (!Array.isArray(truth) || truth.length !== g.m.length) continue;
    truth.forEach((name, i) => {
      const t = nameToType(name); if (t === '?') return;
      rows.push({ raw: g.m[i].map(([x, y]) => [x, 1024 - y]), t });
    });
  }
  return rows;
}
const trainRows = buildRows(train), testRows = buildRows(testSet);
function classify(raw, P) {
  const simp = rdp(raw, 45);
  if (simp.length >= 3) {
    for (let i = 1; i < simp.length - 1; i++) {
      const a1 = Math.atan2(simp[i][1] - simp[i - 1][1], simp[i][0] - simp[i - 1][0]);
      const a2 = Math.atan2(simp[i + 1][1] - simp[i][1], simp[i + 1][0] - simp[i][0]);
      let d = Math.abs(a1 - a2); if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > P.turn * RAD) return 'Z';
    }
  }
  const [x0, y0] = simp[0], [x1, y1] = simp[simp.length - 1];
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), deg = Math.atan2(dy, dx) / RAD;
  let area = 0; for (const [px, py] of raw) area += (dx * (py - y0) - dy * (px - x0)) / (len || 1);
  area /= raw.length;
  if (deg > -30 && deg < 10) return 'H';
  if (deg >= 10 && deg < 60) return (len > P.naLen && area > P.naArea) ? 'N' : 'D';
  if (deg >= 60 && deg < 120) return (area < P.pArea && len > P.pLen) ? 'P' : 'V';
  if (deg >= 120 && deg <= 180) return 'P';
  if (deg >= -120 && deg <= -30) return 'H';
  if (deg < -120) return 'P';
  return 'D';
}
let best = null;
for (const turn of [65, 70, 75, 80, 85])
  for (const pArea of [-15, -18, -20, -23, -26])
    for (const pLen of [110, 130, 150, 180])
      for (const naLen of [280, 300, 320, 350])
        for (const naArea of [0, 3, 5, 8]) {
          const P = { turn, pArea, pLen, naLen, naArea };
          let ok = 0;
          for (const r of trainRows) if (classify(r.raw, P) === r.t) ok++;
          if (!best || ok > best.ok) best = { ok, P };
        }
const teOk = testRows.filter((r) => classify(r.raw, best.P) === r.t).length;
console.log(`训练 ${trainRows.length} 一致率 ${(best.ok / trainRows.length * 100).toFixed(2)}%`);
console.log(`测试 ${testRows.length} 一致率 ${(teOk / testRows.length * 100).toFixed(2)}%`);
console.log('参数:', JSON.stringify(best.P));
const conf = {};
for (const r of testRows) { const m = classify(r.raw, best.P); if (m !== r.t) conf[`${r.t}→${m}`] = (conf[`${r.t}→${m}`] || 0) + 1; }
console.log('测试混淆:', Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 10));
