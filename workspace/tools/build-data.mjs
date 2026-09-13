// 构建内置笔顺数据：
//   字形来源  hanzi-writer-data (Make Me a Hanzi, ARPHIC 字体衍生数据)
//   字频排序  hanzi 包的 Leiden/ JunDA 字频表（前 7000）
//   繁简转换  cn-chars
//   蒙学模板 chinese-poetry（三字经/千字文/百家姓/弟子规）
//
// 输出：
//   web/data/index.json          {v,total,chunkSize,chunks,chars:{字:[chunk,strokes,pinyin]}}
//   web/data/cNNNN.json          每块 {c:{字:{s:[svg路径...],m:[median...],t:'HVPNDZ...'}}}
//   web/data/templates.json      字帖模板
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'web', 'data');
fs.mkdirSync(OUT, { recursive: true });

const GLYPH_DIR = path.join(ROOT, 'node_modules/hanzi-writer-data');
const CHUNK_SIZE = 250;
const TARGET = 7000;

// ---------- 字频表 ----------
const hanzi = require('hanzi');
hanzi.start();
const freq = [];
for (let i = 1; i <= 10000; i++) {
  const e = hanzi.getCharacterInFrequencyListByPosition(i);
  if (e && e.character) {
    const py = (e.pinyin || '').split('/')[0].replace(/[0-9]/g, '');
    freq.push({ ch: e.character, py });
  }
}

// ---------- 繁简映射 ----------
const { toSimplifiedChar } = require('cn-chars');
// 收集一个“繁→简”表（前端可用于查询繁体输入）
const simpCodes = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'node_modules/cn-chars/simplifiedCharsCode.json'), 'utf8'));
const tradCodes = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'node_modules/cn-chars/traditionalCharsCode.json'), 'utf8'));
const t2s = {};
tradCodes.forEach((code, i) => {
  const t = String.fromCharCode(code);
  const s = String.fromCharCode(simpCodes[i]);
  if (t !== s) t2s[t] = s;
});
fs.writeFileSync(path.join(OUT, 't2s.json'), JSON.stringify(t2s));

// ---------- 笔画分类：横H 竖V 撇P 捺N 点D 折Z ----------
const RAD = Math.PI / 180;

// Ramer–Douglas–Peucker 折线简化：去掉曲线采样锯齿，保留真正的折角
function rdp(points, eps) {
  if (points.length < 3) return points;
  const [x0, y0] = points[0];
  const [x1, y1] = points[points.length - 1];
  const dx = x1 - x0, dy = y1 - y0;
  const d = Math.hypot(dx, dy) || 1;
  let maxD = -1, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const dist = Math.abs(dy * px - dx * py + x1 * y0 - y1 * x0) / d;
    if (dist > maxD) { maxD = dist; idx = i; }
  }
  if (maxD > eps) {
    return [...rdp(points.slice(0, idx + 1), eps), ...rdp(points.slice(idx), eps).slice(1)];
  }
  return [points[0], points[points.length - 1]];
}

function classifyStroke(medianRaw) {
  if (medianRaw.length < 2) return 'D';
  // 源数据 y 轴向上（永字竖从下往上走），先翻转为屏幕坐标
  const raw = medianRaw.map(([x, y]) => [x, 1024 - y]);
  // 折：RDP 简化后出现明显方向转折（含钩、弯转）
  const simp = rdp(raw, 45);
  if (simp.length >= 3) {
    for (let i = 1; i < simp.length - 1; i++) {
      const a1 = Math.atan2(simp[i][1] - simp[i - 1][1], simp[i][0] - simp[i - 1][0]);
      const a2 = Math.atan2(simp[i + 1][1] - simp[i][1], simp[i + 1][0] - simp[i][0]);
      let d = Math.abs(a1 - a2);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > 70 * RAD) return 'Z';    }
  }
  const [x0, y0] = simp[0];
  const [x1, y1] = simp[simp.length - 1];
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const deg = Math.atan2(dy, dx) / RAD;
  // 相对首尾弦的平均侧向偏移：撇向左弯（负值大），捺向右鼓（正）
  let area = 0;
  for (const [px, py] of raw) area += (dx * (py - y0) - dy * (px - x0)) / (len || 1);
  area /= raw.length;

  if (deg > -30 && deg < 10) return 'H';                    // 横、提
  if (deg >= 10 && deg < 60) {                              // 右斜下：捺 / 点
    if (len > 280 && area > 0) return 'N';
    return 'D';
  }
  if (deg >= 60 && deg < 120) {                             // 近竖：竖 / 竖撇
    if (area < -23 && len > 110) return 'P';
    return 'V';
  }
  if (deg >= 120 && deg <= 180) return 'P';                 // 左斜下：撇
  if (deg >= -120 && deg <= -30) return 'H';                // 向上行笔（钩后提段等）
  if (deg < -120) return 'P';                               // 平撇
  return 'D';
}

// ---------- 压缩路径（坐标取整去多余空格） ----------
function compactPath(p) {
  return p.replace(/-?\d+\.\d+/g, (n) => String(Math.round(+n)))
          .replace(/([MLQCZ]) /g, '$1')
          .replace(/ +/g, ' ');
}
function compactMedian(m) { return m.map(([x, y]) => [Math.round(x), Math.round(y)]); }

// ---------- 打包 ----------
const index = { v: 1, total: 0, chunkSize: CHUNK_SIZE, chunks: [], chars: {} };
let chunk = null, chunkIdx = -1, packed = 0, missing = [];

function flushChunk() {
  if (!chunk || !Object.keys(chunk.c).length) return;
  const name = `c${String(chunkIdx).padStart(3, '0')}.json`;
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(chunk));
  index.chunks.push(name);
}

const seen = new Set();
for (const { ch, py } of freq) {
  if (packed >= TARGET) break;
  const key = ch;
  if (seen.has(key)) continue;
  seen.add(key);
  const file = path.join(GLYPH_DIR, `${key}.json`);
  if (!fs.existsSync(file)) { missing.push(key); continue; }
  let g;
  try { g = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { missing.push(key); continue; }
  if (!g.strokes?.length || !g.medians || g.strokes.length !== g.medians.length) {
    missing.push(key); continue;
  }
  if (packed % CHUNK_SIZE === 0) {
    flushChunk();
    chunk = { c: {} };
    chunkIdx++;
  }
  const s = g.strokes.map(compactPath);
  const m = g.medians.map(compactMedian);
  const t = g.medians.map(classifyStroke).join('');
  chunk.c[key] = { s, m, t };
  index.chars[key] = [chunkIdx, s.length, py];
  packed++;
}
flushChunk();
index.total = packed;

// 附带：可直接命中的繁体字（字形库里有繁体字形时也索引过去）
let extraTrad = 0;
for (const [t, s] of Object.entries(t2s)) {
  if (index.chars[s] && !index.chars[t]) {
    // 繁体字直接复用简体字形记录；标记为别名，前端查 t 时映射到 s
    index.chars[t] = ['~', s];
    extraTrad++;
  }
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));

// ---------- 蒙学字帖模板 ----------
const MENG = path.join(ROOT, 'node_modules/chinese-poetry/dist/mengxue');
const readJ = (f) => JSON.parse(fs.readFileSync(path.join(MENG, f), 'utf8'));
const toSimp = (str) => Array.from(str).map(toSimplifiedChar).join('');
const HAN = /[㐀-䶿一-鿿豈-﫿]/;
const onlyHan = (str) => Array.from(str).filter((c) => HAN.test(c)).join('');

const templates = [];
const qzw = readJ('qianziwen.json');
templates.push({
  id: 'qianziwen', name: '千字文（简体）', source: '南朝·周兴嗣',
  text: qzw.paragraphs.map((p) => toSimp(p)).join(''),
});
templates.push({
  id: 'sanzijing', name: '三字经（简体）', source: '宋·王应麟',
  text: readJ('sanzijing-new.json').paragraphs.map((p) => onlyHan(toSimp(p))).join(''),
});
const bjx = readJ('baijiaxing.json');
templates.push({
  id: 'baijiaxing', name: '百家姓（简体）', source: '北宋·佚名',
  text: onlyHan(bjx.paragraphs.map((p) => toSimp(p)).join('')),
});
const dzg = readJ('dizigui.json');
templates.push({
  id: 'dizigui', name: '弟子规（简体）', source: '清·李毓秀',
  text: dzg.content.flatMap((x) => x.paragraphs).map((p) => onlyHan(toSimp(p))).join(''),
});
// 笔顺自身练习：基本笔画与高频独体字
templates.push({
  id: 'basic', name: '基础笔画·常用字', source: '内置',
  text: '一二三十人口日月水火山石田土木禾米车马牛羊上下大小多少天地男女父母儿女东西南北春夏秋冬',
});
fs.writeFileSync(path.join(OUT, 'templates.json'), JSON.stringify(templates));

const sizes = fs.readdirSync(OUT).map((f) => [f, fs.statSync(path.join(OUT, f)).size]);
const totalBytes = sizes.reduce((a, [, n]) => a + n, 0);
console.log(`packed chars : ${packed} (+${extraTrad} traditional aliases)`);
console.log(`chunks       : ${index.chunks.length} × ${CHUNK_SIZE}`);
console.log(`missing      : ${missing.length} ${missing.slice(0, 20).join('')}`);
console.log(`templates    : ${templates.map((t) => `${t.name}(${Array.from(t.text).length})`).join(', ')}`);
console.log(`data size    : ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
