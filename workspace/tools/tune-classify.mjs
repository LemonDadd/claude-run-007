// 在 cnchar 真值上网格搜索分类阈值，输出最佳参数与混淆情况
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
    const [px, py] = points[i];
    const dist = Math.abs(dy * px - dx * py + x1 * y0 - y1 * x0) / d;
    if (dist > maxD) { maxD = dist; idx = i; }
  }
  if (maxD > eps) return [...rdp(points.slice(0, idx + 1), eps), ...rdp(points.slice(idx), eps).slice(1)];
  return [points[0], points[points.length - 1]];
}

const cnchar = require('cnchar');
cnchar.use(require('cnchar-order/cnchar.order.min.js'));
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
const cache = {};
function get(ch) {
  const r = idx.chars[ch]; if (!r || r[0] === '~') return null;
  if (!cache[r[0]]) cache[r[0]] = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data', idx.chunks[r[0]])));
  return cache[r[0]].c[ch];
}

// 抽取特征并收集真值
const sample = Object.keys(idx.chars).filter((c) => idx.chars[c][0] !== '~').slice(0, 900);
const rows = [];
for (const ch of sample) {
  const g = get(ch); if (!g) continue;
  let truth; try { truth = cnchar.stroke(ch, 'order', 'name')[0]; } catch { continue; }
  if (!Array.isArray(truth) || truth.length !== g.m.length) continue;
  truth.forEach((name, i) => {
    const t = nameToType(name); if (t === '?') return;
    const flipped = g.m[i].map(([x, y]) => [x, 1024 - y]);
    rows.push({ raw: flipped, t, name });
  });
}

function features(raw, eps, turnDeg) {
  const simp = rdp(raw, eps);
  let turn = false;
  if (simp.length >= 3) {
    for (let i = 1; i < simp.length - 1; i++) {
      const a1 = Math.atan2(simp[i][1] - simp[i - 1][1], simp[i][0] - simp[i - 1][0]);
      const a2 = Math.atan2(simp[i + 1][1] - simp[i][1], simp[i + 1][0] - simp[i][0]);
      let d = Math.abs(a1 - a2); if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > turnDeg * RAD) { turn = true; break; }
    }
  }
  const [x0, y0] = simp[0], [x1, y1] = simp[simp.length - 1];
  const dx = x1 - x0, dy = y1 - y0;
  // 有符号面积：原始折线相对首尾弦的侧向偏移（左弯为负，右弯为正）
  const L = Math.hypot(dx, dy) || 1;
  let area = 0;
  for (const [px, py] of raw) {
    area += (dx * (py - y0) - dy * (px - x0)) / L;
  }
  area /= raw.length;
  return { turn, len: L, deg: Math.atan2(dy, dx) / RAD, area, pathLen: simp.reduce((a, p, i) => i ? a + Math.hypot(p[0] - simp[i - 1][0], p[1] - simp[i - 1][1]) : a, 0) };
}

function classify(f, p) {
  if (f.turn) return 'Z';
  const { deg, len, area } = f;
  const ad = Math.abs(deg);
  // 横（含提，-hAng ~ hDown）
  if (deg > -p.hAng && deg < p.hDown) return 'H';
  // 斜向区
  if (deg >= p.hDown && deg <= p.vAng) return len < p.naLen ? 'D' : 'N';   // 右斜：点/捺
  if (deg >= -p.vAng && deg <= -p.hAng) return 'P';                         // 左斜下：撇
  // 近竖区（deg ∈ [vAng, 180-vAng] ∪ [-180+vAng, -vAng]）
  if ((deg >= p.vAng && deg <= 180 - p.vAng) || (deg <= -p.vAng && deg >= -180 + p.vAng)) {
    // 左下陡撇：右行笔 deg≈160-180，或左弯明显
    if (deg > 180 - p.hAng - 20) return 'P';
    if (area < -p.bend && f.pathLen > len * 1.02) return 'P';
    // 竖撇之外的短近竖画（竖段常被 RDP 截短）按竖处理
    return 'V';
  }
  // 近水平向左：平撇；极短的按点
  if (ad >= 180 - p.hAng) return len < 90 ? 'D' : 'P';
  if (ad >= 180 - p.vAng) return len < p.naLen ? 'D' : 'N';
  return 'D';
}

let best = null;
for (const eps of [35, 45, 55, 65, 80]) {
  for (const turnDeg of [50, 55, 60, 65, 70]) {
    const feats = rows.map((r) => features(r.raw, eps, turnDeg));
    for (const hAng of [15, 18, 22, 26]) {
      for (const hDown of [6, 8, 12]) {
        for (const vAng of [55, 60, 63, 66, 70]) {
          for (const dotLen of [60, 80, 100, 120]) {
            for (const naLen of [200, 260, 320, 380]) {
              for (const bend of [8, 14, 20, 30, 45]) {
              const p = { hAng, hDown, vAng, dotLen, naLen, bend };
              let ok = 0;
              const conf = {};
              rows.forEach((r, i) => {
                const m = classify(feats[i], p);
                if (m === r.t) ok++;
                else conf[`${r.t}→${m}`] = (conf[`${r.t}→${m}`] || 0) + 1;
              });
              if (!best || ok > best.ok) best = { ok, p, eps, turnDeg, conf };
              }
            }
          }
        }
      }
    }
  }
}
console.log(`样本 ${rows.length} 最佳一致率 ${(best.ok / rows.length * 100).toFixed(2)}%`);
console.log('参数:', JSON.stringify({ eps: best.eps, turnDeg: best.turnDeg, ...best.p }));
console.log('混淆:', Object.entries(best.conf).sort((a, b) => b[1] - a[1]).slice(0, 12));
