/**
 * T04 渲染自检 —— 直接**执行产物自己的内联脚本**，断言它真正画出来的 SVG。
 *
 * 为什么不是"解析产物 HTML 里的 <svg>"：
 *   产物里的 <svg id="chart"> 在源 HTML 里是**空的**，图形全部由内联脚本在运行时
 *   写入 innerHTML。静态解析只能看到一个空壳 —— 第一版自检就是这么写的，
 *   结果 14 项断言全红，暴露的是"测错了对象"，不是产物有问题。
 *
 * 所以这里换个做法：给内联脚本一个**极小的 DOM 桩**，在 Node 里把它真跑一遍，
 * 再对**它生成的 SVG** 做几何断言。这等于在没有浏览器的情况下，
 * 把"浏览器会渲染成什么样"这件事验到了 —— 比字符串检查强得多。
 *
 * 另外两层：
 *   - 结构层：核对产物里确实含有渲染函数与常量（构建期剥离 ES Module 语法没切坏代码）；
 *   - 浏览器层（可选）：用 Edge 无头模式打开**隔离副本**做 DOM 断言。
 *     验收口径是「产物的可移植性」与「源码能不能构建」分开算，
 *     必须把 build/ 单独复制到不带工程、不带 node_modules 的目录里再打开才算数。
 *
 * 浏览器层在这台机器上为什么跑不了（显式记录，不是跳过）：
 *   当前进程以管理员权限（elevated）运行，Chromium 系浏览器在这种情况下拒绝渲染，
 *   --screenshot / --dump-dom 一律不产出输出（退出码 0 但无文件）。
 *   已逐一验证 --no-sandbox / --headless=old / --single-process / 最小 data: URL
 *   等组合，均无法绕过。因此在严格模式下会把"未验证"计为失败（退出码 2），
 *   只有显式传 --allow-no-browser 才降级为警告并列明。
 *
 * 用法：
 *   node src/check-render.mjs                    # 严格：存在未验证项即退出码 2
 *   node src/check-render.mjs --allow-no-browser # 允许无浏览器（仍会列明未验证项）
 */

import { readFileSync, rmSync, mkdirSync, copyFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createContext, runInContext } from 'node:vm';

const SRC = dirname(fileURLToPath(import.meta.url));
const T04 = dirname(SRC);
const ARTIFACT = join(T04, 'build', 'index.html');
const PREVIEW = join(T04, 'preview.png');
const WORK = join(T04, '.render-check');

const ALLOW_NO_BROWSER = process.argv.includes('--allow-no-browser');
const UPDATE_PREVIEW = process.argv.includes('--update-preview');

/* ------------------------------------------------------------------ *
 * 断言收集
 * ------------------------------------------------------------------ */

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail, kind: 'check' });
const unverified = (name, why) => results.push({ name, ok: false, detail: why, kind: 'unverified' });

if (!existsSync(ARTIFACT)) {
  console.error(`找不到产物 ${ARTIFACT}，请先执行：node src/build.mjs`);
  process.exit(1);
}

const html = readFileSync(ARTIFACT, 'utf8');
const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';

/* ------------------------------------------------------------------ *
 * 第 1 层：结构 —— 产物里必须真的含有渲染层代码
 * ------------------------------------------------------------------ */

for (const fn of ['buildModel', 'foldBands', 'ribbonPath', 'renderAll', 'boot', 'applyView']) {
  check(`产物内联脚本含 function ${fn}`, new RegExp(`\\bfunction\\s+${fn}\\s*\\(`).test(inline));
}
check('产物含均值多边形样式', html.includes('.mean-polygon {'));
check('产物含分带样式（含 mix-blend-mode 叠色）', html.includes('.band-0 {') && html.includes('mix-blend-mode: multiply'));

/* ------------------------------------------------------------------ *
 * 第 2 层：在 Node 里真跑一遍产物的内联脚本（极小 DOM 桩）
 * ------------------------------------------------------------------ */

/**
 * 只有 app.js 真正用到的那些 DOM 能力：
 * querySelectorAll / addEventListener / setAttribute / classList / innerHTML / textContent / dataset。
 * 刻意不引 jsdom —— 本项目保持零依赖。
 */
function makeStubDocument() {
  const nodes = [];
  const makeNode = (tag, attrs = {}) => {
    const node = {
      tagName: tag,
      attributes: { ...attrs },
      innerHTML: '',
      textContent: '',
      children: [],
      listeners: {},
      dataset: {},
      classList: {
        _set: new Set(),
        add(...names) {
          names.forEach((n) => this._set.add(n));
        },
        remove(...names) {
          names.forEach((n) => this._set.delete(n));
        },
        contains(name) {
          return this._set.has(name);
        },
        toggle(name, on) {
          if (on) this._set.add(name);
          else this._set.delete(name);
        },
        get value() {
          return [...this._set].join(' ');
        },
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      getAttribute(name) {
        return this.attributes[name] ?? null;
      },
      addEventListener(type, handler) {
        (this.listeners[type] ??= []).push(handler);
      },
    };
    nodes.push(node);
    return node;
  };

  const svg = makeNode('svg', { id: 'chart' });
  const table = makeNode('div', { id: 'stats' });

  // 三个视图切换按钮：boot() 会给它们各绑一个 click handler。
  const buttons = ['combined', 'radar', 'horizon'].map((view) => makeNode('button', { 'data-view': view }));

  const document = {
    readyState: 'complete',
    querySelector(selector) {
      if (selector === '#chart') return svg;
      if (selector === '#stats') return table;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-view]') return buttons;
      return [];
    },
    addEventListener() {},
  };

  return { document, svg, table, buttons, nodes };
}

const stub = makeStubDocument();
const csv = readFileSync(join(SRC, 'data', 'DataSet.csv'), 'utf8');
const sandbox = {
  window: { __DATASET_CSV__: csv },
  document: stub.document,
  console,
};
sandbox.window.document = stub.document;

let execError = null;
try {
  // 不传 timeout 之外的额外能力：这是"真的把产物跑起来"，不是模拟。
  runInContext(inline, createContext(sandbox), { filename: 'build/index.html:<inline script>' });
} catch (error) {
  execError = error;
}

check('产物内联脚本可执行（无异常）', execError === null, execError ? String(execError.message) : '');

const svgOut = stub.svg.innerHTML;
check('脚本执行后向 svg#chart 写入了内容', typeof svgOut === 'string' && svgOut.length > 1000, `${svgOut.length} 字符`);
check('脚本执行后写入了统计表', stub.table.innerHTML.includes('<table'));

/* --- 几何断言：对"它真正画出来的 SVG" --- */

const count = (re) => (svgOut.match(re) ?? []).length;
const viewBox = stub.svg.attributes.viewBox ?? '';
check('svg 带 viewBox', viewBox.length > 0, viewBox);

check('雷达图：1 个均值多边形', count(/class="mean-polygon"/g) === 1, `实际 ${count(/class="mean-polygon"/g)}`);
check('雷达图：5 个均值顶点', count(/class="mean-dot"/g) === 5, `实际 ${count(/class="mean-dot"/g)}`);

const bandTotal = count(/class="band band-\d"/g);
check('地平线图：15 条分带（5 扇区 × 3 层）', bandTotal === 15, `实际 ${bandTotal}`);
for (const b of [0, 1, 2]) {
  const n = count(new RegExp(`class="band band-${b}"`, 'g'));
  check(`地平线图：第 ${b} 层 5 条`, n === 5, `实际 ${n}`);
}

/* --- 叠色分层：浅层必须在均值多边形之下、深层之上 --- */
const idxBelow = svgOut.indexOf('<g class="layer-density">');
const idxRadar = svgOut.indexOf('class="layer-radar"');
const idxOver = svgOut.indexOf('layer-density-over');
check(
  '图层顺序：浅层 → 均值多边形 → 深层（保证分布不被紫色填充吃掉）',
  idxBelow >= 0 && idxRadar > idxBelow && idxOver > idxRadar,
  `below@${idxBelow} radar@${idxRadar} over@${idxOver}`,
);

check('红 X 轴 5 条 / 绿 Y 轴 5 条', count(/class="axis-x"/g) === 5 && count(/class="axis-y"/g) === 5);

const tickTexts = Array.from(svgOut.matchAll(/class="tick-label"[^>]*>([^<]*)</g)).map((m) => m[1]);
check('刻度为 0/75/150/225/300（含 0）', tickTexts.join(',') === '0,75,150,225,300', tickTexts.join(','));

/* --- 均值顶点半径必须精确等于"该维度均值映射到数值轴"的半径 --- */
const SIZE = 940;
const CX = SIZE / 2;
const R = 330;
const R0 = 0.1 * R;
const RM = 0.88 * R;
const num = (s) => Number(s);
const toRadius = (v) => R0 + (Math.min(Math.max(v, 0), num(viewBoxMax)) / num(viewBoxMax)) * (RM - R0);
void toRadius;

// 用脚本自己算出的模型来比对，避免自检里再重算一遍统计量。
const model = sandbox.window.__T04_MODEL__ ?? null;
check('脚本在 window 上导出了绘图模型（便于核对）', model !== null);

/* 顶点核对用纯几何：从 polygon points 反推每个顶点的半径，和 model 的均值比。 */
const polygonPoints = (svgOut.match(/class="mean-polygon" points="([^"]+)"/)?.[1] ?? '')
  .split(' ')
  .filter(Boolean)
  .map((pair) => pair.split(',').map(Number));
check('均值多边形有 5 个顶点', polygonPoints.length === 5, `实际 ${polygonPoints.length}`);

if (model && polygonPoints.length === 5) {
  const valueMax = model.valueMax;
  let maxErr = 0;
  const angles = polygonPoints.map(([x, y]) => (Math.atan2(y - CX, x - CX) * 180) / Math.PI);
  void angles;
  polygonPoints.forEach(([x, y], i) => {
    const r = Math.hypot(x - CX, y - CX);
    const expected = R0 + (model.domains[i].stats.mean / valueMax) * (RM - R0);
    maxErr = Math.max(maxErr, Math.abs(r - expected));
  });
  check('均值顶点半径 = 均值映射半径（误差 < 0.5px）', maxErr < 0.5, `最大误差 ${maxErr.toFixed(4)}px`);
} else {
  check('均值顶点半径 = 均值映射半径（误差 < 0.5px）', false, '无法取得模型或顶点');
}
void viewBox;

/* --- 视图切换真的绑上了 handler --- */
check(
  '三个视图按钮都绑定了 click handler',
  stub.buttons.every((b) => (b.listeners.click ?? []).length === 1),
  stub.buttons.map((b) => `${b.getAttribute('data-view')}:${(b.listeners.click ?? []).length}`).join(' '),
);

// 点一下"仅分布"，确认它改的是同一份 class（这条能抓住"绑了两组监听器"的重复启动 bug）。
if (stub.buttons.every((b) => (b.listeners.click ?? []).length >= 1)) {
  const horizonBtn = stub.buttons.find((b) => b.getAttribute('data-view') === 'horizon');
  horizonBtn.listeners.click.forEach((h) => h());
  check(
    '点击"仅分布"后 svg 切到 view-horizon 且不含 view-combined',
    stub.svg.classList.contains('view-horizon') && !stub.svg.classList.contains('view-combined'),
    stub.svg.classList.value,
  );
  check('重复启动检查：handler 数量为 1（没有 boot 两次）', (horizonBtn.listeners.click ?? []).length === 1);
}

/* ------------------------------------------------------------------ *
 * 第 3 层：隔离副本 + 无头浏览器（本机提权环境下不可用）
 * ------------------------------------------------------------------ */

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const browser = EDGE_CANDIDATES.find((p) => existsSync(p));

/**
 * 尽力删除临时目录。
 *
 * 为什么不能直接 rmSync：Edge 退出后仍会在 user-data-dir 里留文件锁，
 * 删除会抛 EPERM/EBUSY。这只是清理临时产物，**不该让它把整个自检打挂**
 * （第一版就是这么挂的：清理失败导致脚本直接崩、前面的断言结果全丢）。
 * 删不掉就退化为"清空内容"，再不行就留着 —— 都是可再生的临时目录。
 */
function bestEffortClean(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    return '';
  } catch (error) {
    return `${error.code ?? 'ERR'}`;
  }
}

const isolatedDir = join(WORK, 'isolated');
const cleanNote = bestEffortClean(WORK);
mkdirSync(isolatedDir, { recursive: true });
copyFileSync(ARTIFACT, join(isolatedDir, 'index.html'));
check(
  '隔离副本已生成（只带 index.html，无 src/ 无 node_modules）',
  existsSync(join(isolatedDir, 'index.html')),
);
if (cleanNote) {
  check('临时目录清理（Edge 可能仍持有文件锁）', true, `上一次残留未删净：${cleanNote}，已复用目录`);
}

/** preview.png 的"是不是真被重写"证据：只看 mtime 有没有变，不看它是否存在。 */
const previewMtimeBefore = existsSync(PREVIEW) ? statSync(PREVIEW).mtimeMs : null;

let browserUsable = false;
if (!browser) {
  unverified('浏览器渲染自检', '未找到 Edge / Chrome');
} else {
  const url = `file:///${join(isolatedDir, 'index.html').replace(/\\/g, '/')}`;
  // 每次用一个新的 profile 目录：Edge 退出后常残留文件锁，
  // 复用同一个目录会让下一次启动失败（表现为 --dump-dom 无输出、退出码 21）。
  const profileDir = join(WORK, `profile-${process.pid}-${Date.now()}`);
  mkdirSync(profileDir, { recursive: true });
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profileDir}`,
  ];

  /*
   * 先截图、再 dump-dom —— 顺序是有意的，而且是被一次假绿逼出来的。
   *
   * 早先版本先跑 dump-dom，拿到空输出就判定"浏览器不可用"，然后顺手断言
   * "preview.png 存在且 > 30KB"：它查的是**上一次遗留的旧图**。于是
   * `--update-preview` 明明一个字节都没写，脚本却打印 ok 并以 0 退出。
   * 现在只认一个证据：截图目标文件的 mtime 真的变了。
   */
  const shotTarget = UPDATE_PREVIEW ? PREVIEW : join(WORK, 'render.png');
  const shot = spawnSync(browser, [...args, '--hide-scrollbars', '--window-size=1000,1500', `--screenshot=${shotTarget}`, url], {
    encoding: 'utf8',
  });
  const shotBytes = existsSync(shotTarget) ? readFileSync(shotTarget).length : 0;

  if (UPDATE_PREVIEW) {
    const mtimeAfter = existsSync(PREVIEW) ? statSync(PREVIEW).mtimeMs : null;
    const refreshed = mtimeAfter !== null && mtimeAfter !== previewMtimeBefore;
    check(
      '--update-preview：preview.png 被真正重写（按 mtime 判定）',
      refreshed,
      refreshed ? `${(shotBytes / 1024).toFixed(1)} KB` : `未重写（exit=${shot.status}，浏览器没出图）`,
    );
    if (refreshed) {
      // 重出成功才更新"这张图对应哪份产物"的记录；失败就不动，避免留下对不上的元数据。
      const artifactSha256 = createHash('sha256').update(readFileSync(ARTIFACT)).digest('hex').toUpperCase();
      writeFileSync(
        join(T04, 'preview.provenance.json'),
        `${JSON.stringify(
          {
            artifact: 'build/index.html',
            artifactSha256,
            artifactBytes: readFileSync(ARTIFACT).length,
            preview: 'preview.png',
            previewBytes: readFileSync(PREVIEW).length,
            previewWidth: 1000,
            previewHeight: 1500,
            renderedBy: 'Edge headless (--headless=new --screenshot, window 1000x1500)',
            // 刻意用 ASCII：这份 JSON 会被各种工具读，Windows PowerShell 5.1
            // 在没有 BOM 时会按 ANSI 解码、把中文显示成乱码（文件本身没问题，但很误导）。
            note: 'Records which build/index.html this preview.png was rendered from. The build is deterministic, so artifactSha256 is used as the anchor instead of mtime. If the artifact content changes, the hash stops matching and check-render.mjs reports it.',
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      check('preview.provenance.json 已更新为当前产物哈希', true, artifactSha256.slice(0, 12));
    }
  } else if (shotBytes > 30 * 1024) {
    check('浏览器截图非空白', true, `${(shotBytes / 1024).toFixed(1)} KB`);
  } else {
    unverified('浏览器截图', `--screenshot 未产出有效文件（exit=${shot.status}）`);
  }

  // 能出图就说明浏览器可用；再用 dump-dom 补 DOM 级断言。
  const dump = spawnSync(browser, [...args, '--virtual-time-budget=3000', '--dump-dom', url], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const dom = dump.stdout ?? '';

  if (dom.length === 0) {
    unverified(
      '浏览器 DOM 断言（隔离副本）',
      `--dump-dom 无输出（exit=${dump.status}）` +
        (shotBytes > 30 * 1024
          ? '；但同一浏览器的 --screenshot 正常出图，因此只有 DOM 这一层无法断言'
          : '；截图也未出图，本机浏览器渲染完全不可用'),
    );
  } else {
    browserUsable = true;
    const svgStart = dom.indexOf('<svg id="chart"');
    const svgEnd = dom.indexOf('</svg>', svgStart);
    const domSvg = svgStart >= 0 && svgEnd > svgStart ? dom.slice(svgStart, svgEnd) : '';
    const domCount = (re) => (domSvg.match(re) ?? []).length;
    check('浏览器 DOM：JS 执行后 svg#chart 有内容', svgStart >= 0 && domSvg.length > 1000, `${domSvg.length} 字符`);
    check('浏览器 DOM：雷达图 1 多边形 + 5 顶点', domCount(/class="mean-polygon"/g) === 1 && domCount(/class="mean-dot"/g) === 5);
    check('浏览器 DOM：地平线图 15 条分带', domCount(/class="band band-\d"/g) === 15, `实际 ${domCount(/class="band band-\d"/g)}`);
  }
}

/*
 * 预览图与产物的对应关系 —— 按**内容哈希**判断，不按 mtime。
 *
 * 为什么不用 mtime：本项目构建是确定性的（同样的输入产出逐字节相同的 index.html）。
 * 重跑一次构建会刷新 index.html 的 mtime，但内容其实一个字节都没变，
 * 此时按 mtime 判"预览图过期"是假警报；反过来，若有人改了源码之外的输入却没重出图，
 * mtime 也可能恰好蒙混过去。所以用 build/index.html 的 SHA-256 做锚点：
 * preview.provenance.json 里记录"这张预览图由哪一份产物渲染而来"，
 * 内容一变哈希就对不上，直接报红。
 */
const provenancePath = join(T04, 'preview.provenance.json');
if (existsSync(PREVIEW) && existsSync(provenancePath)) {
  const bytes = readFileSync(PREVIEW).length;
  const artifactHash = createHash('sha256').update(readFileSync(ARTIFACT)).digest('hex').toUpperCase();
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  check('preview.png 非空白（> 30KB）', bytes > 30 * 1024, `${(bytes / 1024).toFixed(1)} KB`);
  check(
    'preview.png 对应当前产物（记录哈希 = 实际哈希）',
    provenance.artifactSha256 === artifactHash,
    provenance.artifactSha256 === artifactHash
      ? provenance.artifactSha256.slice(0, 12)
      : `记录 ${String(provenance.artifactSha256).slice(0, 12)} ≠ 实际 ${artifactHash.slice(0, 12)} —— 需要重出预览图`,
  );
} else if (existsSync(PREVIEW)) {
  check('preview.png 非空白（> 30KB）', readFileSync(PREVIEW).length > 30 * 1024);
  unverified('preview.png 的来源可追溯', '缺少 preview.provenance.json');
} else {
  unverified('preview.png 存在', '预览图缺失');
}

/* ------------------------------------------------------------------ *
 * 报告
 * ------------------------------------------------------------------ */

const failed = results.filter((r) => r.kind === 'check' && !r.ok);
const skipped = results.filter((r) => r.kind === 'unverified');
const passed = results.filter((r) => r.kind === 'check' && r.ok);

console.log('─'.repeat(74));
console.log('渲染自检');
console.log('─'.repeat(74));
console.log(`  产物：  ${ARTIFACT}`);
console.log(`  浏览器：${browser ?? '（未找到）'}${browserUsable ? '' : '  [本机不可用]'}`);
console.log('');
for (const r of results) {
  if (r.kind === 'unverified') continue;
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}

console.log('');
if (skipped.length) {
  console.log('未验证项（不是通过，也不是失败）：');
  for (const r of skipped) console.log(`  ??   ${r.name}\n       ${r.detail}`);
  console.log('');
}

console.log(`统计：断言 ${passed.length + failed.length} 项（通过 ${passed.length}，失败 ${failed.length}），未验证 ${skipped.length} 项`);

if (failed.length > 0) {
  console.error('渲染自检失败。');
  process.exit(1);
}
if (skipped.length > 0 && !ALLOW_NO_BROWSER) {
  console.error('渲染自检未完成：存在未验证项。确认环境受限时用 --allow-no-browser 降级为警告。');
  process.exit(2);
}
console.log('渲染自检通过。');
process.exit(0);
