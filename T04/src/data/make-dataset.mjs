/**
 * 生成 T04 的占位数据集：50 家企业 × 5 个岗位的报名人数。
 *
 * 为什么需要这个脚本：
 *   题目附带的 DataSet.csv 在考核文档里（飞书 wiki，需登录），本次开发时无法读取。
 *   因此这里按题目描述的**字段格式**生成一份占位数据（50 行、CompanyId + 5 个整数列），
 *   让整套可视化能端到端跑通。拿到官方 DataSet.csv 后，直接覆盖
 *   `src/data/DataSet.csv` 再重新构建即可，代码无需改动。
 *
 * 五个维度刻意用了不同的分布形状，便于检验地平线图能否反映分布差异：
 *   Software Engineer     右偏、量级最大
 *   Product Manager       近似正态
 *   HR Specialist         右偏、量级最小
 *   Data Scientist        双峰
 *   Marketing Coordinator 近似均匀
 *
 * 用法：node src/data/make-dataset.mjs
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'DataSet.csv');

const HEADER = [
  'CompanyId',
  'Software Engineer',
  'Product Manager',
  'HR Specialist',
  'Data Scientist',
  'Marketing Coordinator',
];

/** 确定性 PRNG（mulberry32），保证每次生成的数据完全一致。 */
function makeRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller：由均匀分布得到标准正态。 */
function makeNormal(random) {
  return function normal(mean = 0, sd = 1) {
    const u = Math.max(random(), Number.EPSILON);
    const v = random();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/** 32 位十六进制 CompanyId，形如 0034a5fbed2c1234567ffabca891345。 */
function companyId(random) {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 32; i += 1) id += hex[Math.floor(random() * 16)];
  return id;
}

const clampCount = (value) => Math.max(0, Math.round(value));

function main() {
  const random = makeRandom(20191017);
  const normal = makeNormal(random);
  const rows = [];

  for (let i = 0; i < 50; i += 1) {
    // 右偏：对数正态
    const software = clampCount(Math.exp(normal(Math.log(120), 0.35)));
    // 近似正态
    const product = clampCount(normal(70, 22));
    // 右偏且量级最小
    const hr = clampCount(Math.exp(normal(Math.log(28), 0.4)));
    // 双峰：一半偏小、一半偏大
    const dataScientist = clampCount(
      random() < 0.45 ? normal(38, 12) : normal(112, 14),
    );
    // 近似均匀
    const marketing = clampCount(15 + random() * 80);

    rows.push([companyId(random), software, product, hr, dataScientist, marketing]);
  }

  const csv = [HEADER.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';
  writeFileSync(OUT, csv, 'utf8');
  console.log(`已写入 ${OUT}（${rows.length} 行数据 + 1 行表头）`);
}

main();
