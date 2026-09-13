# 数据许可与来源

本应用内置的字形数据来自开源项目，相关许可随附于此目录：

- **字形 SVG 轮廓与 median 笔势折线**：[hanzi-writer-data](https://github.com/chanind/hanzi-writer-data)
  - 数据源自 [Make Me a Hanzi](https://github.com/skishore/makemeahanzi) 项目
  - 字形基于文鼎科技的 **AR PL KaitiM GB（文鼎 PL 中楷）** 字体衍生，受 **ARPHIC Public License** 许可，许可全文见 `ARPHICPL.TXT`
- **字频排序与拼音**：`hanzi` npm 包（JunDA / Leiden 字频表）
- **繁简映射**：`cn-chars` npm 包（同源 ARPHIC 字符表对应关系）
- **蒙学文本（《千字文》《三字经》《百家姓》《弟子规》）**：[chinese-poetry](https://github.com/chinese-poetry/chinese-poetry) 数据集

以上数据在构建期由 `tools/build-data.mjs` 打包为 `index.json` 与 `c000.json … c027.json`。

应用代码为原创实现，按 MIT 许可发布。
