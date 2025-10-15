#!/usr/bin/env node
/**
 * CG Alert 全流程自检（仓库本地/Actions均可运行）
 * 检查项：domains/endpoints/evidence索引/Pack/链接格式/抑制/发送回写/基线比例/CTA可见性
 * 输出：STDOUT 人类可读 && GitHub Step Summary（若存在）
 * 退出码：有 FAIL => 1；否则 0
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const D = p => path.join(ROOT, 'data', p);
const R = p => path.join(ROOT, p);

const today = new Date().toISOString().slice(0,10);
const YM = new Date().toISOString().slice(0,7);

function readLines(fp){ return fs.existsSync(fp)?fs.readFileSync(fp,'utf8').split(/\r?\n/).filter(Boolean):[]; }
function csvRows(fp){ return readLines(fp).map(l=>l.split(',')); }
function uniq(a){ return Array.from(new Set(a)); }
function push(arr, item){ arr.push(item); }

function writeSummary(md){
  const sum = process.env.GITHUB_STEP_SUMMARY;
  if (sum) fs.appendFileSync(sum, md + '\n', 'utf8');
}

function exists(p){ return fs.existsSync(p); }
function countFiles(dir, pred){
  if (!exists(dir)) return 0;
  let n=0;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isFile() && (!pred || pred(name))) n++;
  }
  return n;
}
function walk(dir, pred, acc=[]){
  if (!exists(dir)) return acc;
  for (const d of fs.readdirSync(dir, { withFileTypes:true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, pred, acc);
    else if (!pred || pred(d.name)) acc.push(p);
  }
  return acc;
}

function check(){
  const PASS=[], WARN=[], FAIL=[];
  const kpi = {};

  // 1) 目标域/端点
  if (!exists(D('domains.csv'))) push(FAIL, '缺少 data/domains.csv');
  const endpoints = readLines(D('endpoints.csv'));
  if (!endpoints.length) push(WARN, 'data/endpoints.csv 为空或缺失（下次跑 Endpoint Inventory 生成）');
  kpi.endpoints = endpoints.length;

  // 2) 证据索引
  const ndx = readLines(D('evidence.ndx')).map(l=>l.split('\t'));
  if (!ndx.length) push(WARN, 'data/evidence.ndx 为空：先跑 Public Change Poller');
  const ndxToday = ndx.filter(r => (r[0]||'').startsWith(today));
  const ndx72 = ndx.filter(r => {
    const d = r[0];
    if(!d) return false;
    const ts = Date.parse(d+'T00:00:00Z');
    return !isNaN(ts) && (Date.now()-ts)<=72*3600*1000;
  });
  const vendors72 = uniq(ndx72.map(r=>r[1]).filter(Boolean));
  const hashOK = ndx.filter(r => r[3] && !/^0+$/i.test(String(r[3]))).length;
  const baseline = ndx.length - hashOK;
  kpi.evidence_total = ndx.length;
  kpi.evidence_today = ndxToday.length;
  kpi.changed_vendors_72h = vendors72.length;
  kpi.hash_ratio = ndx.length? (hashOK/ndx.length):0;

  if (ndx.length && kpi.evidence_today===0) push(WARN, '今天暂无新证据（evidence_today=0）');
  if (ndx.length && kpi.hash_ratio<0.25) push(WARN, `可核证度较低（hash 有效比例 ${(kpi.hash_ratio*100).toFixed(1)}%）`);

  // 3) Packs
  const packDir = R(`reports/${YM}`);
  const packs = walk(packDir, n=>n==='index.html').filter(p=>/reports\/\d{4}-\d{2}\/[^/]+\/index\.html$/.test(p));
  kpi.packs_month = packs.length;
  if (!exists(R('updates/rss.xml'))) push(WARN, '缺少 updates/rss.xml（SEO 注入与 RSS 可能未生成）');

  // 4) 外呼日志 & 链接正确性
  const out = csvRows(D('outreach_log.csv'));
  if (!out.length){ push(WARN, 'data/outreach_log.csv 不存在或为空（尚未触发外呼）'); }
  const header = out[0] && out[0][0]==='when';
  const rows = header? out.slice(1): out;
  const outToday = rows.filter(r => (r[0]||'').startsWith(today));
  const sentToday = outToday.filter(r => (r[8]||'').trim()==='sent');
  const dryToday  = outToday.filter(r => (r[8]||'').trim()==='dry');
  kpi.sent_today = sentToday.length;
  kpi.dry_today  = dryToday.length;

  // 链接校验（?/& 与 utm）
  function linkOK(url){
    if (!url) return false;
    if (!/utm_source=email/.test(url)) return false;
    if (/updates\/\?q=.+\?utm_/.test(url)) return false; // 错误：?q=... 后又接 ?utm_
    return true;
  }
  const badLinks = outToday.filter(r => !linkOK(r[6]||''));
  if (badLinks.length) push(FAIL, `外呼链接 UTM 拼接异常 ${badLinks.length} 条（?q=…?utm_）`);

  // 5) 发送回写 leads.csv
  const leads = csvRows(D('leads.csv'));
  const leadsByEmail = new Map(leads.map(cols => [cols[0], cols]));
  const sample = sentToday.slice(0,10);
  const wrong = sample.filter(r => { const e=r[1]; const row=leadsByEmail.get(e); return !(row && row[7]==='sent'); });
  if (sample.length && wrong.length) push(FAIL, `发送回写校验失败：leads.csv 有 ${wrong.length}/${sample.length} 未标 sent`);

  // 6) 抑制：unsubs/bounces 不应保留为 new
  const unsubs = new Set((csvRows(D('unsubscribes.csv'))||[]).slice(1).map(r=>r[0]).filter(Boolean));
  const bounces = new Set((csvRows(D('bounces.csv'))||[]).slice(1).map(r=>r[1]||r[0]).filter(Boolean));
  let suppressBad=0;
  for (const email of [...unsubs, ...bounces]){
    const row = leadsByEmail.get(email);
    if (row && row[7]==='new') suppressBad++;
  }
  if (suppressBad>0) push(FAIL, `抑制未生效：有 ${suppressBad} 个退订/退信邮箱仍为 status=new`);

  // 7) CTA 可见性（抽查一个 pack）
  let ctaOK = false;
  for (const p of packs.slice(0,3)){
    const html = fs.readFileSync(p,'utf8');
    if (/Enable alerts|Buy Portfolio|\bHome\b/.test(html)) { ctaOK = true; break; }
  }
  if (!ctaOK) push(WARN, 'Pack 页面未见 CTA（Home/Enable/Buy），如未配置表单/支付可忽略');

  // 8) 目标阈值（可通过环境变量调整）
  const TARGET_SENT = +(process.env.TARGET_SENT || 8);
  const TARGET_EVID_TODAY = +(process.env.TARGET_EVID_TODAY || 10);
  if (kpi.sent_today < TARGET_SENT) push(WARN, `今日发送量低于目标 ${kpi.sent_today}/${TARGET_SENT}`);
  if (kpi.evidence_today < TARGET_EVID_TODAY) push(WARN, `今日新证据低于目标 ${kpi.evidence_today}/${TARGET_EVID_TODAY}`);

  // 汇总输出
  const lines = [];
  lines.push(`KPI: evidence_total=${kpi.evidence_total||0}, evidence_today=${kpi.evidence_today||0}, packs_month=${kpi.packs_month||0}, changed_vendors_72h=${kpi.changed_vendors_72h||0}`);
  lines.push(`KPI: sent_today=${kpi.sent_today||0}, dry_today=${kpi.dry_today||0}, hash_ratio=${(kpi.hash_ratio*100||0).toFixed(1)}%`);
  console.log(lines.join('\n'));

  function renderList(title, arr, icon){ if(!arr.length) return ''; return `\n**${icon} ${title} (${arr.length})**\n`+arr.map(s=>`- ${s}`).join('\n')+'\n'; }
  const md = [
    '### Fullchain Check Summary',
    `- Date: ${today}`,
    `- Evidence today: **${kpi.evidence_today||0}**`,
    `- Packs this month: **${kpi.packs_month||0}**`,
    `- Changed vendors (72h): **${kpi.changed_vendors_72h||0}**`,
    `- Sent today: **${kpi.sent_today||0}**`,
    `- Hash coverage: **${(kpi.hash_ratio*100||0).toFixed(1)}%**`,
    renderList('PASS', PASS, '✅'),
    renderList('WARN', WARN, '⚠️'),
    renderList('FAIL', FAIL, '❌')
  ].join('\n');
  writeSummary(md);

  // 控制台也打印详情
  if (PASS.length) console.log('\nPASS:\n- ' + PASS.join('\n- '));
  if (WARN.length) console.warn('\nWARN:\n- ' + WARN.join('\n- '));
  if (FAIL.length) console.error('\nFAIL:\n- ' + FAIL.join('\n- '));

  // 导出 JSON（便于其他脚本可视化）
  const outDir = R('artifacts'); fs.mkdirSync(outDir,{recursive:true});
  fs.writeFileSync(path.join(outDir, 'daily_ops.json'), JSON.stringify({date:today, YM, kpi, PASS, WARN, FAIL}, null, 2));

  process.exit(FAIL.length?1:0);
}

check();
