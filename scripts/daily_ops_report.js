#!/usr/bin/env node
/**
 * Daily Ops Report
 * - 读取 artifacts/daily_ops.json 生成 /reports/ops/<YYYY-MM-DD>/index.html
 * - 若 artifacts 缺失，做轻量兜底计算（evidence_today/sent_today/hash_ratio）
 * - 避免在模板字符串中嵌套反引号，全部标签用普通引号
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'artifacts', 'daily_ops.json');
const EVID_NDX = path.join(ROOT, 'data', 'evidence.ndx');
const OUTREACH = path.join(ROOT, 'data', 'outreach_log.csv');

const TARGET_EVIDENCE = Number(process.env.TARGET_EVID_TODAY || 10);
const TARGET_SENT = Number(process.env.TARGET_SENT || 8);

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }
function todayStrUTC(){
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const day = String(d.getUTCDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function readJSON(fp){ try{ return JSON.parse(fs.readFileSync(fp,'utf8')); }catch{ return null; } }
function readLines(fp){ if(!fs.existsSync(fp)) return []; return fs.readFileSync(fp,'utf8').split(/\r?\n/); }
function isRealHash(h){ return !!h && !/^0+$/.test(h); }

function fallbackKPI(){
  // evidence_today / hash_ratio
  let evidence_today = 0, hash_ok = 0, total = 0;
  const today = todayStrUTC();
  if (fs.existsSync(EVID_NDX)){
    const L = readLines(EVID_NDX);
    for (const ln of L){
      if(!ln.trim()) continue;
      const parts = ln.split('\t'); // [when, domain, type, hash, ...]（按你的现有格式）
      const when = (parts[0]||'').slice(0,10);
      const hash = parts[3] || '';
      if (when === today){
        evidence_today++;
        if (isRealHash(hash)) hash_ok++;
      }
      if (parts[0]) total++;
    }
  }
  const hash_ratio = total>0 ? (hash_ok/Math.max(1,total)) : 0;

  // sent_today
  let sent_today = 0;
  if (fs.existsSync(OUTREACH)){
    const lines = readLines(OUTREACH);
    const header = lines[0] && /when|status/i.test(lines[0]) ? lines[0].split(',') : [];
    const start = header.length ? 1 : 0;
    // 猜测列：when(0), status(8)；若有表头则做一次匹配
    let idxWhen = 0, idxStatus = 8;
    if (header.length){
      const lower = header.map(h => h.toLowerCase());
      idxWhen = Math.max(0, lower.findIndex(h => h.includes('when')));
      const iStat = lower.findIndex(h => h.includes('status'));
      if (iStat >= 0) idxStatus = iStat;
    }
    for (let i=start; i<lines.length; i++){
      const row = lines[i]; if(!row || !row.trim()) continue;
      const cols = row.split(',');
      const w = (cols[idxWhen]||'');
      const st = (cols[idxStatus]||'').toLowerCase();
      if (w.slice(0,10)===today && st==='sent') sent_today++;
    }
  }

  return {
    date: today,
    kpi: {
      evidence_today,
      sent_today,
      hash_ratio,
      ttd_p50_hours: null,
      ttd_p95_hours: null,
      ttd_samples: 0
    },
    WARN: [],
    FAIL: []
  };
}

function bar(current, target, label){
  const cur = Number(current||0);
  const tgt = Math.max(1, Number(target||0));
  const pct = Math.max(0, Math.min(100, Math.round(cur/tgt*100)));
  return `
<div class="kpi">
  <div class="kpi-head">${label}: <strong>${cur}</strong> / ${tgt}</div>
  <div class="kpi-outer"><div class="kpi-inner" style="width:${pct}%"></div></div>
</div>`;
}

function pill(text, tone){ return `<span class="pill ${tone||''}">${text}</span>`; }

function main(){
  const data = readJSON(ART) || fallbackKPI();
  const kpi = data.kpi || {};
  const date = data.date || todayStrUTC();

  const hashPct = ((kpi.hash_ratio||0)*100).toFixed(1) + '%';
  const ttdP50 = (kpi.ttd_p50_hours==null) ? '—' : `${Number(kpi.ttd_p50_hours).toFixed(1)}h`;
  const ttdP95 = (kpi.ttd_p95_hours==null) ? '—' : `${Number(kpi.ttd_p95_hours).toFixed(1)}h`;
  const ttdSamples = kpi.ttd_samples||0;

  const html = `<!doctype html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Daily Ops - ${date}</title>
<style>
body{font-family:system-ui,Arial,sans-serif;margin:24px;line-height:1.6;color:#111827;max-width:960px}
h1{font-size:22px;margin:0 0 12px}
.kpis{display:grid;grid-template-columns:1fr;gap:16px}
.kpi-head{font-size:14px;margin-bottom:6px}
.kpi-outer{height:10px;background:#e5e7eb;border-radius:999px;overflow:hidden}
.kpi-inner{height:10px;background:#2563eb}
.meta{margin-top:16px;font-size:14px;color:#374151}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#F3F4F6;border:1px solid #E5E7EB;margin-right:6px}
.pill.good{background:#ECFDF5;border-color:#10B981;color:#065F46}
.pill.warn{background:#FEF3C7;border-color:#F59E0B;color:#92400E}
.pill.bad{background:#FEE2E2;border-color:#EF4444;color:#991B1B}
.small{font-size:12px;color:#6B7280}
.section{margin-top:20px}
</style>
</head>
<body>
<h1>Daily Ops — ${date}</h1>

<div class="kpis">
  ${bar(kpi.evidence_today||0, ${TARGET_EVIDENCE}, 'Evidence vs target (${TARGET_EVIDENCE})')}
  ${bar(kpi.sent_today||0, ${TARGET_SENT}, 'Sent vs target (${TARGET_SENT})')}
</div>

<div class="section meta">
  ${pill('Hash coverage: '+hashPct, (kpi.hash_ratio>=0.4?'good':(kpi.hash_ratio>=0.2?'warn':'bad')))}
  ${pill('TTD P50: '+ttdP50, (kpi.ttd_p50_hours!=null && kpi.ttd_p50_hours<=12?'good':'warn'))}
  ${pill('TTD P95: '+ttdP95, (kpi.ttd_p95_hours!=null && kpi.ttd_p95_hours<=24?'good':'bad'))}
  ${pill('TTD samples: '+ttdSamples, (ttdSamples>=10?'good':'warn'))}
</div>

<div class="section small">
  <div>Notes: Evidence/ Sent 目标来自环境变量 TARGET_EVID_TODAY(${TARGET_EVIDENCE}) / TARGET_SENT(${TARGET_SENT})；若 artifacts 缺失，本页使用兜底估算。</div>
</div>

</body></html>`;

  const outDir = path.join(ROOT, 'reports', 'ops', date);
  ensureDir(outDir);
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');

  // Step summary（便于在 Actions 里一眼看到）
  const sum = [];
  sum.push('### Daily Ops');
  sum.push(`- date: **${date}**`);
  sum.push(`- evidence_today: **${kpi.evidence_today||0}** / target ${TARGET_EVIDENCE}`);
  sum.push(`- sent_today: **${kpi.sent_today||0}** / target ${TARGET_SENT}`);
  sum.push(`- hash_coverage: **${hashPct}**`);
  sum.push(`- TTD: P50 **${ttdP50}**, P95 **${ttdP95}**, samples **${ttdSamples}**`);
  if (process.env.GITHUB_STEP_SUMMARY){
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, sum.join('\n')+'\n', 'utf8');
  }
  console.log(sum.join('\n'));
}

main();
