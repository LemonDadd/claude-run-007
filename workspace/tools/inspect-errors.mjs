// 打印最佳参数下的典型错分，分析 V→D / H→P 等剩余错误
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RAD = Math.PI / 180;
const P = { eps: 55, turnDeg: 65, hAng: 22, hDown: 8, vAng: 78, dotLen: 60, naLen: 350 };

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
function classify(raw) {
  const simp = rdp(raw, P.eps);
  let turn = false;
  if (simp.length >= 3) for (let i = 1; i < simp.length - 1; i++) {
    const a1 = Math.atan2(simp[i][1] - simp[i - 1][1], simp[i][0] - simp[i - 1][0]);
    const a2 = Math.atan2(simp[i + 1][1] - simp[i][1], simp[i + 1][0] - simp[i][0]);
    let d = Math.abs(a1 - a2); if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > P.turnDeg * RAD) { turn = true; break; }
  }
  const [x0, y0] = simp[0], [x1, y1] = simp[simp.length - 1];
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy), deg = Math.atan2(dy, dx) / RAD;
  const totalLen = simp.reduce((a, p, i) => i ? a + Math.hypot(p[0] - simp[i - 1][0], p[1] - simp[i - 1][1]) : a, 0);
  if (turn) return { m: 'Z', deg, len, totalLen, simp };
  if (len < P.dotLen) return { m: 'D', deg, len, totalLen, simp };
  if (deg > -P.hAng && deg < P.hDown) return { m: 'H', deg, len, totalLen, simp };
  if ((deg > P.vAng && deg < 180 - P.vAng) || (deg < -P.vAng && deg > -180 + P.vAng)) return { m: 'V', deg, len, totalLen, simp };
  if (deg >= P.hDown && deg <= P.vAng) return { m: len < P.naLen ? 'D' : 'N', deg, len, totalLen, simp };
  if (deg >= -P.vAng && deg <= -P.hAng) return { m: 'P', deg, len, totalLen, simp };
  if (deg >= 180 - P.vAng && deg <= 180 - P.hAng) return { m: 'P', deg, len, totalLen, simp };
  if (deg < -180 + P.vAng) return { m: len < P.naLen ? 'D' : 'N', deg, len, totalLen, simp };
  return { m: 'D', deg, len, totalLen, simp };
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
const groups = {};
for (const ch of sample) {
  const g = get(ch); if (!g) continue;
  let truth; try { truth = cnchar.stroke(ch, 'order', 'name')[0]; } catch { continue; }
  if (!Array.isArray(truth) || truth.length !== g.m.length) continue;
  truth.forEach((name, i) => {
    const t = nameToType(name); if (t === '?') return;
    const f = classify(g.m[i].map(([x, y]) => [x, 1024 - y]));
    if (f.m !== t) {
      const k = `${t}→${f.m}`;
      (groups[k] ??= []).push(`${ch}#${i + 1}${name} deg=${f.deg.toFixed(0)} len=${f.len.toFixed(0)} path=${f.totalLen.toFixed(0)}`);
    }
  });
}
for (const [k, arr] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length).slice(0, 6)) {
  console.log(`\n== ${k} (${arr.length})`);
  console.log(arr.slice(0, 12).join('\n'));
}
