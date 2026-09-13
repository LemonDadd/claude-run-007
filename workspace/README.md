# 笔顺字帖 · 汉字笔画动画与临摹本生成器

输入一个汉字，在浏览器中把它拆解成笔画，按正确笔顺逐笔播放动画，并一键生成可打印的临摹本（田字格、米字格、描红、空白格）。纯本地静态应用，**数据不出浏览器**，首次访问后可完全离线使用。

## 功能

- **笔顺动画**：内置约 6900 个常用字的字形数据，每笔含起止点坐标与笔画类型（横、竖、撇、捺、点、折），SVG 逐笔绘制，`requestAnimationFrame` 控制进度
  - 播放 / 暂停、上一笔 / 下一笔单步
  - 笔速 0.3×–3× 可调、底字浓度可调、轮廓/笔势线开关
  - **逐墨显现**：当前笔画墨迹沿笔势中线（median）以 clipPath 逐渐露出，红色笔锋指示行进位置，笔画编号圆点同步保留；繁体输入自动映射简体字形
  - **多字播放列表**：字条支持「连播」（一字播完自动进下一字，可关）、上一字/下一字按钮；非输入框聚焦时 ↑/↓（或 PageUp/PageDown）切换当前字，←/→ 切换笔画
  - **三种循环模式**：不循环、单字循环（反复写当前字）、列表循环（播完整个字条再从头）
- **临摹本**：Canvas 排版 A4 / A4 横向 / B5
  - 米字格、田字格、描红格、空白格
  - 每行格数、每字行数、描红浓度、拼音、首字笔顺标注均可设置
  - **可选页眉**：标题（如「三年二班练习」）居中，右上角「姓名 / 日期」填写位——填了直接印名字，留空打印手写虚线；页眉随 PDF / 打印 / PNG 一并输出
  - 每个字第一格为带笔顺的深色范字，第二格浅描红，其余留空手书
  - 导出 **PDF**（jsPDF，内嵌 2× 高清整页位图）、逐页 **PNG**，或浏览器直接打印
- **批量字帖**：内置《千字文》《三字经》《百家姓》《弟子规》及基础笔画模板，也可粘贴任意文字自动提取汉字
- **本地收藏**：常用字组/字帖存 IndexedDB，支持 JSON 导出 / 导入备份
- **数据存储**：IndexedDB（收藏、设置、字形分块缓存）+ Service Worker 离线缓存
- **离线可用**：设置页可一键预加载全部约 19MB 字块

## 一键运行（Docker）

```bash
docker compose up --build
# 打开 http://localhost:8080
```

镜像为纯 nginx 静态托管，构建无需联网（字形数据已预构建进仓库）。

## 本地开发

```bash
npm install          # 安装数据构建依赖（首次，需要联网）
npm run build-data   # 从源数据重新生成 web/data（可选，仓库已包含成品）
npm run dev          # 零依赖静态服务器，http://localhost:8080
```

## 数据来源与构建

- 字形（SVG 轮廓 + median 笔势折线、1024 坐标系）：[hanzi-writer-data](https://github.com/chanind/hanzi-writer-data)（Make Me a Hanzi，ARPHIC 字体衍生数据，已随包携带许可）
- 常用字选取与拼音：`hanzi` 包的 Leiden/JunDA 字频表前 7000 字
- 繁简映射：`cn-chars`
- 蒙学模板：`chinese-poetry` 数据集（原文为繁体，构建时转简体）

构建脚本 `tools/build-data.mjs` 把单字 JSON 打包为 28 个分块（每块 250 字，按需加载）：

- `web/data/index.json` — 字 → 数据块 / 笔画数 / 拼音索引（约 150KB）
- `web/data/c000.json … c027.json` — 分块字形
- `web/data/t2s.json` — 繁简映射
- `web/data/templates.json` — 字帖模板

笔画六分类（横竖撇捺点折）由 median 折线经 RDP 简化后，按方向角、弦长与弯曲方向判定；在 cnchar 标注的真值集上准确率约 **94%**（`tools/tune-final.mjs` 可复现）。

## 目录结构

```
web/                 静态站点（nginx 根目录）
  index.html
  sw.js              Service Worker（离线）
  css/app.css
  js/                app / player / sheet / exporter / data-loader / db
  vendor/jspdf.umd.min.js
  data/              预构建字形数据
tools/
  build-data.mjs     字形打包 + 笔画分类 + 模板生成
  serve.mjs          本地静态服务器
  tune-*.mjs         分类器阈值搜索/验证（开发用）
Dockerfile  docker-compose.yml  nginx.conf
```

## 验收对照

| 验收项 | 实现 |
| --- | --- |
| 常用字笔顺动画正确 | 6893 常用字，数据来自 Make Me a Hanzi 权威笔顺 |
| 临摹本可导出可打印 | PDF / PNG / 浏览器打印，四种格子 |
| 批量 100 字生成 < 2s | 字形并行加载，冷/热缓存均达标（见 CI 手工验证） |
| 离线可用 | Service Worker + IndexedDB 缓存，可一键预载全部字块 |
| Docker 一键可跑 | `docker compose up --build`，纯静态镜像 |
