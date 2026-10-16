/**
 * T04 渲染层 —— 把 core.js 产出的绘图模型画成 SVG。
 *
 * 布局决策（详见 ../README.md）：
 *   半径 = 数值轴（与雷达图共享同一套刻度），角度 = 密度轴。
 *   这样「平均值多边形」和「分布」落在同一个数值轴上，两张图才是真正叠合的，
 *   而不是各画各的、只是放进同一个扇区。
 *
 * 图层顺序（从下到上）：扇区底 → 网格 → 密度分带(淡) → 均值多边形 → 网格(淡) → 密度分带(深)
 *   → 轴标记 → 刻度 → 标签。
 *
 * 为什么密度分带要**分两层**夹住均值多边形：
 *   地平线图的颜色深浅本身就是它的信息载体，均值多边形如果整个盖在它上面，
 *   多边形内部的分布就被糊掉了（第一版就是这样，五个扇区的分带几乎看不见）。
 *   把最浅的一层压在下面、深的两层用 multiply 叠在上面，均值多边形的轮廓仍然连续可读，
 *   而分布最深的部分又不会被紫色填充吃掉。这是渲染出来对比后才定的顺序。
 *
 * 轴标记必须画在最上层：密度以角平分线为轴对称铺开，必然盖住画在角平分线上的红轴。
 */

import { buildModel, polar, JOB_COLUMNS } from './core.js';

const SIZE = 940;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 330;
const R0 = 0.1 * R; // 数值 0 对应的半径
const RM = 0.88 * R; // 数值上界对应的半径
const MAX_HALF = 25; // 密度最大时向两侧张开的半角（度）；扇区半角为 36°
const LABEL_GAP = 26;

/**
 * 视图窗口：正方形画布 [0,SIZE]²，但上下各裁掉一段空白。
 * 图的真实纵向范围约为 CY±(RM+LABEL_GAP+标签高) ≈ 200..740，
 * 不裁的话上下各有约 200px 纯空白，卡片被撑得很高。
 */
const VIEW_TOP = 90;
const VIEW_H = 760;

/**
 * 地平线图三层分带的配色：由浅到深，越深代表该处数据越密集。
 * 用单色系的蓝——地平线图靠"同一色相的深浅"编码量级，混入第二色相会破坏这个读法。
 */
const BAND_COLORS = ['#e8f0fe', '#93b4f5', '#2b4fc8'];

/**
 * 分带分层归属：最浅一层画在均值多边形下面，深的两层画在上面。
 * 见文件头对图层顺序的说明。
 */
const BAND_LAYER = ['below', 'above', 'above'];

const format = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : '—');
const f = (n) => n.toFixed(2);

function sectorAngle(index, total) {
  return -90 + (360 / total) * index;
}

function valueToRadius(value, valueMax) {
  const clamped = Math.min(Math.max(value, 0), valueMax);
  return R0 + (clamped / valueMax) * (RM - R0);
}

/** 扇区楔形路径。 */
function wedgePath(thetaC, halfAngle, radius) {
  const [x0, y0] = polar(CX, CY, radius, thetaC - halfAngle);
  const [x1, y1] = polar(CX, CY, radius, thetaC + halfAngle);
  return `M ${CX} ${CY} L ${f(x0)} ${f(y0)} A ${radius} ${radius} 0 0 1 ${f(x1)} ${f(y1)} Z`;
}

/**
 * 一个分带层的「叶片」路径。
 * 沿数值轴采样，每个采样点按该层的折叠厚度向两侧张开 ±φ。
 */
function ribbonPath(domain, layer, thetaC, valueMax) {
  const points = domain.density.points;
  const left = [];
  const right = [];

  for (let k = 0; k < points.length; k += 1) {
    const radius = valueToRadius(points[k].x, valueMax);
    const phi = layer[k] * MAX_HALF;
    left.push(polar(CX, CY, radius, thetaC - phi));
    right.push(polar(CX, CY, radius, thetaC + phi));
  }

  const parts = [`M ${f(left[0][0])} ${f(left[0][1])}`];
  for (let k = 1; k < left.length; k += 1) parts.push(`L ${f(left[k][0])} ${f(left[k][1])}`);
  for (let k = right.length - 1; k >= 0; k -= 1) parts.push(`L ${f(right[k][0])} ${f(right[k][1])}`);
  parts.push('Z');
  return parts.join(' ');
}

function ringPaths(model, className) {
  const ticks = [0.25, 0.5, 0.75, 1];
  return ticks
    .map((t) => {
      const radius = valueToRadius(model.valueMax * t, model.valueMax);
      return `<circle class="${className}" cx="${CX}" cy="${CY}" r="${f(radius)}" />`;
    })
    .join('');
}

/** 底层：扇区底 + 扇区分隔线 + 网格圈。 */
function renderGrid(model) {
  const total = model.domains.length;
  const wedges = model.domains
    .map((_, i) => `<path class="sector-wedge" d="${wedgePath(sectorAngle(i, total), 180 / total, RM)}" />`)
    .join('');

  const spokes = Array.from({ length: total }, (_, i) => {
    const [x, y] = polar(CX, CY, RM, sectorAngle(i, total) + 180 / total);
    return `<line class="sector-spoke" x1="${CX}" y1="${CY}" x2="${f(x)}" y2="${f(y)}" />`;
  }).join('');

  return `<g class="layer-base">${wedges}${spokes}${ringPaths(model, 'grid-ring')}</g>`;
}

/**
 * 每个扇区里的地平线图。
 * 返回两组：`below` 画在均值多边形下面，`above` 画在它上面（见 BAND_LAYER）。
 */
function renderDensity(model) {
  const total = model.domains.length;
  const below = [];
  const above = [];

  model.domains.forEach((domain, i) => {
    const theta = sectorAngle(i, total);
    const bandPaths = [[], []];

    domain.layers.forEach((layer, b) => {
      const d = ribbonPath(domain, layer, theta, model.valueMax);
      const color = BAND_COLORS[b] ?? BAND_COLORS[BAND_COLORS.length - 1];
      const target = BAND_LAYER[b] === 'above' ? 1 : 0;
      bandPaths[target].push(`<path class="band band-${b}" d="${d}" fill="${color}" />`);
    });

    for (const [slot, paths] of bandPaths.entries()) {
      if (paths.length === 0) continue;
      const tip = `<title>${domain.label}：${domain.stats.count} 家企业，报名人数 ${Math.round(
        domain.stats.min,
      )}–${Math.round(domain.stats.max)}，均值 ${format(domain.stats.mean)}</title>`;
      (slot === 1 ? above : below).push(
        `<g class="sector" data-key="${domain.key}">${tip}<g class="layer-bands">${paths.join('')}</g></g>`,
      );
    }
  });

  return {
    below: `<g class="layer-density">${below.join('')}</g>`,
    above: `<g class="layer-density-over">${above.join('')}</g>`,
  };
}

/** 均值多边形（普通雷达图）。 */
function renderRadar(model) {
  const total = model.domains.length;
  const vertices = model.domains.map((domain, i) =>
    polar(CX, CY, valueToRadius(domain.stats.mean, model.valueMax), sectorAngle(i, total)),
  );
  const polygon = vertices.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');

  const dots = vertices
    .map(
      ([x, y], i) =>
        `<circle class="mean-dot" cx="${f(x)}" cy="${f(y)}" r="5.5"><title>${
          model.domains[i].label
        } 均值 ${format(model.domains[i].stats.mean)}</title></circle>`,
    )
    .join('');

  return `<g class="layer-radar"><polygon class="mean-polygon-halo" points="${polygon}" /><polygon class="mean-polygon" points="${polygon}" />${dots}</g>`;
}

/**
 * 轴标记：红 = 地平线图 X 轴（数值轴，径向），绿 = Y 轴（密度基线，切向）。
 * 画在最上层，不再加白色外描边 —— 白边会把五根轴糊成一圈白星芒，反而盖住红绿本身。
 */
function renderAxes(model) {
  const total = model.domains.length;
  return `<g class="layer-axes">${model.domains
    .map((domain, i) => {
      const theta = sectorAngle(i, total);
      const rLo = valueToRadius(domain.density.lo, model.valueMax);
      const rHi = valueToRadius(domain.density.hi, model.valueMax);

      const [ax0, ay0] = polar(CX, CY, rLo, theta);
      const [ax1, ay1] = polar(CX, CY, rHi, theta);
      const [gx0, gy0] = polar(CX, CY, rLo, theta - MAX_HALF);
      const [gx1, gy1] = polar(CX, CY, rLo, theta + MAX_HALF);

      return `<g class="axes">
        <line class="axis-x" x1="${f(ax0)}" y1="${f(ay0)}" x2="${f(ax1)}" y2="${f(ay1)}" />
        <line class="axis-y" x1="${f(gx0)}" y1="${f(gy0)}" x2="${f(gx1)}" y2="${f(gy1)}" />
      </g>`;
    })
    .join('')}</g>`;
}

/**
 * 刻度标签沿 6 点方向（扇区分隔线上）排布。
 * 这条线上任何扇区的密度叶片都不会覆盖，比放在 12 点方向干净得多。
 */
function renderTicks(model) {
  // 0 也要标出来：红色数值轴是从圆心开始量的，缺了 0 就没有起始参照。
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return `<g class="layer-ticks">${ticks
    .map((t) => {
      const radius = valueToRadius(model.valueMax * t, model.valueMax);
      const [x, y] = polar(CX, CY, radius, 90);
      const anchor = t === 0 ? 'end' : 'start';
      const dx = t === 0 ? -9 : 9;
      return `<text class="tick-label" x="${f(x + dx)}" y="${f(y + 4)}" text-anchor="${anchor}">${Math.round(
        model.valueMax * t,
      )}</text>`;
    })
    .join('')}</g>`;
}

function renderLabels(model) {
  const total = model.domains.length;
  return `<g class="layer-labels">${model.domains
    .map((domain, i) => {
      const theta = sectorAngle(i, total);
      const [x, y] = polar(CX, CY, RM + LABEL_GAP, theta);
      const anchor = Math.abs(Math.cos((theta * Math.PI) / 180)) < 0.2 ? 'middle' : x > CX ? 'start' : 'end';
      return `<text class="sector-label" x="${f(x)}" y="${f(y)}" text-anchor="${anchor}">
        <tspan x="${f(x)}" dy="0">${domain.label}</tspan>
        <tspan class="sector-label-sub" x="${f(x)}" dy="18">均值 ${format(domain.stats.mean)}</tspan>
      </text>`;
    })
    .join('')}</g>`;
}

function renderStats(model) {
  const rows = model.domains
    .map(
      (d) => `<tr>
        <th scope="row">${d.label}</th>
        <td>${d.stats.count}</td>
        <td>${Math.round(d.stats.min)}</td>
        <td>${d.stats.q1.toFixed(0)}</td>
        <td>${format(d.stats.median)}</td>
        <td class="strong">${format(d.stats.mean)}</td>
        <td>${d.stats.q3.toFixed(0)}</td>
        <td>${Math.round(d.stats.max)}</td>
        <td>${format(d.stats.sd)}</td>
      </tr>`,
    )
    .join('');

  return `
    <table class="stats">
      <caption>各维度统计量（样本 ${model.rows.length} 家企业）</caption>
      <thead>
        <tr><th>岗位</th><th>n</th><th>min</th><th>Q1</th><th>中位数</th><th>均值</th><th>Q3</th><th>max</th><th>标准差</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * 渲染整套可视化。
 * @param {{svg: SVGSVGElement, table: HTMLElement}} targets
 * @param {ReturnType<typeof buildModel>} model
 */
export function renderAll(targets, model) {
  targets.svg.setAttribute('viewBox', `0 ${VIEW_TOP} ${SIZE} ${VIEW_H}`);
  targets.svg.classList.add('view-combined');
  const density = renderDensity(model);
  targets.svg.innerHTML = [
    renderGrid(model),
    density.below,
    renderRadar(model),
    `<g class="layer-grid-over">${ringPaths(model, 'grid-ring-over')}</g>`,
    density.above,
    renderAxes(model),
    renderTicks(model),
    renderLabels(model),
  ].join('');
  targets.table.innerHTML = renderStats(model);
}

const VIEW_CLASSES = ['view-combined', 'view-radar', 'view-horizon'];

/** 切换视图（对应题目图解的 子图1 / 子图2 / 子图3）。 */
export function applyView(svg, view) {
  svg.classList.remove(...VIEW_CLASSES);
  svg.classList.add(`view-${view}`);
}

function bindViewSwitch(svg) {
  const buttons = Array.from(document.querySelectorAll('[data-view]'));
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      applyView(svg, button.getAttribute('data-view'));
      buttons.forEach((b) => b.classList.toggle('is-active', b === button));
    });
  });
}

/**
 * 渲染入口。
 *
 * 导出它是为了被构建产物显式调用 —— 内联成普通脚本后，模块顶层的
 * `if (typeof document !== 'undefined')` 自动启动逻辑会被剥掉，
 * 构建脚本末尾必须自己调一次，否则页面只剩静态骨架、视图切换按钮全是死的。
 */
export function boot() {
  const csv = typeof window !== 'undefined' ? window.__DATASET_CSV__ : undefined;
  const svg = document.querySelector('#chart');
  const table = document.querySelector('#stats');
  if (!svg || !table) return;

  if (!csv) {
    table.innerHTML = '<p class="error">未找到数据：请通过 T04/src/build.mjs 构建后再打开。</p>';
    return;
  }

  const model = buildModel(csv);
  // 暴露绘图模型：给渲染自检（src/check-render.mjs）核对几何用，
  // 这样自检比对的是"脚本自己算出来的统计量"，而不是它在旁边另算一份。
  window.__T04_MODEL__ = model;
  renderAll({ svg, table }, model);
  bindViewSwitch(svg);
}

/**
 * 自动启动：只在**模块方式**（src/index.html，需要 http 环境）下生效。
 *
 * 构建产物把本文件内联成普通脚本，此时启动由 build.mjs 显式调用 boot()，
 * 因此那一边会在窗口上立一个 `__T04_INLINE__` 标记来跳过这里 ——
 * 否则 boot() 会被执行两次，视图切换按钮会绑上两组监听器。
 */
export function autoBoot() {
  if (typeof document === 'undefined') return;
  if (typeof window !== 'undefined' && window.__T04_INLINE__) return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}

autoBoot();

export { JOB_COLUMNS };
