#!/usr/bin/env node
/**
 * coverage_guard.js — 月度 Change Pack 覆盖守护
 * 目标：确保 /reports/<YYYY-MM>/ 下的 Pack 数量 >= MIN_PACKS（默认 50）
 * 策略：
 *  1) 统计当前月已有 Pack 数；达标即退出 0。
 *  2) 不足时，优先尝试“证据种子” → 重建索引/Pack。
 *  3) 仍不足，再确保 vendor skeleton → 再次重建。
 *  4) 仍不足，退出码 1，并在 Step Summary 给出原因（供周检/验收卡口）。
 *
 * 依赖（仓库已自带）：
 *  - scripts/evidence_force_seed.js        （合规采样，尊重 robots/sitemap）
 *  - scripts/ensure_vendor_skeletons.js    （创建缺失的 vendors/<slug>/ 骨架）
 *  - scripts/build_evidence_index.js       （重建 data/evidence.ndx）
 *  - scripts/build_change_pack.js          （生成 /reports/<YYYY-MM>/<vendor>/index.html）
 *
 * 环境变量（可选）：
 *  - MIN_PACKS=50            # 月最低 Pack 数
 *  - SEED_BATCH=20           # 每轮种子的目标数量（不足则尽力）
 *  - MAX_ATTEMPTS=2          # 纠偏最大轮数
 *  - OVERRIDE_YM=YYYY-MM     # 指定月份（默认取当前 UTC 月）
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const R = p => path.join(ROOT, p);

const MIN_PACKS   = parseInt(process.env.MIN_PACKS || '50', 10);
const SEED_BATCH  = parseInt(process.env.SEED_BATCH || '20', 10);
const MAX_ATTEMPTS= parseInt(process.env.MAX_ATTEMPTS || '2', 10);
const YM          = (process.env.OVERRIDE_YM || new Date().toISOString().slice(0,7));

function stepSummary(md) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) fs.appendFileSync(f, md + '\n', 'utf8');
}

function exists(p){ try{ fs.accessSync(p); return true; }catch{ return false; } }

function countMonthlyPacks(ym) {
  const base = R(`reports/${ym}`);
  if (!exists(base)) return 0;
  let n = 0;
  for (const d of fs.readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const idx = path.join(base, d.name, 'index.html');
    if (exists(idx)) n++;
  }
  return n;
}

function runNode(script, args = [], opts = {}) {
  const scriptPath = R(`scripts/${script}`);
  if (!exists(scriptPath)) {
    console.warn(`[guard] skip: ${script} not found`);
    return { status: 0, stdout: '', stderr: '' };
  }
  const res = spawnSync('node', [scriptPath, ...args], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    encoding: 'utf8',
    ...opts,
  });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  return res;
}

function rebuild() {
  // 重建索引 & Packs（幂等）
  runNode('build_evidence_index.js');
  runNode('build_change_pack.js');
}

function seedEvidence(batch) {
  // 证据种子：尽力而为（脚本内部已遵守 robots/sitemap）
  // 兼容两种风格：--limit 或环境变量 SEED_LIMIT
  if (exists(R('scripts/evidence_force_seed.js'))) {
    const tryArg = runNode('evidence_force_seed.js', ['--limit', String(batch)]);
    if (tryArg.status !== 0) {
      // 退化到无参数
      runNode('evidence_force_seed.js');
    }
  }
}

function ensureVendorSkeletons() {
  runNode('ensure_vendor_skeletons.js');
}

(function main(){
  const start = Date.now();
  const details = [];
  function log(s){ details.push(s); console.log(s); }

  let packs = countMonthlyPacks(YM);
  log(`[guard] month=${YM} packs=${packs} target>=${MIN_PACKS}`);

  if (packs >= MIN_PACKS) {
    const md = `### Coverage Guard\n- Month: **${YM}**\n- Packs: **${packs}** / target ${MIN_PACKS}\n\n✅ Already sufficient.`;
    stepSummary(md);
    process.exit(0);
  }

  let attempts = 0;
  while (packs < MIN_PACKS && attempts < MAX_ATTEMPTS) {
    attempts++;
    log(`[guard] attempt #${attempts} — deficit=${MIN_PACKS - packs}`);

    // 1) 证据种子
    seedEvidence(Math.max(SEED_BATCH, MIN_PACKS - packs));

    // 2) 重建索引与 Pack
    rebuild();

    // 3) 统计
    packs = countMonthlyPacks(YM);
    log(`[guard] after attempt #${attempts} packs=${packs}`);
    if (packs >= MIN_PACKS) break;

    // 4) 补 vendors skeleton 再重建（兜底一次）
    ensureVendorSkeletons();
    rebuild();
    packs = countMonthlyPacks(YM);
    log(`[guard] after skeletons packs=${packs}`);
  }

  const cost = ((Date.now() - start)/1000).toFixed(1);
  if (packs >= MIN_PACKS) {
    const md = [
      '### Coverage Guard',
      `- Month: **${YM}**`,
      `- Packs: **${packs}** / target ${MIN_PACKS}`,
      `- Attempts: ${attempts}`,
      `- Time: ${cost}s`,
      '\n✅ Coverage reached.'
    ].join('\n');
    stepSummary(md);
    process.exit(0);
  } else {
    const md = [
      '### Coverage Guard',
      `- Month: **${YM}**`,
      `- Packs: **${packs}** / target ${MIN_PACKS}`,
      `- Attempts: ${attempts} (max ${MAX_ATTEMPTS})`,
      `- Time: ${cost}s`,
      '\n❌ Not enough packs after remediation. Please review evidence supply or increase SEED_BATCH/MAX_ATTEMPTS.'
    ].join('\n');
    stepSummary(md);
    console.error(md.replace(/\*\*/g,''));
    process.exit(1);
  }
})();
