#!/usr/bin/env node
/**
 * CG Alert 全流程自检（仓库本地/Actions均可运行）
 * 检查项：domains/endpoints/evidence索引/Pack/链接格式/抑制/发送回写/基线比例/CTA可见性/TTD(P50/P95)
 * 输出：STDOUT 人类可读 && GitHub Step Summary（若存在）
 * 退出码：有 FAIL => 1；否则 0
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const D = p => path.join(ROOT, 'data', p);
const R = p => path.join(ROOT, p);

const ISODate = new Date();
const today = ISODate.toISOString().slice(0,10);       // YYYY-MM-DD
const YM = ISODate.toISOString().slice(0,7);           // YYYY-MM
const TTD_LOOKBACK_HOURS = +(process.env.TTD_LOOKBACK_HOURS || 72); // 近窗用于统计 TTD

function readLines(fp){ return fs.existsSync(fp)?fs.readFileSync(fp,'utf8').split(/\r?\n/).filter(Boolean):[]; }
function csvRows(fp){ return readLines(fp).map(l=>l.split(',')); }
function uniq(a){ return Array.from(new Set(a)); }
function push(arr, item){ arr.push(item); }

function writeSummary(md){
  const sum = process.env.GITHUB_STEP_SUMMARY;
  if (sum) fs.appendFileSync(sum, md + '\n', 'utf8');
}

function exists(p){ return fs.existsSync(p); }
function walk(dir, pred, acc=[]){
  if (!exists(dir)) return acc;
  for (const d of fs.readdirSync(dir, { withFileTypes:true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, pred, acc);
    else if (!pred || pred(d.name)) acc.push(p);
  }
  return acc;
}

function isHashOK(h){
  if (!h) return false;
  const s = String(h).trim();
  if (!s) return false;
  return !/^0+$/i.test(s);
}

function quantile(arr, q){
  if (!arr.length) return 0;
  const a = arr.slice().sort((x,y)=>x-y);
  const pos = (a.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (a[base+1] !== undefined) return a[base] + rest * (a[base+1] - a[base]);
  return a[base];
}

/**
 * 从 evidence.ndx 计算近窗口的 TTD(P50/P95)
 * 约定 evidence.ndx 的列至少含：
 *   [0]=YYYY-MM-DD, [1]=vendor, [2]=type(可空), [3]=hash(可空)
 * 计算方式：按 (vendor + type) 分组，按时间升序，取相邻两次抓取间隔（小时）作为样本；
 * 仅统计 hash 有效（非基线）的记录；只取“区间结束点在近 TTD_LOOKBACK_HOURS 内”的样本。
 */
function computeTTDFromNdx(ndx, lookbackHours){
  try{
    const now = Date.now();
    const endWindowTs = now;
    const startWindowTs = now - lookbackHours*3600*1000;

    // 过滤出 hash 有效的记录并带上时间戳
    const rows = ndx.map(r=>{
      const d = r[0]||'';
      const ts = Date.parse(d+'T00:00:00Z'); // 日粒度，小时按 24h 估算
      return { ts, vendor: r[1]||'', type: r[2]||'', hash: r[3]||'' };
    }).filter(r => !isNaN(r.ts) && isHashOK(r.hash) && r.vendor);

    // 分组：vendor + type（type 可能为空）
    const groups = new Map();
    for (const r of rows){
      const key = `${r.vendor}||${r.type||''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }

    // 逐组计算相邻样本（以“后一条记录时间”作为样本时间，过滤在窗口内）
    const samples = [];
    for (const list of groups.values()){
      list.sort((a,b)=>a.ts-b.ts);
      for (let i=1;i<list.length;i++){
        const prev = list[i-1], cur = list[i];
        const sampleTs = cur.ts;
        if (sampleTs >= startWindowTs && sampleTs <= endWindowTs){
          const deltaH = (cur.ts - prev.ts) / (3600*1000);
          // 排除异常极大间隔（比如历史导入），留个上限 30 天
          if (deltaH > 0 && deltaH <= 24*30) samples.push(deltaH);
        }
      }
    }

    const n = samples.length;
    const p50 = quantile(samples, 0.5);
    const p95 = quantile(samples, 0.95);
    return { samples: n, p50_hours: p50, p95_hours: p95 };
  }catch(e){
    return { samples: 0, p50_hours: 0, p95_hours: 0 };
  }
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
  const hashOKCount = ndx.filter(r => isHashOK(r[3])).length;
  kpi.evidence_total = ndx.length;
  kpi.evidence_today = ndxToday.length;
  kpi.changed_vendors_72h = vendors72.length;
  kpi.hash_ratio = ndx.length? (hashOKCount/ndx.length):0;

  if (ndx.length && kpi.evidence_today===0) push(WARN, '今天暂无新证据（evidence_today=0）');
  if (ndx.length && kpi.hash_ratio<0.25) push(WARN, `可核证度较低（hash 有效比例 ${(kpi.hash_ratio*100).toFixed(1)}%）`);

  // 2.1) 计算 TTD（P50/P95）
  const ttd = computeTTDFromNdx(ndx, TTD_LOOKBACK_HOURS);
  kpi.ttd_samples = ttd.samples;
  kpi.ttd_p50_hours = ttd.p50_hours || 0;
  kpi.ttd_p95_hours = ttd.p95_hours || 0;
  if (!ttd.samples) {
    WARN.push(`TTD 样本不足（近 ${TTD_LOOKBACK_HOURS}h 无有效样本）`);
  }

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

  // 汇总输出（控制台）
  const lines = [];
  lines.push(`KPI: evidence_total=${kpi.evidence_total||0}, evidence_today=${kpi.evidence_today||0}, packs_month=${kpi.packs_month||0}, changed_vendors_72h=${kpi.changed_vendors_72h||0}`);
  lines.push(`KPI: sent_today=${kpi.sent_today||0}, dry_today=${kpi.dry_today||0}, hash_ratio=${(kpi.hash_ratio*100||0).toFixed(1)}%`);
  lines.push(`KPI: ttd_samples=${kpi.ttd_samples||0}, ttd_p50=${(kpi.ttd_p50_hours||0).toFixed(1)}h, ttd_p95=${(kpi.ttd_p95_hours||0).toFixed(1)}h (lookback=${TTD_LOOKBACK_HOURS}h)`);
  console.log(lines.join('\n'));

  // Step Summary（Markdown）
  function renderList(title, arr, icon){ if(!arr.length) return ''; return `\n**${icon} ${title} (${arr.length})**\n`+arr.map(s=>`- ${s}`).join('\n')+'\n'; }
  const md = [
    '### Fullchain Check Summary',
    `- Date: ${today}`,
    `- Evidence today: **${kpi.evidence_today||0}**`,
    `- Packs this month: **${kpi.packs_month||0}**`,
    `- Changed vendors (72h): **${kpi.changed_vendors_72h||0}**`,
    `- Sent today: **${kpi.sent_today||0}**`,
    `- Hash coverage: **${(kpi.hash_ratio*100||0).toFixed(1)}%**`,
    `- TTD: **P50 ${(kpi.ttd_p50_hours||0).toFixed(1)}h • P95 ${(kpi.ttd_p95_hours||0).toFixed(1)}h** (samples=${kpi.ttd_samples||0}, lookback=${TTD_LOOKBACK_HOURS}h)`,
    renderList('PASS', PASS, '✅'),
    renderList('WARN', WARN, '⚠️'),
    renderList('FAIL', FAIL, '❌')
  ].join('\n');
  writeSummary(md);

  // 导出 JSON（供可视化/自动验收使用）
  const outDir = R('artifacts'); fs.mkdirSync(outDir,{recursive:true});
  fs.writeFileSync(
    path.join(outDir, 'daily_ops.json'),
    JSON.stringify({date:today, YM, kpi, PASS, WARN, FAIL}, null, 2),
    'utf8'
  );

  process.exit(FAIL.length?1:0);
}

check();
