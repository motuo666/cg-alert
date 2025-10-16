#!/usr/bin/env node
/**
 * build_ttd_report.js
 * 计算 Time-to-Detect (TTD) 分布（P50/P95），并生成：
 * - reports/ops/ttd.json
 * - reports/ops/ttd.html
 *
 * 取值策略（尽量稳健）：
 * - observed_at：优先 evidence JSON 的 observed_at/fetched_at；否则用文件路径中的 YYYY-MM-DD（等价0时延）
 * - source_date：优先 evidence JSON 的 effective_date/source_last_modified/date；若无，跳过该样本
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVD = path.join(ROOT, 'evidence');
const OUTDIR = path.join(ROOT, 'reports', 'ops');

function walkJSON(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJSON(p, acc);
    else if (ent.isFile() && ent.name.endsWith('.json')) acc.push(p);
  }
  return acc;
}

function parseISO(s){
  if (!s) return null;
  const d = new Date(s);
  return isNaN(+d) ? null : d;
}

function findDateInPath(fp){
  const m = fp.match(/(\d{4}-\d{2}-\d{2})-/);
  if (!m) return null;
  return new Date(m[1] + 'T00:00:00Z');
}

function percentile(arr, p){
  if (!arr.length) return 0;
  const idx = Math.min(arr.length - 1, Math.max(0, Math.floor((p/100) * arr.length)));
  return arr[idx];
}

function run(){
  const files = walkJSON(EVD);
  const hours = [];

  for (const fp of files){
    try{
      const j = JSON.parse(fs.readFileSync(fp, 'utf8'));

      // 源日期（页面声称的“生效/最后修改”）
      const source = parseISO(j.effective_date) || parseISO(j.source_last_modified) || parseISO(j.date);
      if (!source) continue;

      // 观测时间（我们抓到/记录的时间）
      const observed = parseISO(j.observed_at) || parseISO(j.fetched_at) || findDateInPath(fp) || null;
      if (!observed) continue;

      const deltaH = Math.max(0, (observed - source) / 3600000);
      hours.push(deltaH);
    }catch(e){}
  }

  hours.sort((a,b)=>a-b);
  const p50 = percentile(hours, 50);
  const p95 = percentile(hours, 95);
  const summary = {
    samples: hours.length,
    p50_hours: Math.round(p50*10)/10,
    p95_hours: Math.round(p95*10)/10,
    generated_at: new Date().toISOString()
  };

  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.writeFileSync(path.join(OUTDIR, 'ttd.json'), JSON.stringify(summary, null, 2));

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Time to Detect (TTD)</title>
<style>body{font-family:system-ui,Arial;padding:24px;max-width:800px;margin:auto;line-height:1.6}
.card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:8px 0}
.badge{display:inline-block;background:#f3f4f6;border-radius:999px;padding:4px 10px;margin-right:8px}</style></head>
<body>
<h1>Time to Detect (TTD)</h1>
<div class="card">
  <div class="badge">Samples: <b>${summary.samples}</b></div>
  <div class="badge">P50: <b>${summary.p50_hours}h</b></div>
  <div class="badge">P95: <b>${summary.p95_hours}h</b></div>
  <p><small>Definition — P50/P95 hours between a source page's effective/last-modified date and our observed timestamp.</small></p>
</div>
</body></html>`;
  fs.writeFileSync(path.join(OUTDIR, 'ttd.html'), html, 'utf8');

  console.log(`TTD report: samples=${summary.samples}, P50=${summary.p50_hours}h, P95=${summary.p95_hours}h`);
}

run();
