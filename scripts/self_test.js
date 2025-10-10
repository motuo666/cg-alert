// scripts/self_test.js
// 目的：一键自检“供给→发现→发信(DRY)→入站→交付→产物”
// 运行：node scripts/self_test.js   （不会发送真实邮件/Slack）

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';

const log = (m)=>console.log(m);
const ok  = (m)=>console.log(`✅ ${m}`);
const bad = (m)=>console.error(`❌ ${m}`);

function ensureDir(p){ fs.mkdirSync(p,{recursive:true}); }
function write(fp, s){ ensureDir(path.dirname(fp)); fs.writeFileSync(fp, s, 'utf8'); }
function exists(fp){ return fs.existsSync(fp); }
function read(fp){ return exists(fp) ? fs.readFileSync(fp,'utf8') : ''; }
function lineCount(fp){ return exists(fp) ? read(fp).trim().split(/\r?\n/).filter(Boolean).length : 0; }

/** 运行一个步骤；允许某些非零退出码视为 PASS（例如 discover 0 新增常用 exit 2） */
function runStep(name, cmd, args=[], envExtra={}, allowExitCodes=[0]) {
  log(`\n▶ ${name}`);
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...envExtra },
    timeout: 10 * 60 * 1000,
  });
  const code = (res.status ?? 0);
  if (allowExitCodes.includes(code)) { ok(`${name} PASS (exit ${code})`); return true; }
  bad(`${name} FAIL (exit ${code})`);
  return false;
}

(async function main(){
  let pass = true;

  // 1) 基础准备：CSV 表头 + 演示证据
  const fpDomains   = path.join(ROOT,'data','domains.csv');
  const fpLeads     = path.join(ROOT,'data','leads.csv');
  const fpIntakes   = path.join(ROOT,'data','intakes.csv');
  const fpCustomers = path.join(ROOT,'data','customers.csv');

  if (!exists(fpDomains)) {
    write(fpDomains, `domain,company\nstripe.com,Stripe\ndatadoghq.com,Datadog\natlassian.com,Atlassian\n`);
    ok('init data/domains.csv');
  }
  if (!exists(fpLeads)) {
    write(fpLeads, `email,company,domain,status,seq,last_touch\n`);
    ok('init data/leads.csv');
  }
  if (!exists(fpIntakes)) {
    write(fpIntakes, `email,company,plan,vendors,created_at\n`);
    ok('init data/intakes.csv');
  }
  if (!exists(fpCustomers)) {
    write(fpCustomers, `email,company,plan,vendors,support,created_at\n`);
    ok('init data/customers.csv');
  }

  // 演示证据（用于 /updates /vendors 构建）
  const evidDir = path.join(ROOT,'evidence','datadog');
  ensureDir(evidDir);
  write(path.join(evidDir, `2025-10-05.json`), JSON.stringify([{
    url: "https://www.datadoghq.com/legal/terms/",
    snippet: "Updated Section 5.2 on data retention (Oct 5, 2025).",
    timestamp: "2025-10-05T09:00:00Z"
  }], null, 2));
  ok('demo evidence ready');

  // 2) 发现 → leads.csv（允许 exit 0/2 视为通过）
  pass &= runStep('Discover Public Contacts', 'node', ['scripts/discover_contacts.js'], {}, [0,2]);
  const leadsLines = lineCount(fpLeads);
  if (leadsLines <= 1) { bad('leads.csv still empty after discover'); pass=false; }
  else ok(`leads.csv lines=${leadsLines}`);

  // 3) 发信（DRY，不真实发送）
  // 要求你的 send_bulk.js 已支持 DRY_RUN=1（已给过补丁）
  pass &= runStep('Outreach S1 (DRY)', 'node', ['scripts/send_bulk.js'], { DRY_RUN: '1' });

  // 4) 模拟入站 → promote-intakes
  const nowISO = new Date().toISOString();
  // 写一条 Business 客户 + 三个 vendors
  fs.appendFileSync(fpIntakes, `demo@buyer.com,Demo Corp,Business,"datadog,stripe,atlassian",${nowISO}\n`);
  pass &= runStep('Promote Intakes', 'node', ['scripts/promote_intakes.js']);

  // 5) 构建产物：vendors / updates / categories(如有) / customer feeds(如有)
  pass &= runStep('Vendor Catalog Build', 'node', ['scripts/build_vendor_catalog.js'], { SITE_ORIGIN: SITE });
  pass &= runStep('Updates Build',       'node', ['scripts/build_updates.js'],       { SITE_ORIGIN: SITE });

  if (exists(path.join(ROOT,'scripts','build_categories.js'))) {
    pass &= runStep('Categories Build', 'node', ['scripts/build_categories.js'], { SITE_ORIGIN: SITE });
  } else {
    log('ℹ skip categories (no scripts/build_categories.js)');
  }

  if (read(fpCustomers).toLowerCase().includes('enterprise')) {
    pass &= runStep('Customer Feeds', 'node', ['scripts/build_customer_feeds.js'], { SITE_ORIGIN: SITE });
  } else {
    log('ℹ no enterprise customer yet → skip customer feeds');
  }

  // 6) 增购提醒 / 规模观测（有则跑，无则跳过；不触达外部）
  if (exists(path.join(ROOT,'scripts','upsell_capacity.js'))) {
    pass &= runStep('Upsell Capacity', 'node', ['scripts/upsell_capacity.js']);
  } else {
    log('ℹ skip upsell (no scripts/upsell_capacity.js)');
  }
  if (exists(path.join(ROOT,'scripts','scale_watch.js'))) {
    pass &= runStep('Scale Watch', 'node', ['scripts/scale_watch.js']);
  } else {
    log('ℹ skip scale watch (no scripts/scale_watch.js)');
  }

  // 7) 文件断言（核心产物是否生成）
  const mustFiles = [
    path.join(ROOT,'vendors','index.html'),
    path.join(ROOT,'updates','index.html'),
    path.join(ROOT,'updates','rss.xml'),
    path.join(ROOT,'api','vendors.json'),
    path.join(ROOT,'sitemap-vendors.xml'),
  ];
  let allOK = true;
  for (const fp of mustFiles){
    if (!exists(fp)) { bad(`missing: ${path.relative(ROOT,fp)}`); allOK=false; }
    else ok(`exists: ${path.relative(ROOT,fp)}`);
  }
  pass &= allOK;

  // 8) 汇总
  console.log('\n====================');
  if (pass) {
    ok('SELF TEST PASSED — 产物与链路均正常（DRY 模式）');
    console.log('下一步：推到 main 触发 Pages 构建，或运行 self_test_http.js 做线上 200 校验');
    process.exit(0);
  } else {
    bad('SELF TEST FAILED — 按上面的 ❌ 项逐个排查（脚本缺失/路径错误/脚本异常）');
    process.exit(1);
  }
})();
