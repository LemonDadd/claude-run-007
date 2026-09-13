import { StrokePlayer } from './player.js';
import { renderSheet } from './sheet.js';
import { canvasesToPdf, downloadCanvasPng, downloadBlob } from './exporter.js';
import { isHan, preloadAll, hasChar, clearChunkMemory } from './data-loader.js';
import { kvGet, kvSet, cacheClear, cacheSize } from './db.js';

// 离线 Service Worker
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}


const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ---------- 通用 ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

$$('.tab').forEach((btn) => btn.addEventListener('click', () => {
  $$('.tab').forEach((b) => b.classList.toggle('active', b === btn));
  const id = btn.dataset.tab;
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${id}`));
  history.replaceState(null, '', `#${id}`);
}));
if (location.hash) {
  const b = $(`.tab[data-tab="${location.hash.slice(1)}"]`);
  if (b) b.click();
}

// ---------- 设置 ----------
const DEFAULTS = { speed: 1, hold: 250, loopMode: 'off', autoNext: true };
let settings = normalizeSettings({ ...DEFAULTS, ...(await kvGet('settings', {})) });
function saveSettings() { kvSet('settings', settings); }

// 清洗导入/存储中的设置，保证类型与范围合法
function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const speed = Number(s.speed);
  const hold = Number(s.hold);
  // 兼容旧字段 autoLoop → loopMode='one'
  let loopMode = s.loopMode;
  if (!['off', 'one', 'list'].includes(loopMode)) {
    loopMode = s.autoLoop ? 'one' : 'off';
  }
  return {
    speed: Number.isFinite(speed) && speed >= 0.3 && speed <= 3 ? +speed.toFixed(1) : DEFAULTS.speed,
    hold: Number.isFinite(hold) && hold >= 0 && hold <= 2000 ? Math.round(hold) : DEFAULTS.hold,
    loopMode,
    autoNext: s.autoNext !== undefined ? !!s.autoNext : true,
  };
}

// ---------- 动画播放器 ----------
const player = new StrokePlayer($('#svgWrap'), $('#strokeInfo'), $('#strokeList'));
player.onpause = syncPlayBtn;

// 设置变更 → 播放器实例、所有相关控件立即同步（改设置即生效）
function applySettings(next) {
  if (next) settings = normalizeSettings({ ...settings, ...next });
  player.speed = settings.speed;
  player.hold = settings.hold;
  player.loopMode = settings.loopMode;
  player.autoNext = settings.autoNext;

  // 动画页控件
  $('#speedRange').value = settings.speed;
  $('#speedVal').textContent = `${settings.speed.toFixed(1)}×`;
  $('#loopMode').value = settings.loopMode;
  $('#autoNextChk').checked = settings.autoNext;

  // 设置页控件
  $('#setSpeed').value = settings.speed;
  $('#setSpeedVal').textContent = `${settings.speed.toFixed(1)}×`;
  $('#setHold').value = settings.hold;
  $('#setLoopMode').value = settings.loopMode;
  $('#setAutoNext').checked = settings.autoNext;
}
applySettings();

// ---------- 模板 ----------
const templates = await fetch('data/templates.json').then((r) => r.json());
function tplHtml(t, used) {
  const n = Array.from(t.text).length;
  return `<div class="tpl" data-id="${t.id}">
    <div><b>${t.name}</b><div class="n">${t.source || ''} · ${n} 字</div></div>
    <span class="n">${used ? '使用 →' : '载入 →'}</span>
  </div>`;
}
function fillTemplates(elId, mode) {
  $(`#${elId}`).innerHTML = templates.map((t) => tplHtml(t)).join('');
  $$(`#${elId} .tpl`).forEach((el) => el.addEventListener('click', async () => {
    const t = templates.find((x) => x.id === el.dataset.id);
    if (mode === 'anim') {
      $('#charInput').value = Array.from(t.text).slice(0, 40).join('');
      loadCharInput();
      toast(`已载入《${t.name}》前 ${Math.min(40, t.text.length)} 字`);
    } else {
      $('#batchText').value = t.text;
      $('#batchHint').textContent = `已载入《${t.name}》，共 ${Array.from(t.text).length} 字`;
    }
  }));
}
fillTemplates('tplPickAnim', 'anim');
fillTemplates('tplPickBatch', 'batch');

// ---------- 笔顺动画 ----------
let inputChars = [];
let activeIdx = 0;

async function loadCharInput() {
  const raw = Array.from($('#charInput').value).filter(isHan);
  if (!raw.length) { toast('请输入汉字'); return; }
  inputChars = [...new Set(raw)];
  const strip = $('#charStrip');
  strip.innerHTML = '';
  for (const ch of inputChars) {
    const ok = await hasChar(ch);
    const d = document.createElement('div');
    d.className = 'mini' + (ok ? '' : ' miss');
    d.textContent = ch;
    d.title = ok ? '' : '暂无数据';
    d.onclick = () => selectChar(ch, { autoplay: player.playing });
    strip.appendChild(d);
  }
  activeIdx = 0;
  // 仅在循环模式（单字/列表循环）下载入后自动开始；普通模式等用户点播放
  await selectChar(inputChars[0], { autoplay: settings.loopMode !== 'off' });
}

// 切换字条中的字；opts.autoplay=是否载入后立即播放
async function selectChar(ch, opts = {}) {
  const idx = inputChars.indexOf(ch);
  if (idx >= 0) activeIdx = idx;
  $$('#charStrip .mini').forEach((m, i) => m.classList.toggle('active', inputChars[i] === ch));
  $('#charMeta').textContent = `「${ch}」加载中…`;
  const g = await player.load(ch);
  $('#charMeta').textContent = g
    ? `${ch} · ${g.s.length} 画${g.aliasOf ? ` · 繁体（用「${g.aliasOf}」字形）` : ''} · 第 ${activeIdx + 1}/${inputChars.length} 字`
    : `${ch} 暂无笔顺数据 · 第 ${activeIdx + 1}/${inputChars.length} 字`;
  syncPlayBtn();
  if (opts.autoplay && g) {
    player.play();
    syncPlayBtn();
  }
  return g;
}

// 在字条中移动 delta 个字；wrap=true 时循环折回，否则到边界停止；跳过缺数据的字
async function stepChar(delta, { autoplay = true, wrap = false } = {}) {
  if (!inputChars.length) return;
  const n = inputChars.length;
  const visited = new Set();
  for (let k = 1; k <= n; k++) {
    let ni = activeIdx + delta * k;
    if (!wrap) {
      if (ni < 0) { activeIdx = 0; return; }
      if (ni >= n) { activeIdx = n - 1; return; }
    } else {
      ni = (ni % n + n) % n;
    }
    if (visited.has(ni)) return;
    visited.add(ni);
    const ch = inputChars[ni];
    if (await hasChar(ch)) { await selectChar(ch, { autoplay }); return; }
  }
}

// 一个字自然播完：按循环/连播设置决定下一步
async function onCharEnded() {
  if (player.loopMode === 'one') return;         // player 内部已自行单字循环
  if (settings.loopMode === 'list') {
    await stepChar(1, { autoplay: true, wrap: true });
    return;
  }
  if (settings.autoNext) {
    // 不循环但连播：到最后一字停止（不 wrap，越界即止）
    await stepChar(1, { autoplay: true, wrap: false });
  }
}

function syncPlayBtn() { $('#btnPlay').textContent = player.playing ? '⏸' : '▶'; }

$('#btnPlayChar').onclick = loadCharInput;
$('#charInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadCharInput(); });
$('#btnPlay').onclick = () => { player.toggle(); syncPlayBtn(); };
$('#btnPrev').onclick = () => { player.prev(); syncPlayBtn(); };
$('#btnNext').onclick = () => { player.next(); syncPlayBtn(); };
$('#btnCharPrev').onclick = () => stepChar(-1, { autoplay: player.playing });
$('#btnCharNext').onclick = () => stepChar(1, { autoplay: player.playing });
$('#loopMode').onchange = (e) => { applySettings({ loopMode: e.target.value }); saveSettings(); };
$('#autoNextChk').onchange = (e) => { applySettings({ autoNext: e.target.checked }); saveSettings(); };
$('#speedRange').oninput = (e) => {
  applySettings({ speed: +e.target.value });
  saveSettings();
};
$('#ghostRange').oninput = (e) => { player.ghostOpacity = e.target.value / 100; player.render(); };
$('#showOutline').onchange = (e) => { player.showOutline = e.target.checked; player.render(); };
$('#showMedian').onchange = (e) => { player.showMedian = e.target.checked; player.render(); };

player.oncharend = () => { syncPlayBtn(); onCharEnded(); };

document.addEventListener('keydown', (e) => {
  if (!$('#tab-animate').classList.contains('active')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); player.toggle(); syncPlayBtn(); }
  if (e.key === 'ArrowLeft') { player.prev(); syncPlayBtn(); }
  if (e.key === 'ArrowRight') { player.next(); syncPlayBtn(); }
  if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); stepChar(-1, { autoplay: player.playing }); }
  if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); stepChar(1, { autoplay: player.playing }); }
});

$('#btnFavChar').onclick = async () => {
  if (!inputChars.length) { toast('请先输入并播放汉字'); return; }
  const text = inputChars.join('');
  await addFavorite({ name: `字组 ${text.slice(0, 8)}`, text, type: 'chars' });
  toast(`已收藏 ${text.length} 个字`);
};
$('#btnToSheet').onclick = () => {
  if (!inputChars.length) return;
  $('#sheetText').value = inputChars.join('');
  $('.tab[data-tab="sheet"]').click();
};

// ---------- 临摹本 ----------
let lastCanvases = [];
$('#traceRange').oninput = (e) => { $('#traceVal').textContent = `${e.target.value}%`; };

function sheetOptions() {
  return {
    text: $('#sheetText').value,
    grid: $('#gridType').value,
    cols: Math.max(4, Math.min(16, +$('#cols').value || 8)),
    rowsPerChar: Math.max(1, Math.min(10, +$('#rowsPerChar').value || 2)),
    trace: +$('#traceRange').value / 100,
    paper: $('#paper').value,
    pinyin: $('#showPinyin').checked,
    order: $('#showOrder').checked,
    dedupe: $('#dedupe').checked,
    header: $('#showHeader').checked,
    headerTitle: $('#headerTitle').value.trim(),
    headerName: $('#headerName').value.trim(),
  };
}

async function preview() {
  const opts = sheetOptions();
  if (!Array.from(opts.text).filter(isHan).length) { toast('请输入汉字'); return; }
  const hint = $('#sheetHint');
  hint.textContent = '生成中…';
  const t0 = performance.now();
  lastCanvases = await renderSheet({
    ...opts,
    onProgress: (i, n) => { hint.textContent = `加载字形 ${i}/${n}…`; },
  });
  const ms = (performance.now() - t0).toFixed(0);
  const box = $('#sheetPreview');
  box.innerHTML = '';
  const displayW = Math.min(640, window.innerWidth - 80);
  lastCanvases.forEach((cv) => {
    cv.style.width = `${displayW}px`;
    const wrap = document.createElement('div');
    wrap.className = 'sheet-page';
    wrap.style.width = `${displayW}px`;
    wrap.appendChild(cv);
    box.appendChild(wrap);
  });
  hint.textContent = `${lastCanvases.length} 页，用时 ${ms} ms`;
}
$('#btnPreview').onclick = preview;

$('#btnPrint').onclick = () => {
  if (!lastCanvases.length) { preview().then(() => setTimeout(() => window.print(), 400)); return; }
  window.print();
};
$('#btnPdf').onclick = async () => {
  if (!lastCanvases.length) await preview();
  if (!lastCanvases.length) return;
  $('#sheetHint').textContent = '生成 PDF 中…';
  await new Promise((r) => setTimeout(r, 30));
  const pdf = canvasesToPdf(lastCanvases, $('#paper').value);
  pdf.save(`临摹本-${Date.now()}.pdf`);
  $('#sheetHint').textContent = 'PDF 已导出';
};
$('#btnPng').onclick = async () => {
  if (!lastCanvases.length) await preview();
  lastCanvases.forEach((cv, i) => {
    setTimeout(() => downloadCanvasPng(cv, `临摹本-p${i + 1}.png`), i * 300);
  });
};
$('#btnSaveSheet').onclick = async () => {
  const text = Array.from($('#sheetText').value).filter(isHan).join('');
  if (!text.length) return;
  await addFavorite({ name: `字帖 ${text.slice(0, 8)}`, text, type: 'sheet', opts: sheetOptions() });
  toast('字帖已保存到收藏库');
};

// ---------- 批量 ----------
function batchChars() {
  const raw = Array.from($('#batchText').value).filter(isHan);
  const limit = +$('#batchLimit').value || 0;
  return limit > 0 ? raw.slice(0, limit) : raw;
}
$('#btnBatchAnim').onclick = async () => {
  const chars = [...new Set(batchChars())];
  if (!chars.length) return toast('请先载入或粘贴文字');
  $('#charInput').value = chars.slice(0, 40).join('');
  $('.tab[data-tab="animate"]').click();
  loadCharInput();
  toast(`共 ${chars.length} 字，动画区载入前 40 个；可从下方字格切换`);
};
$('#btnBatchSheet').onclick = async () => {
  const chars = batchChars();
  if (!chars.length) return toast('请先载入或粘贴文字');
  $('#dedupe').checked = false;
  $('#sheetText').value = chars.join('');
  $('.tab[data-tab="sheet"]').click();
  const t0 = performance.now();
  await preview();
  $('#sheetHint').textContent += `（批量 ${chars.length} 字）`;
};
$('#btnBatchFav').onclick = async () => {
  const chars = [...new Set(batchChars())];
  if (!chars.length) return;
  await addFavorite({ name: `批量 ${chars.slice(0, 8).join('')}…`, text: chars.join(''), type: 'batch' });
  toast(`已收藏 ${chars.length} 字`);
};

// ---------- 收藏库 ----------
async function addFavorite(fav) {
  const list = await kvGet('favs', []);
  fav.id = Date.now() + '' + Math.random().toString(36).slice(2, 6);
  fav.createdAt = new Date().toISOString();
  list.unshift(fav);
  await kvSet('favs', list);
  renderFavs();
}
async function renderFavs() {
  const list = await kvGet('favs', []);
  const box = $('#favList');
  if (!list.length) { box.innerHTML = '<div class="empty">还没有收藏。在动画页或临摹本页点击 ☆ 即可保存。</div>'; return; }
  box.innerHTML = list.map((f) => `
    <div class="fav-item" data-id="${f.id}">
      <h4>${f.name}</h4>
      <div class="meta">${Array.from(f.text).length} 字 · ${new Date(f.createdAt).toLocaleDateString()}</div>
      <div class="chars">${f.text.slice(0, 60)}${Array.from(f.text).length > 60 ? '…' : ''}</div>
      <div class="row">
        <button data-act="anim">动画</button>
        <button data-act="sheet">临摹本</button>
        <button data-act="del" class="danger">删除</button>
      </div>
    </div>`).join('');
  box.querySelectorAll('.fav-item').forEach((item) => {
    const f = list.find((x) => x.id === item.dataset.id);
    item.querySelector('[data-act=anim]').onclick = () => {
      $('#charInput').value = f.text.slice(0, 40);
      $('.tab[data-tab="animate"]').click(); loadCharInput();
    };
    item.querySelector('[data-act=sheet]').onclick = () => {
      $('#sheetText').value = f.text;
      if (f.opts) applyOpts(f.opts);
      $('.tab[data-tab="sheet"]').click(); preview();
    };
    item.querySelector('[data-act=del]').onclick = async () => {
      await kvSet('favs', list.filter((x) => x.id !== f.id));
      renderFavs();
    };
  });
}
function applyOpts(o) {
  $('#gridType').value = o.grid || 'tian';
  $('#cols').value = o.cols || 8;
  $('#rowsPerChar').value = o.rowsPerChar || 2;
  $('#traceRange').value = Math.round((o.trace ?? 0.3) * 100);
  $('#traceVal').textContent = `${Math.round((o.trace ?? 0.3) * 100)}%`;
  $('#paper').value = o.paper || 'a4';
  $('#showPinyin').checked = !!o.pinyin;
  $('#showOrder').checked = o.order !== false;
  $('#dedupe').checked = !!o.dedupe;
  $('#showHeader').checked = o.header !== false;
  $('#headerTitle').value = o.headerTitle || '';
  $('#headerName').value = o.headerName || '';
}
renderFavs();

// 导入 / 导出 JSON
$('#btnExportJson').onclick = async () => {
  const data = {
    app: 'bishun-zitie', version: 1, exportedAt: new Date().toISOString(),
    favs: await kvGet('favs', []),
    settings: await kvGet('settings', {}),
  };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `笔顺字帖备份-${Date.now()}.json`);
};
$('#btnImportJson').onclick = () => $('#importFile').click();
$('#importFile').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'bishun-zitie') throw new Error('文件格式不符');
    if (Array.isArray(data.favs)) await kvSet('favs', data.favs);
    if (data.settings && typeof data.settings === 'object') {
      settings = normalizeSettings({ ...DEFAULTS, ...data.settings });
      await kvSet('settings', settings);
      applySettings();   // 立即应用到 player 与全部控件
    }
    renderFavs();
    toast(`导入成功：${data.favs?.length || 0} 个字帖${data.settings ? '，设置已应用' : ''}`);
  } catch (err) {
    toast('导入失败：' + err.message);
  }
  e.target.value = '';
};

// ---------- 设置页 ----------
// 初始值由 applySettings() 统一设置，这里只负责改设置即生效
$('#setSpeed').oninput = (e) => { applySettings({ speed: +e.target.value }); saveSettings(); };
$('#setHold').onchange = (e) => { applySettings({ hold: +e.target.value || 0 }); saveSettings(); };
$('#setLoopMode').onchange = (e) => { applySettings({ loopMode: e.target.value }); saveSettings(); };
$('#setAutoNext').onchange = (e) => { applySettings({ autoNext: e.target.checked }); saveSettings(); };

$('#btnPreload').onclick = async () => {
  $('#btnPreload').disabled = true;
  try {
    await preloadAll((i, n) => { $('#cacheInfo').textContent = `预加载 ${i}/${n}`; });
    $('#cacheInfo').textContent = '全部字块已缓存，可离线使用';
    toast('预加载完成');
  } catch (e) {
    toast('预加载失败：' + e.message);
  }
  $('#btnPreload').disabled = false;
  updateCacheInfo();
};
$('#btnClearCache').onclick = async () => {
  await cacheClear();           // IndexedDB 字块
  clearChunkMemory();          // data-loader 内存字块 / 索引
  // Service Worker Cache Storage
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  toast('本地缓存已清除（IndexedDB、内存、离线缓存）');
  await updateCacheInfo();
};
async function updateCacheInfo() {
  const { bytes, count } = await cacheSize();
  $('#cacheInfo').textContent = count ? `已缓存 ${count} 个字块，约 ${(bytes / 1024 / 1024).toFixed(1)} MB` : '尚无缓存';
}
updateCacheInfo();

// 默认载入“永”字演示
$('#charInput').value = '永';
loadCharInput();
