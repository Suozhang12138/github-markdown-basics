/**
 * T04 构建脚本。
 *
 * 做两件事：
 *   1) 验证 —— 在 Node 里跑一遍 core.js 的纯计算，把统计量和分带不变量打印出来；
 *   2) 打包 —— 把 CSS、JS、CSV 全部内联进单个 build/index.html。
 *
 * 为什么要内联而不是让 html 去 fetch 数据：
 *   产物的要求是「确保可直接浏览」。用 file:// 双击打开时，
 *   fetch 本地文件会被 CORS 拦截，`<script type="module">` 也会因跨源限制无法加载。
 *   所以构建时把数据和代码全部内联，并用普通（非 module）脚本执行 —— 双击即可看，
 *   不依赖任何本地服务器。
 *
 * 用法：node src/build.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { artifactChecks } from './artifact-checks.mjs';

const SRC = dirname(fileURLToPath(import.meta.url));
const T04 = dirname(SRC);
const BUILD_DIR = join(T04, 'build');

const read = (name) => readFileSync(join(SRC, name), 'utf8');

/* ------------------------------------------------------------------ *
 * 1) 验证
 * ------------------------------------------------------------------ */

const core = await import('./core.js');
const csvText = read(join('data', 'DataSet.csv'));
const model = core.buildModel(csvText);

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

check('数据行数 = 50', model.rows.length === 50, `实际 ${model.rows.length}`);
check('维度数 = 5', model.domains.length === 5, `实际 ${model.domains.length}`);
check(
  '每个维度都有 50 个观测',
  model.domains.every((d) => d.values.length === 50),
  model.domains.map((d) => `${d.label}=${d.values.length}`).join(', '),
);
check('数值上界 > 0', model.valueMax > 0, `valueMax=${model.valueMax}`);
check('密度峰值 > 0', model.densityPeak > 0, `peak=${model.densityPeak.toExponential(3)}`);

const bandShapeOk = model.domains.every(
  (d) => d.layers.length === model.bands && d.layers.every((l) => l.length === d.density.points.length),
);
check('分带层数与采样点数一致', bandShapeOk);

const bandRangeOk = model.domains.every((d) =>
  d.layers.every((layer) => layer.every((v) => Number.isFinite(v) && v >= -1e-9 && v <= 1 + 1e-9)),
);
check('分带取值落在 [0,1]', bandRangeOk);

// 折叠的核心不变量：第 b 层必须处处不超过第 b-1 层（层与层是嵌套的）
const nestingOk = model.domains.every((d) =>
  d.layers.every((layer, b) =>
    b === 0 ? true : layer.every((v, k) => v <= d.layers[b - 1][k] + 1e-9),
  ),
);
check('分带嵌套（深层 ⊆ 浅层）', nestingOk);

const densityNonNegative = model.domains.every((d) => d.density.points.every((p) => p.y >= 0));
check('密度非负', densityNonNegative);

console.log('─'.repeat(74));
console.log('数值验证');
console.log('─'.repeat(74));
for (const c of checks) {
  console.log(`${c.ok ? '  ok  ' : ' FAIL '} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
}

console.log('');
console.log('各维度统计');
console.log('─'.repeat(74));
console.log(
  ['岗位'.padEnd(24), 'min', 'Q1', '中位数', '均值', 'Q3', 'max', 'σ'].map((s) => String(s).padStart(8)).join(''),
);
for (const d of model.domains) {
  const s = d.stats;
  console.log(
    d.label.padEnd(24) +
      [s.min, s.q1, s.median, s.mean, s.q3, s.max, s.sd]
        .map((v) => v.toFixed(1).padStart(8))
        .join(''),
  );
}

const failed = checks.filter((c) => !c.ok);
if (failed.length > 0) {
  console.error(`\n构建中止：${failed.length} 项验证未通过。`);
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * 2) 打包
 * ------------------------------------------------------------------ */

/** 把 ES Module 源码转成可直接内联的普通脚本：去掉 import / export 语法。 */
function toInlineScript(source) {
  return source
    .replace(/^\s*import\s[^;]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
}

const coreSource = toInlineScript(read('core.js'));
const appSource = toInlineScript(read('app.js'));
const css = read('styles.css');

const csvJson = JSON.stringify(csvText).replace(/<\//g, '<\\/');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>增强雷达图 · 50 家企业五个岗位报名情况</title>
<style>
${css}
</style>
</head>
<body>
<div class="wrap">
  <header class="page-head">
    <h1>增强雷达图：五个岗位的报名人数分布</h1>
    <p>普通雷达图展示各维度<strong>平均值</strong>，每个维度扇区内用<strong>地平线图</strong>展示该维度全部数据点的分布。</p>
  </header>

  <p class="note">
    <strong>数据说明：</strong>本页数据为按题目字段格式生成的占位数据集（50 家企业 × 5 个岗位）。
    替换 <code>T04/src/data/DataSet.csv</code> 后重新执行 <code>node src/build.mjs</code> 即可换成官方数据。
  </p>

  <section class="card">
    <div class="toolbar">
      <button data-view="combined" class="is-active">结合视图</button>
      <button data-view="radar">仅雷达图</button>
      <button data-view="horizon">仅分布（地平线图）</button>
      <span class="spacer"></span>
      <span class="hint">对应题目图解的 子图3 / 子图1 / 子图2</span>
    </div>
    <svg id="chart" role="img" aria-label="增强雷达图：雷达图叠加各地平线图"></svg>
  </section>

  <section class="card" id="stats"></section>

  <section class="card">
    <ul class="legend">
      <li><span class="swatch swatch-band"></span>地平线图：该岗位全部企业报名人数的分布，颜色越深表示该区间越密集</li>
      <li><span class="swatch swatch-mean"></span>雷达图：各岗位报名人数的平均值多边形</li>
      <li><span class="swatch swatch-x"></span>红 = 地平线图 X 轴（数值轴，径向）　<span class="swatch swatch-y"></span>绿 = Y 轴（密度基线，切向）</li>
    </ul>
  </section>
</div>

<script>
window.__DATASET_CSV__ = ${csvJson};
window.__T04_INLINE__ = true; // 告诉 app.js 的 autoBoot 不要自己启动，改由本文件末尾显式调 boot()
(function () {
${coreSource}
${appSource}
window.__T04_BOOT__ = boot;
})();
window.__T04_BOOT__();
</script>
</body>
</html>
`;

mkdirSync(BUILD_DIR, { recursive: true });
const outFile = join(BUILD_DIR, 'index.html');
writeFileSync(outFile, html, 'utf8');

/* ------------------------------------------------------------------ *
 * 3) 产物自检 —— 构建出来的东西自己再过一遍
 *
 * 规则本身抽在 artifact-checks.mjs 里（唯一口径），这里只负责"不过就中止"。
 * 反向验证（把约束拆掉看是否变红）在 src/reverse-verify.mjs，用的是同一份规则。
 * ------------------------------------------------------------------ */

const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';

const companyIds = csvText
  .split(/\r?\n/)
  .slice(1)
  .filter((line) => line.trim() !== '')
  .map((line) => line.split(',')[0]);

const artifact = artifactChecks({ html, inline, companyIds });
const failedArtifacts = artifact.filter((a) => !a.ok);
if (failedArtifacts.length > 0) {
  for (const a of failedArtifacts) {
    console.error(`产物自检失败：${a.name}${a.detail ? ` (${a.detail})` : ''}`);
  }
  console.error(`\n构建中止：${failedArtifacts.length} 项产物自检未通过。`);
  process.exit(1);
}

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log('');
console.log('─'.repeat(74));
console.log('产物自检');
console.log('─'.repeat(74));
for (const a of artifact) console.log(`  ok   ${a.name}`);
console.log('');
console.log(`产物：${outFile}`);
console.log(`大小：${kb} KB（CSS / JS / CSV 全部内联，file:// 双击即可打开）`);
console.log(`验证：数值断言 ${checks.length} 项 + 产物自检 ${artifact.length} 项，全部通过`);
console.log('─'.repeat(74));
