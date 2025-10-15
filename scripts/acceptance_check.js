#!/usr/bin/env node
/**
 * Auto Acceptance Gate
 * - 读取 artifacts/daily_ops.json（先跑 fullchain_check.js 生成）
 * - 失败条件（任一触发直接 exit!=0）：
 *   A) fullchain_check 的 FAIL 列表非空（链接错误/抑制失效/回写失败等）
 *   B) 严格阈值未达标：evidence_today / sent_today / hash_ratio / changed_vendors_72h
 * 环境变量（可不设，有默认）：
 *   TARGET_SENT=8
 *   TARGET_EVID_TODAY=10
 *   MIN_HASH_RATIO=0.4
 *   REQUIRE_CHANGED_VENDORS=1
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'artifacts', 'daily_ops.json');

const cfg = {
  TARGET_SENT: Number(process.env.TARGET_SENT || 8),
  TARGET_EVID_TODAY: Number(process.env.TARGET_EVID_TODAY || 10),
  MIN_HASH_RATIO: Number(process.env.MIN_HASH_RATIO || 0.4),
  REQUIRE_CHANGED_VENDORS: Number(process.env.REQUIRE_CHANGED_VENDORS || 1)
};

function readJSON(fp){ try{ return JSON.parse(fs.readFileSync(fp,'utf8')); }catch{ return null; } }
function summaryAdd(md){ if(process.env.GITHUB_STEP_SUMMARY){ fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md+'\n'); } }

(function main(){
  const data = readJSON(ART);
  if (!data) {
    console.error('acceptance_check: missing artifacts/daily_ops.json — run fullchain_check.js first.');
    process.exit(2);
  }
  const k = data.kpi || {};
  const FAIL = data.FAIL || [];
  const WARN = data.WARN || [];

  const failed = [];
  if (FAIL.length) failed.push(`Fullchain FAIL present: ${FAIL.length} item(s)`);

  // 严格阈值
  if ((k.evidence_today || 0) < cfg.TARGET_EVID_TODAY) failed.push(`evidence_today ${k.evidence_today||0} < ${cfg.TARGET_EVID_TODAY}`);
  if ((k.sent_today || 0) < cfg.TARGET_SENT) failed.push(`sent_today ${k.sent_today||0} < ${cfg.TARGET_SENT}`);
  if ((k.hash_ratio || 0) < cfg.MIN_HASH_RATIO) failed.push(`hash_ratio ${(k.hash_ratio*100||0).toFixed(1)}% < ${(cfg.MIN_HASH_RATIO*100)}%`);
  if (cfg.REQUIRE_CHANGED_VENDORS && (k.changed_vendors_72h || 0) <= 0) failed.push('changed_vendors_72h = 0');

  const ok = failed.length === 0;

  const md = [
    '### Auto Acceptance',
    `- Date: **${data.date}**`,
    `- evidence_today: **${k.evidence_today||0}** / target ${cfg.TARGET_EVID_TODAY}`,
    `- sent_today: **${k.sent_today||0}** / target ${cfg.TARGET_SENT}`,
    `- hash_ratio: **${((k.hash_ratio||0)*100).toFixed(1)}%** / target ${(cfg.MIN_HASH_RATIO*100)}%`,
    `- changed_vendors_72h: **${k.changed_vendors_72h||0}** ${cfg.REQUIRE_CHANGED_VENDORS? '(must > 0)':''}`,
    ok ? '\n✅ Acceptance: **PASS**' : '\n❌ Acceptance: **FAIL**',
    failed.length ? ('\n**Blocking reasons:**\n- ' + failed.join('\n- ')) : '',
    WARN && WARN.length ? ('\n**Warnings (not blocking):**\n- ' + WARN.join('\n- ')) : ''
  ].join('\n');

  console.log(md.replace(/\*\*/g,'')); // 控制台纯文本
  summaryAdd(md);

  process.exit(ok ? 0 : 1);
})();
