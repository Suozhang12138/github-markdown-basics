/**
 * T04 反向验证 —— 证明产物自检里的防护**真的在起作用**。
 *
 * 做法：拿构建产物，把每条约束逐个"拆掉"（注入 module 脚本、绝对路径、外链……），
 * 再跑一遍同一份规则，确认对应的那一条**变红**。
 *
 * 为什么必须做这一步：
 *   一个永远为 true 的断言和没有断言是一样的。构建脚本打印 17 个 ok 并不说明
 *   这 17 条规则有覆盖 —— 只有当"人为破坏能被抓住"时，这些 ok 才有意义。
 *
 * 规则来源：src/artifact-checks.mjs（与 build.mjs 共用，不重复实现）。
 * 破坏手法来源：同一模块导出的 BREAKERS，按规则 key 配对。
 *
 * 用法：node src/reverse-verify.mjs   （需先执行 node src/build.mjs 产出 build/index.html）
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { artifactChecks, BREAKERS } from './artifact-checks.mjs';

const SRC = dirname(fileURLToPath(import.meta.url));
const T04 = dirname(SRC);

const html = readFileSync(join(T04, 'build', 'index.html'), 'utf8');
const csvText = readFileSync(join(SRC, 'data', 'DataSet.csv'), 'utf8');
const companyIds = csvText
  .split(/\r?\n/)
  .slice(1)
  .filter((line) => line.trim() !== '')
  .map((line) => line.split(',')[0]);

// 只传 html：内联脚本由规则模块自己现取，避免"破坏只作用在 html 上、
// 读 inline 的规则却看到旧内容"这类假绿（见 artifact-checks.mjs 的说明）。
const runChecks = (candidate) => artifactChecks({ html: candidate, companyIds });

const baseline = runChecks(html);
const byKey = new Map(baseline.map((c) => [c.key, c]));

console.log('─'.repeat(74));
console.log('反向验证：拆掉约束后，对应规则必须变红');
console.log('─'.repeat(74));

let problems = 0;

// 1) 基线：正常产物必须全绿，否则下面的"变红"没有意义。
const baselineFailed = baseline.filter((c) => !c.ok);
console.log(`  基线：${baseline.length} 项规则，${baselineFailed.length} 项未通过`);
for (const c of baselineFailed) console.log(`    FAIL ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
if (baselineFailed.length > 0) problems += 1;
console.log('');

// 2) 每条破坏手法都要落到一条真实存在的规则上，并让它变红。
const breakKeys = Object.keys(BREAKERS);
for (const key of breakKeys) {
  const rule = byKey.get(key);
  if (!rule) {
    console.log(`  FAIL 破坏手法「${key}」找不到同 key 的规则（规则被改名或删除了？）`);
    problems += 1;
    continue;
  }

  const broken = BREAKERS[key](html, companyIds);
  if (broken === html) {
    console.log(`  FAIL ${rule.name}：注入没有生效（产物结构变了，破坏手法需要跟着更新）`);
    problems += 1;
    continue;
  }

  const target = runChecks(broken).find((c) => c.key === key);
  const ok = Boolean(target) && target.ok === false;
  if (!ok) problems += 1;
  console.log(`  ${ok ? '  ok  ' : ' FAIL '} ${rule.name} → 破坏后该规则 = ${target ? target.ok : '（规则消失）'}`);
}

// 3) 覆盖度：哪些规则没有破坏手法。无法用字符串注入破坏的（如"语法可解析"）属正常，
//    但数量与名字都打印出来，避免"悄悄少测"。
const uncovered = baseline.filter((c) => !breakKeys.includes(c.key));
console.log('');
console.log(`  已覆盖破坏手法：${breakKeys.length} / ${baseline.length} 条规则`);
console.log(`  未配破坏手法的规则：${uncovered.length} 条（无法用字符串注入破坏的属正常）`);
for (const c of uncovered) console.log(`    - ${c.name}`);

console.log('');
if (problems === 0) {
  console.log(`反向验证通过：基线全绿，${breakKeys.length} 项防护拆掉后都变红了。`);
  process.exit(0);
}
console.error(`反向验证失败：${problems} 处问题 —— 存在"看起来在跑、其实是假绿"的防护。`);
process.exit(1);
