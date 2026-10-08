import { defineConfig } from 'vite'

/**
 * 让产物真正能"双击打开"（file:// 协议）。这里有两个坑，缺一个都是白屏：
 *
 * 坑 1：浏览器对 file:// 页面上的 <script type="module"> 按 CORS 处理
 *      （页面 origin 为 null），会直接拦掉，JS 根本不执行。
 *      → 所以产物输出普通脚本(iife)，不用 ES module。
 *
 * 坑 2：普通脚本写在 <head> 里是"读到就立刻执行"的，那一刻 <body> 还没解析，
 *      document.querySelector('#app') 得到 null，一赋值就抛 TypeError，页面照样空白。
 *      而 module 脚本天生带 defer 语义（等文档解析完再执行）。
 *      → 所以去掉 type="module" 的同时，必须把 defer 补回来。
 *
 * crossorigin 对 file:// 没有意义，一并去掉。
 */
function plainScriptForFileProtocol() {
  return {
    name: 'plain-script-for-file-protocol',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html
          .replace(/\s+type="module"/g, ' defer')
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
