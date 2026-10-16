/**
 * 产物自检规则 —— **唯一口径**。
 *
 * 为什么单独抽一个模块：这套规则有两个消费者，必须完全一致。
 *   1) src/build.mjs          —— 构建时跑，任一不过就非 0 退出，不出产物；
 *   2) src/reverse-verify.mjs —— 把产物里的约束逐条"拆掉"，确认对应规则真的会变红。
 * 如果两边各写一份正则，就会出现"防护看起来在跑、其实没覆盖"的假绿。
 * 抽出来之后，"规则"只有一处，"破坏手法"在另一边，两者互为对照。
 *
 * 每条规则带一个稳定的 `key`：**人和机器读的字段分开**——`name` 是给人看的中文说明，
 * `key` 是给 reverse-verify 配对破坏手法用的。否则改个标点就会让反向验证静默失配。
 *
 * 规则分两类：
 *   - 结构完整性：构建期剥离 ES Module 语法有没有把代码切坏、数据有没有全带上；
 *   - 可移植性：题目要求 build/ 能**直接浏览**。这里要分清的是 ——
 *     「产物的可移植性」与「源码能不能构建」是两件事，必须按
 *     「零外部依赖 + 不依赖特定协议特性」来验收，而不是"在我机器上能打开"。
 *     file:// 双击打开时：<script type="module"> 会被 CORS 拦掉；
 *     绝对路径会指向磁盘根；外部 URL 断网就没了。
 */

/** 构建期用 toInlineScript() 剥掉 import/export 之后，这些函数必须还在。 */
const REQUIRED_FUNCTIONS = ['buildModel', 'foldBands', 'ribbonPath'];

/** 采集产物里所有「加载型」引用；`#` / `data:` / `file:` 属于自包含，不算外部依赖。 */
function externalRefs(html) {
  return (html.match(/(?:src|href)\s*=\s*["']([^"']+)["']/g) ?? []).filter(
    (attr) => !/["'](#|data:|file:)/.test(attr),
  );
}

/** 从产物里取出内联脚本。**每次都从传入的 html 现取**，不要复用外部算好的字符串。 */
export function extractInline(html) {
  return html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
}

/**
 * @param {{html: string, companyIds: string[]}} input
 * @returns {{key: string, name: string, ok: boolean, detail?: string}[]}
 *
 * 注意：内联脚本在这里**当场从 html 提取**，不由调用方传进来。
 * 这一点是被反向验证逼出来的 —— 早先版本由调用方传入一个只算一次的 `inline`，
 * 结果"拆掉约束"的破坏只作用在 html 上，那几条读 `inline` 的规则永远看到旧内容、
 * 永远为 true，等于假绿。反向验证第一次跑就把这 7 条全暴露了出来。
 */
export function artifactChecks({ html, companyIds }) {
  const inline = extractInline(html);
  const missingIds = companyIds.filter((id) => !html.includes(id));
  const externals = externalRefs(html);

  return [
    { key: 'inline-script', name: '产物含内联脚本', ok: inline.length > 0 },

    {
      key: 'inline-parsable',
      // 只做语法解析、不执行 —— 这样能在没有浏览器的环境里发现构建期的剥离错误。
      name: '内联脚本语法可解析',
      ok: (() => {
        try {
          new Function(inline);
          return true;
        } catch {
          return false;
        }
      })(),
    },

    {
      key: 'no-module-syntax',
      // 只匹配**真正的 export/import 语句**，不匹配注释里出现的 "import" 一词。
      // 早先写成 /^\s*(export|import)\s/m，行内 `var x; export {x};` 这种漏网；
      // 反向验证注入的正是这种，于是当场暴露 —— 说明那条正则只覆盖了行首这半边。
      name: '没有残留的 export / import 语句',
      ok: !/^\s*import\s|\bexport\s*[{*]|\bexport\s+(default|const|let|var|function|class)\b|^\s*export\s+\w/m.test(
        inline,
      ),
    },

    {
      // 检查**函数声明**是否存在，而不是"内联脚本里出现过 boot 这个词"。
      // 这一条同样是反向验证逼出来的：原先用 /\bboot\b/ 之类的子串判断，
      // 结果注释里一句"显式调 boot()"就能让它永远是 true —— 注释被删掉也不会变红。
      key: 'declares:buildModel',
      name: '内联脚本声明了 buildModel / foldBands / ribbonPath（计算层完整）',
      ok: REQUIRED_FUNCTIONS.every((name) => new RegExp(`\\bfunction\\s+${name}\\s*\\(`).test(inline)),
    },

    {
      key: 'declares:boot',
      name: '内联脚本声明了 boot 并接到启动钩子',
      ok: /\bfunction\s+boot\s*\(/.test(inline) && /window\.__T04_BOOT__\s*=\s*boot\b/.test(inline),
    },

    { key: 'explicit-boot', name: '显式调用 boot()', ok: /window\.__T04_BOOT__\(\)/.test(html) },
    {
      // 必须匹配到**赋值语句**本身，不能只判断"出现过 __T04_INLINE__ 这个词" ——
      // app.js 的注释里也写了这个标记名，只查子串的话把赋值删掉照样报 ok。
      key: 'inline-flag',
      name: '已设置内联标记（避免重复启动）',
      ok: /window\.__T04_INLINE__\s*=\s*true/.test(html),
    },
    { key: 'svg-container', name: '含 SVG 容器', ok: html.includes('<svg id="chart"') },
    { key: 'view-buttons', name: '含视图切换按钮', ok: html.includes('data-view="combined"') },
    { key: 'stats-container', name: '含统计表容器', ok: html.includes('id="stats"') },

    {
      // 每条都要求「选择器 + 空格 + 左花括号」，把规则自身的文本锚定住。
      // 不能查裸的 `.mean-polygon`：它是 `.mean-polygon-halo {` 的前缀，
      // 真正的规则被删掉也照样命中（同理 `.band-0` 之于 `.band-0-x`）。
      key: 'style-inlined',
      name: '样式已内联（含均值多边形与分带）',
      ok: ['.mean-polygon {', '.mean-polygon-halo {', '.band-0 {'].every((selector) => html.includes(selector)),
    },

    {
      key: 'data-complete',
      // 不是"包含 CompanyId 字样"，而是逐条核对源 CSV 里的 CompanyId 都在产物里。
      name: `全部 ${companyIds.length} 家企业的数据已内联`,
      ok: companyIds.length > 0 && missingIds.length === 0,
      detail: missingIds.length ? `缺失 ${missingIds.length} 条，例如 ${missingIds[0]}` : '',
    },

    {
      key: 'no-module-script',
      name: '无 module 脚本 / crossorigin',
      ok: !/type\s*=\s*["']module["']/.test(html) && !html.includes('crossorigin'),
    },
    { key: 'no-absolute-path', name: '无根绝对路径引用', ok: !/(?:src|href)\s*=\s*["']\//.test(html) },
    { key: 'no-external-ref', name: '无外部资源引用', ok: externals.length === 0, detail: externals.join(', ') },
  ];
}

/**
 * 反向验证用的「破坏手法」，按规则 key 索引。
 *
 * 每个函数接收产物 HTML，返回**被破坏后**的 HTML。反向验证会确认：
 * 正常产物该规则为 true，破坏后同一条规则变 false。
 * 如果某个函数的注入没有生效（返回值与输入相同），反向验证会当场报错 ——
 * 产物结构一变、手法失效，不会静静变成一条永远通过的假验证。
 */
export const BREAKERS = {
  // 「把 A 改成 B 相矛盾」型：直接改一处字符串。
  'no-module-script': (html) => html.replace('<script>', '<script type="module" crossorigin>'),
  'no-absolute-path': (html) => html.replace('<body>', '<body><img src="/logo.png" alt="" />'),
  'no-external-ref': (html) =>
    html.replace('<body>', '<body><link rel="stylesheet" href="https://cdn.example.com/a.css" />'),
  'explicit-boot': (html) => html.replace('window.__T04_BOOT__();', ''),
  'inline-flag': (html) =>
    // 注释里也出现过这个名字，所以用全局替换把它彻底改掉；
    // 这样"只把赋值删掉、注释还留着"的漏检情形也能被覆盖到。
    html.replaceAll('__T04_INLINE__', '__T04_INLINE_DISABLED__'),
  'svg-container': (html) => html.replace('<svg id="chart"', '<svg id="chart-x"'),
  'view-buttons': (html) => html.replace('data-view="combined"', 'data-view="combined-x"'),
  'stats-container': (html) => html.replace('id="stats"', 'id="stats-x"'),
  'style-inlined': (html) =>
    // 这条规则要求三个选择器都在，破坏时三个都要改掉，否则剩下两个仍然让它为 true。
    html
      .replace('.mean-polygon {', '.mean-polygonBroken {')
      .replace('.mean-polygon-halo {', '.mean-polygon-haloBroken {')
      .replace('.band-0 {', '.band-0Broken {'),
  'no-module-syntax': (html) =>
    // 故意插在**行内**（前面还有 var 语句），因为早先的检查只覆盖行首、这里正是它的漏网形态。
    html.replace('<script>', '<script>\nvar leakedModuleSyntax = 1; export { leakedModuleSyntax };\n'),

  // 「必须真有这个函数声明」型：破坏手法必须真的把声明改掉，
  // 光改注释里的字样是不够的（那样测的是注释，不是代码）。
  'declares:buildModel': (html) =>
    // 三个声明都改掉：这条规则要求"计算层完整"，只废掉一个的话
    // 另外两个仍然存在、规则依旧为 true，就测不出"缺声明"这件事了。
    html
      .replace(/function\s+buildModel\s*\(/, 'function buildModelBroken(')
      .replace(/function\s+foldBands\s*\(/, 'function foldBandsBroken(')
      .replace(/function\s+ribbonPath\s*\(/, 'function ribbonPathBroken('),
  'declares:boot': (html) => html.replace(/window\.__T04_BOOT__\s*=\s*boot\b/, 'window.__T04_BOOT__ = bootBroken'),

  // 数据完整性：抽掉其中一家企业的 CompanyId。
  'data-complete': (html, companyIds) => (companyIds?.[0] ? html.replace(companyIds[0], 'f'.repeat(32)) : html),
};
