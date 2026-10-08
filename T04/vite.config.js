import { defineConfig } from 'vite'

/**
 * 让产物真正能"双击打开"（file:// 协议）。
 *
 * 背景：浏览器对 file:// 页面上的 <script type="module"> 会按 CORS 处理
 * （页面 origin 为 null），结果就是白屏 + Console 报
 *   "Access to script at 'file:///...' from origin 'null' has been blocked by CORS policy"
 * 本工程是单页模板、没有动态 import，所以走普通脚本(iife)最省事；
 * 但 Vite 注入 script 标签时会固定写 type="module"，这里在最后阶段把它改回普通脚本。
 * 注意：iife 代码本来也不该按 module（严格模式）执行，去掉是语义正确的。
 */
function plainScriptForFileProtocol() {
  return {
    name: 'plain-script-for-file-protocol',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html
          .replace(/\s+type="module"/g, '')
          .replace(/\s+crossorigin/g, '')
      },
    },
  }
}

export default defineConfig({
  // 相对路径：产物用 ./assets/... 引用资源，file:// 打开时不会去找磁盘根目录
  base: './',
  plugins: [plainScriptForFileProtocol()],
  build: {
    outDir: 'build',
    emptyOutDir: true,
    // iife = 普通脚本（无 import/export，浏览器无需 ES module 支持）
    rollupOptions: {
      output: { format: 'iife' },
    },
  },
})
