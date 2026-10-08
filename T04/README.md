# T04 工程说明

- 技术栈：Vite + 原生 JavaScript
- src 目录保持默认名
- 构建命令：`npm run build`
- 构建产物目录：`build`
- 注意：`build/` 是交付物，必须入库，不能写进 `.gitignore`

## 产物为什么能直接双击打开（file://）

`vite.config.js` 里有三处配置专为此存在，改动前先看注释：

1. `base: './'` —— 资源用相对路径，不再指向磁盘根目录；
2. `rollupOptions.output.format: 'iife'` —— 输出普通脚本，不含 ES module 语法；
3. 插件 `plainScriptForFileProtocol()` —— 去掉 Vite 固定写入的 `type="module"` 与 `crossorigin`。

第 3 条不是美化：浏览器对 `file://` 页面上的 module 脚本按 CORS 处理（页面 origin 为 `null`），
会直接拦掉导致白屏；去掉之后 `document.currentScript` 也可用，图片路径才能被
`new URL(资源名, document.currentScript.src)` 正确解析到 `build/assets/`。

另外 `src/assets/icons.svg` 是被 `main.js` 用 `?raw` 内联进文档的（同文档 `<use href="#id">`）。
不要改回 `public/icons.svg` + `<use href="/icons.svg#id">` —— 跨文档取 SVG 在 `file://` 下同样会被拦，图标会 404。

## 与 T01 的交接说明

本目录是 **T01「建立 GitHub 仓库与目录结构」** 阶段搭起来的骨架工程，用来验证
「源码工程 + `.gitignore` 忽略依赖 + `build/` 产物可离线打开」这条链路是否走通。T01 已验收通过，本目录保持现状。

T04 任务接手时请注意：

- **若沿用 Vite**：直接改 `src/` 里的内容即可，上面的约定继续有效。
- **若改用其它方案**（例如手写 HTML + 自建 `node src/build.mjs`）：可以整体替换本目录内容，但请务必：
  1. 保留 `T04/.gitignore` 里的 `node_modules` 等忽略规则 —— T01 的验收标准之一就是它存在且能命中；
  2. 保证新的构建产物依然能**脱离服务器直接打开**；
  3. 同步重写本文件，别让说明与实际实现脱节。
