#!/usr/bin/env node
/**
 * scripts/daily_ops_report.js  ——  CG Alert 日报 + 全链路体检（零依赖）
 * 汇总：今日 采集/发送/退信/退订/意向/成交/营收/交付（evidence） + 健康检查（站点可达、心跳文件、工作流近况）
 * 产物：reports/daily/YYYY-MM-DD.{json,md} 并可 Slack 通知；SLO 不达标或检查异常→ exit 1
 *
 * 环境变量（可选）：
 *   TZ=Asia/Shanghai                             # 时区，默认北京
 *   SITE_ORIGIN=https://www.cg-alert.com        # 站点
 *   SLACK_WEBHOOK=...                           # Slack 入站 webhook，如需推送
 *   EXPECT_DISCOVER_MIN=10                      # 今日采集目标
 *   EXPECT_SEND_MIN=40                          # 今日发送目标
 *   EXPECT_REVENUE_MIN=0                        # 今日营收目标（USD）
 *   EXPECT_DELIVERY_MIN=0                       # 今日交付目标（evidence 条数）
 *   ENABLE_*_SLO=1/0                            # 各 SLO 开关（DISCOVER/SEND/REVENUE/DELIVERY）
 *   GH_CHECK=1                                  # 开启 GitHub Workflows 近况检查（需 GITHUB_TOKEN）
 *   DAILY_CHECK_WORKFLOWS="Outreach S1 (Send),Inbound (poll inbox),E2E Full Chain,Weekly Health Check"
 */

const fs = require('fs');
const path = require('path');

process.env.TZ = process.env.TZ || 'Asia/Shanghai';
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK || process.env.SLACK_WEBHOOK_URL || '';
const GH_CHECK = String(process.env.GH_CHECK || '0') === '1';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const DAILY_CHECK_WORKFLOWS = (process.env.DAILY_CHECK_WORKFLOWS || 'Outreach S1 (Send),Inbound (poll inbox),E2E Full Chain,Weekly Health Check')
  .split(',').map(s=>s.trim()).filter(Boolean);

const EXPECT_DISCOVER_MIN = +process.env.EXPECT_DISCOVER_MIN || 10;
const EXPECT_SEND_MIN     = +process.env.EXPECT_SEND_MIN     || 40;
const EXPECT_REVENUE_MIN  = +process.env.EXPECT_REVENUE_MIN  || 0;
const EXPECT_DELIVERY_MIN = +process.env.EXPECT_DELIVERY_MIN || 0;

const ENABLE_DISCOVER_SLO = (process.env.ENABLE_DISCOVER_SLO || '1') !== '0';
const ENABLE_SEND_SLO     = (process.env.ENABLE_SEND_SLO     || '1') !== '0';
const ENABLE_REVENUE_SLO  = (process.env.ENABLE_REVENUE_SLO  || '1') !== '0';
const ENABLE_DELIVERY_SLO = (process.env.ENABLE_DELIVERY_SLO || '1') !== '0';

const ROOT = path.join(__dirname, '..');
const DATA = p => path.join(ROOT, 'data', p);
const REPORT_DIR = p => path.join(ROOT, 'reports', 'daily', p);
const EVIDENCE_DIR = p => path.join(ROOT, 'evidence', p);

// ---------- 基础小工具 ----------
function say(...a){ console.log(...a); }
async function postSlack(text){
  if (!SLACK_WEBHOOK) return;
  try {
    await fetch(SLACK_WEBHOOK, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ text }) });
  } catch {}
}
function ensureDir(p){ fs.mkdirSync(path.dirname(p), { recursive: true }); }
function startOfToday(){ const d=new Date(); d.setHours(0,0,0,0); return d; }
function endOfToday(){ const d=new Date(); d.setHours(23,59,59,999); return d; }
const T0 = startOfToday().getTime();
const T1 = endOfToday().getTime();
function isToday(ts){
  const t = Date.parse(ts || '');
  if (Number.isNaN(t)) return false;
  return t>=T0 && t<=T1;
}
function sum(arr){ return arr.reduce((a,b)=> a + (+b || 0), 0); }
function readText(fp){ try{ return fs.readFileSync(fp,'utf8'); } catch{ return ''; } }

// 纯净 CSV 读取（支持表头；不支持引号内逗号——我们默认数据无内嵌逗号）
function readCsv(fp){
  try{
    const raw = fs.readFileSync(fp,'utf8').trim();
    if (!raw) return { header:[], rows:[] };
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const header = lines.shift().split(',').map(s=>s.trim());
    const rows = lines.map(line=>{
      const cols = line.split(','); const o={};
      header.forEach((h,i)=> o[h]= (cols[i]||'').trim());
      return o;
    });
    return { header, rows };
  }catch{ return { header:[], rows:[] }; }
}

// ---------- 读取业务数据 ----------
const leads     = readCsv(DATA('leads.csv')).rows;
const bounces   = readCsv(DATA('bounces.csv')).rows;
const unsub     = readCsv(DATA('unsub.csv')).rows;
const intakes   = readCsv(DATA('intakes.csv')).rows;
const customers = readCsv(DATA('customers.csv')).rows;
let lastOutreachISO = readText(DATA('last_outreach.txt')).trim();
let lastPollISO     = readText(DATA('last_poll.txt')).trim(); // 需在 poll 工作流中写入；下面给 snippet

// 采集：优先用 leads.created_at；没有就记 0（建议在 discover_contacts.js 写 created_at）
const discoveredToday = leads.filter(r => isToday(r.created_at || r.createdAt)).length;

// 发送：基于 last_touch
const sentToday = leads.filter(r => isToday(r.last_touch || r.lastTouch)).length;

// 退信 / 退订
const bouncesToday = bounces.filter(r => isToday(r.ts || r.date || r.created_at)).length;
const unsubToday   = unsub.filter(r => isToday(r.ts || r.date || r.created_at)).length;

// 意向 / 成交 / 营收
const intakesToday = intakes.filter(r => isToday(r.created_at || r.date)).length;
const paidRows     = customers.filter(r => isToday(r.paid_at || r.date));
const customersToday = paidRows.length;
const revenueToday   = sum(paidRows.map(r => r.amount || r.value || 0));

// 交付（evidence）：统计 evidence/<vendor>/<YYYY-MM-DD>.json
function countEvidenceToday(){
  try {
    const ymd = new Date().toISOString().slice(0,10);
    if (!fs.existsSync(path.join(ROOT,'evidence'))) return 0;
    let n = 0;
    const vendors = fs.readdirSync(path.join(ROOT,'evidence'), { withFileTypes:true }).filter(d=>d.isDirectory());
    for (const v of vendors){
      const dir = path.join(ROOT,'evidence', v.name);
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f.startsWith(ymd));
      n += files.length;
    }
    return n;
  } catch { return 0; }
}
const deliveryToday = countEvidenceToday();

// 站点健康（轻量）
async function checkSite(){
  const pages = [
    ['/',                 [200], ['CG Alert','Pricing']],
    ['/updates/',         [200], ['Top Public Changes']],
    ['/updates/rss.xml',  [200], ['<rss','<channel>']],
    ['/vendors/',         [200], ['Vendors']],
    ['/categories/',      [200], ['Categories']],
  ];
  const fails=[];
  for (const [p, okCodes, must] of pages){
    try{
      const res = await fetch(SITE.replace(/\/$/,'') + p, { redirect:'follow' });
      const text = await res.text();
      const ok = okCodes.includes(res.status) && must.every(s => text.includes(s));
      if (!ok) fails.push(`${p} → ${res.status} / 内容校验失败`);
    }catch(e){
      fails.push(`${p} → 请求失败：${e.message||e}`);
    }
  }
  return fails;
}

// GitHub Workflows 近况（可选）
async function checkWorkflows(){
  if (!GH_CHECK || !GITHUB_TOKEN) return { ok: true, details: [] };
  try{
    const repo = process.env.GITHUB_REPOSITORY || ''; // e.g. owner/name
    if (!repo) return { ok:true, details:[] };
    const [owner, name] = repo.split('/');
    const headers = { 'authorization': `Bearer ${GITHUB_TOKEN}`, 'accept': 'application/vnd.github+json' };

    // 拉取最近 1 天所有 workflow runs（limit 100）
    const sinceISO = new Date(Date.now()-24*3600*1000).toISOString();
    const u = `https://api.github.com/repos/${owner}/${name}/actions/runs?per_page=100&created=>=${sinceISO}`;
    const r = await fetch(u, { headers });
    const j = await r.json();
    if (!j.workflow_runs) return { ok:true, details:[] };

    const details = [];
    for (const target of DAILY_CHECK_WORKFLOWS){
      const run = j.workflow_runs.find(w => (w.name||'').trim() === target);
      if (!run) { details.push(`❓ 未发现过去24h的工作流：${target}`); continue; }
      if (run.conclusion !== 'success') details.push(`❌ ${target} 最近一次结论=${run.conclusion||run.status}`);
      else details.push(`✅ ${target} OK`);
    }
    const ok = details.every(d => d.startsWith('✅'));
    return { ok, details };
  }catch(e){
    return { ok: false, details: [`GitHub API 检查失败：${e.message||e}`] };
  }
}

// 汇总 & 输出
(async function main(){
  const siteIssues = await checkSite();
  const wf = await checkWorkflows();

  // 构建报告对象
  const today = new Date().toISOString().slice(0,10);
  const report = {
    date: today,
    timezone: process.env.TZ,
    site: SITE,
    metrics: {
      discoveredToday,
      sentToday,
      bouncesToday,
      unsubToday,
      intakesToday,
      customersToday,
      revenueToday,
      deliveryToday,
      lastOutreachISO: lastOutreachISO || null,
      lastPollISO:     lastPollISO || null
    },
    checks: {
      site: { ok: siteIssues.length===0, issues: siteIssues },
      workflows: { ok: wf.ok, details: wf.details }
    },
    slo: {
      discover: ENABLE_DISCOVER_SLO ? { actual: discoveredToday, target: EXPECT_DISCOVER_MIN } : null,
      send:     ENABLE_SEND_SLO     ? { actual: sentToday,     target: EXPECT_SEND_MIN }     : null,
      revenue:  ENABLE_REVENUE_SLO  ? { actual: revenueToday,  target: EXPECT_REVENUE_MIN }  : null,
      delivery: ENABLE_DELIVERY_SLO ? { actual: deliveryToday, target: EXPECT_DELIVERY_MIN } : null
    }
  };

  // Markdown 摘要
  const md = [
    `# Daily Ops Report (${today} ${process.env.TZ})`,
    ``,
    `**Site**: ${SITE}`,
    `**Last Outreach**: ${lastOutreachISO || '—'} | **Last Poll**: ${lastPollISO || '—'}`,
    ``,
    `## Metrics (Today)`,
    `- Discovered: **${discoveredToday}**`,
    `- Sent: **${sentToday}**`,
    `- Bounces: ${bouncesToday} | Unsub: ${unsubToday}`,
    `- Intakes: ${intakesToday} | Customers: ${customersToday} | Revenue: **${revenueToday}**`,
    `- Delivery (evidence): **${deliveryToday}**`,
    ``,
    `## Checks`,
    siteIssues.length ? `- Site: ❌ ${siteIssues.join(' ; ')}` : `- Site: ✅ OK`,
    wf.details && wf.details.length ? `- Workflows:\n  - ${wf.details.join('\n  - ')}` : `- Workflows: (skip)`,
    ``,
    `## SLO`,
    ENABLE_DISCOVER_SLO ? `- Discover ≥ ${EXPECT_DISCOVER_MIN} → ${discoveredToday}` : `- Discover: (disabled)`,
    ENABLE_SEND_SLO     ? `- Send ≥ ${EXPECT_SEND_MIN} → ${sentToday}`               : `- Send: (disabled)`,
    ENABLE_REVENUE_SLO  ? `- Revenue ≥ ${EXPECT_REVENUE_MIN} → ${revenueToday}`       : `- Revenue: (disabled)`,
    ENABLE_DELIVERY_SLO ? `- Delivery ≥ ${EXPECT_DELIVERY_MIN} → ${deliveryToday}`     : `- Delivery: (disabled)`,
    ``
  ].join('\n');

  // Slack 文本
  const slack = [
    `📊 *Daily Ops* (${today} ${process.env.TZ})`,
    `• discovered: *${discoveredToday}*  | sent: *${sentToday}*`,
    `• bounces: ${bouncesToday} | unsub: ${unsubToday}`,
    `• intakes: ${intakesToday} | customers: ${customersToday} | revenue: *${revenueToday}*`,
    `• delivery: *${deliveryToday}*`,
    siteIssues.length ? `• site: FAIL (${siteIssues.join(' ; ')})` : `• site: OK`,
    wf.details && wf.details.length ? `• workflows:\n  - ${wf.details.join('\n  - ')}` : `• workflows: skip`,
  ].join('\n');

  // 输出文件
  const jsonPath = REPORT_DIR(`${today}.json`);
  const mdPath   = REPORT_DIR(`${today}.md`);
  ensureDir(jsonPath);
  fs.writeFileSync(jsonPath, JSON.stringify(report,null,2));
  fs.writeFileSync(mdPath, md);

  // 评估 SLO
  const fails = [];
  if (ENABLE_DISCOVER_SLO && discoveredToday < EXPECT_DISCOVER_MIN) fails.push(`Discover: ${discoveredToday} < ${EXPECT_DISCOVER_MIN}`);
  if (ENABLE_SEND_SLO     && sentToday     < EXPECT_SEND_MIN)       fails.push(`Send: ${sentToday} < ${EXPECT_SEND_MIN}`);
  if (ENABLE_REVENUE_SLO  && revenueToday  < EXPECT_REVENUE_MIN)    fails.push(`Revenue: ${revenueToday} < ${EXPECT_REVENUE_MIN}`);
  if (ENABLE_DELIVERY_SLO && deliveryToday < EXPECT_DELIVERY_MIN)   fails.push(`Delivery: ${deliveryToday} < ${EXPECT_DELIVERY_MIN}`);
  if (siteIssues.length) fails.push(`Site issues: ${siteIssues.join(' ; ')}`);
  if (wf.details && wf.details.find(d => d.startsWith('❌'))) fails.push('Workflow failure in last 24h');

  // Slack & 退出码
  await postSlack(slack + (fails.length ? `\n❌ *SLO/Checks* → ${fails.join(' ; ')}` : `\n✅ *SLO OK*`));
  console.log(md);

  process.exit(fails.length ? 1 : 0);
})();
