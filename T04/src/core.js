/**
 * T04 纯计算层 —— 不触碰 DOM，浏览器与 Node 都能跑。
 *
 * 这一层负责「把 CSV 变成绘图模型」：解析、统计、核密度估计、地平线图分带折叠。
 * 渲染层（app.js）只消费这里吐出的模型，因此所有数值逻辑都可以在命令行里单独验证。
 */

/** 数据集的五个岗位维度，顺序即雷达图五个扇区的顺序。 */
export const JOB_COLUMNS = [
  'Software Engineer',
  'Product Manager',
  'HR Specialist',
  'Data Scientist',
  'Marketing Coordinator',
];

/**
 * 解析 CSV 文本。
 * 只处理这道题的数据形态（无引号、无换行字段），避免为一个演示项目引入解析依赖。
 * @param {string} text
 * @returns {{header: string[], rows: {companyId: string, values: number[]}[]}}
 */
export function parseCsv(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) return { header: [], rows: [] };

  const header = splitLine(lines[0]);
  const valueStart = 1; // 第 0 列是 CompanyId
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitLine(lines[i]);
    if (cells.length < header.length) continue;
    const values = [];
    for (let c = valueStart; c < header.length; c += 1) {
      values.push(Number(cells[c]));
    }
    rows.push({ companyId: cells[0], values });
  }

  return { header, rows };
}

function splitLine(line) {
  return line.split(',').map((cell) => cell.trim());
}

/**
 * 一组数值的基础统计量。
 * @param {number[]} values
 */
export function columnStats(values) {
  const n = values.length;
  if (n === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, median: 0, sd: 0, q1: 0, q3: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  return {
    count: n,
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median: quantile(sorted, 0.5),
    sd: Math.sqrt(variance),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
  };
}

/** 线性插值分位数（sorted 必须已升序）。 */
export function quantile(sorted, p) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Silverman 经验带宽：h = 0.9 · min(σ, IQR/1.34) · n^(-1/5)
 * 取 σ 与 IQR/1.34 的较小值，是为了在双峰/长尾数据上不至于过度平滑。
 */
export function silvermanBandwidth(values) {
  const s = columnStats(values);
  const n = s.count;
  if (n < 2) return 1;
  const iqr = s.q3 - s.q1;
  const scale = Math.min(s.sd, iqr > 0 ? iqr / 1.34 : s.sd);
  const h = 0.9 * (scale > 0 ? scale : 1) * n ** -0.2;
  return h > 0 ? h : 1;
}

/**
 * 高斯核密度估计。
 *
 * 为什么用 KDE 而不是直方图：地平线图要的是一条连续的「剖面」曲线，
 * 直方图的柱子数量是人为参数、形状会跳变；KDE 平滑且只有一个带宽参数，
 * 配合 Silverman 规则可以完全由数据决定，不需要手调。
 *
 * @param {number[]} values
 * @param {{samples?: number, pad?: number}} [options]
 * @returns {{lo: number, hi: number, bandwidth: number, points: {x: number, y: number}[], peak: number}}
 */
export function kde(values, options = {}) {
  const samples = options.samples ?? 73;
  const pad = options.pad ?? 1.2;
  const bandwidth = silvermanBandwidth(values);
  const points = [];

  if (values.length === 0) {
    return { lo: 0, hi: 0, bandwidth, points, peak: 0 };
  }

  let dataMin = Infinity;
  let dataMax = -Infinity;
  for (const v of values) {
    if (v < dataMin) dataMin = v;
    if (v > dataMax) dataMax = v;
  }

  // 两端各留出一点余量，避免密度曲线在边界被硬切断。
  const lo = Math.max(0, dataMin - pad * bandwidth);
  const hi = dataMax + pad * bandwidth;
  const span = hi - lo || 1;
  const norm = 1 / (values.length * bandwidth * Math.sqrt(2 * Math.PI));

  for (let i = 0; i < samples; i += 1) {
    const x = lo + (span * i) / (samples - 1);
    let sum = 0;
    for (const v of values) {
      const z = (x - v) / bandwidth;
      sum += Math.exp(-0.5 * z * z);
    }
    points.push({ x, y: sum * norm });
  }

  let peak = 0;
  for (const p of points) if (p.y > peak) peak = p.y;
  return { lo, hi, bandwidth, points, peak };
}

/**
 * 地平线图的分带折叠。
 *
 * 经典地平线图的做法：把数值域切成 bands 份，第 b 层只保留「超过 b/bands 的那部分」，
 * 每层都从同一条基线起画、用递增的颜色叠上去。这样高度被压缩到 1/bands，
 * 但层与层之间的颜色深浅仍然编码了原始量级。
 *
 * 本实现返回归一化后的每层厚度（0..1），几何映射交给渲染层。
 *
 * @param {number[]} normalized 归一化到 0..1 的剖面
 * @param {number} bands 分带数量
 * @returns {number[][]} layers[b][i] ∈ [0,1]
 */
export function foldBands(normalized, bands) {
  const step = 1 / bands;
  const layers = [];
  for (let b = 0; b < bands; b += 1) {
    layers.push(
      normalized.map((value) => {
        const folded = Math.min(Math.max(value - b * step, 0), step);
        return folded * bands;
      }),
    );
  }
  return layers;
}

/** 极坐标转直角坐标；deg 以 12 点方向为 -90°。 */
export function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/**
 * 向上取整到「好看」的刻度值。
 *
 * 刻度梯级取得比常见的 {1, 2, 5, 10} 更密：如果只用粗梯级，
 * 例如把最大值 278 归到 500，会有将近一半的半径被浪费，
 * 均值多边形被压在内圈、分布也被摊薄，可读性明显变差。
 */
const NICE_LADDER = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

export function niceCeil(value) {
  if (!(value > 0)) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const frac = value / base;
  let chosen = NICE_LADDER[NICE_LADDER.length - 1];
  for (const candidate of NICE_LADDER) {
    if (frac <= candidate + 1e-9) {
      chosen = candidate;
      break;
    }
  }
  return chosen * base;
}

/**
 * 把 CSV 文本整理成完整的绘图模型 —— 渲染层唯一需要的东西。
 *
 * @param {string} csvText
 * @param {{columns?: string[], bands?: number, samples?: number}} [options]
 */
export function buildModel(csvText, options = {}) {
  const columns = options.columns ?? JOB_COLUMNS;
  const bands = options.bands ?? 3;
  const samples = options.samples ?? 73;

  const { header, rows } = parseCsv(csvText);
  // 表头里可能有多余列；只认我们关心的五个维度（按 header 出现顺序对齐）。
  const names = header.length > 1 ? header.slice(1) : columns;

  const domains = names.map((name, index) => {
    const values = rows.map((row) => row.values[index]).filter((v) => Number.isFinite(v));
    const stats = columnStats(values);
    const density = kde(values, { samples });
    return { key: name, label: name, values, stats, density };
  });

  let valueMax = 0;
  let densityPeak = 0;
  for (const d of domains) {
    if (d.stats.max > valueMax) valueMax = d.stats.max;
    if (d.density.peak > densityPeak) densityPeak = d.density.peak;
  }

  // 归一化后的分带厚度：颜色深浅在不同扇区之间才可比较。
  for (const d of domains) {
    const normalized = d.density.points.map((p) => (densityPeak > 0 ? p.y / densityPeak : 0));
    d.layers = foldBands(normalized, bands);
  }

  return {
    rows,
    columns: names,
    domains,
    bands,
    valueMax: niceCeil(valueMax),
    densityPeak,
  };
}
