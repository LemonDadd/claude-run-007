// 字形数据加载：index → 分块 JSON，IndexedDB 优先缓存，繁体输入自动转简体
import { cacheGetChunk, cacheSetChunk } from './db.js';

let indexP = null;
let t2sP = null;
const chunkP = new Map();

export function loadIndex() {
  if (!indexP) indexP = fetch('data/index.json').then((r) => r.json());
  return indexP;
}
function loadT2s() {
  if (!t2sP) t2sP = fetch('data/t2s.json').then((r) => r.json()).catch(() => ({}));
  return t2sP;
}

function loadChunk(i) {
  if (!chunkP.has(i)) {
    chunkP.set(i, (async () => {
      const idx = await loadIndex();
      const name = idx.chunks[i];
      const cached = await cacheGetChunk(name);
      if (cached) return cached;
      const r = await fetch(`data/${name}`);
      if (!r.ok) throw new Error(`数据块加载失败 ${name}`);
      const data = await r.json();
      cacheSetChunk(name, data).catch(() => {});
      return data;
    })());
  }
  return chunkP.get(i);
}

export async function lookupChar(ch) {
  const idx = await loadIndex();
  let rec = idx.chars[ch];
  let simpKey = null;      // 繁体命中时，记录简体字
  if (!rec) {
    const t2s = await loadT2s();
    const simp = t2s[ch];
    if (simp && idx.chars[simp]) { rec = idx.chars[simp]; simpKey = simp; }
  }
  if (!rec) return null;
  if (rec[0] === '~') { simpKey = rec[1]; rec = idx.chars[rec[1]]; }
  const chunk = await loadChunk(rec[0]);
  const g = chunk.c[simpKey || ch];
  if (!g) return null;
  return { ...g, pinyin: rec[2] || '', aliasOf: simpKey && simpKey !== ch ? simpKey : null };
}

export async function hasChar(ch) {
  const idx = await loadIndex();
  if (idx.chars[ch]) return true;
  const t2s = await loadT2s();
  const simp = t2s[ch];
  return !!(simp && idx.chars[simp]);
}

export async function preloadAll(onProgress) {
  const idx = await loadIndex();
  let done = 0;
  for (let i = 0; i < idx.chunks.length; i++) {
    await loadChunk(i);
    done++;
    onProgress?.(done, idx.chunks.length);
  }
}

// 清空内存中的字块缓存（清 IndexedDB / SW Cache 时一起调用）
export function clearChunkMemory() {
  chunkP.clear();
  indexP = null;
  t2sP = null;
}

const HAN = /[㐀-䶿一-鿿豈-﫿]/;
export const isHan = (c) => HAN.test(c);

// SVG 源坐标系 y 轴向上，渲染时翻转
export const FLIP = 'matrix(1,0,0,-1,0,1024)';
