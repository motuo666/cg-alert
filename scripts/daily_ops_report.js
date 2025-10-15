#!/usr/bin/env node
/**
 * 生成每日可视化报告：/reports/ops/<YYYY-MM-DD>/index.html + /reports/ops/index.html
 * 仅用仓库内可得指标（发送打开/点击请在SMTP后台看）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUTBASE = path.join(ROOT, 'reports', 'ops');
const ART = path.join(ROOT, 'artifacts', 'daily_ops.json');

function readJSON(fp){ try{ return JSON.parse(fs.readFileSync(fp,'utf8')); }catch{ return null; } }

function renderPage(data){
  const { date, kpi } = data;
  const bar = (v,max,label)=> {
    const pct = Math.max(0, Math.min(100, Math.round(100 * (max? v/max : 0))));
    return `<div style="margin:6px 0">${label}: <b>${v}</b> / ${max||'-'}<div style="height:8px;background:#eee;border-radius:6px"><div style="width:${pct}%;height:8px;background:#222;border-radius:6px"></div></div></div>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Daily Ops - ${date}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,Arial;padding:24px;max-width:900px;margin:auto;line-height:1.6}
.card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:8px 0;box-shadow:0 1px 2px rgba(0,0,0,.03)}
h1{margin:0 0 8px} .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.badge{display:inline-block;background:#f3f4f6;border-radius:999px;padding:4px 10px;margin-right:8px}
.kv{display:flex;justify-content:space-between;border-bottom:1px dashed #eee;padding:6px 0}
small{color:#6b7280}</style></head>
<body>
<h1>Daily Ops — ${date}</h1>
<div class="card grid">
  <div>
    <div class="badge">Evidence today: <b>${kpi.evidence_today||0}</b></div>
    <div class="badge">Packs this month: <b>${kpi.packs_month||0}</b></div>
    <div class="badge">Changed vendors (72h): <b>${kpi.changed_vendors_72h||0}</b></div>
    <div class="badge">Sent today: <b>${kpi.sent_today||0}</b></div>
  </div>
  <div>
    ${bar(kpi.evidence_today||0, 10, 'Evidence vs target(10)')}
    ${bar(kpi.sent_today||0, 16, 'Sent vs target(16)')}
    <div class="kv"><div>Hash coverage</div><div><b>${((kpi.hash_ratio||0)*100).toFixed(1)}%</b></div></div>
  </div>
</div>

<div class="card">
  <h3>What to do next</h3>
  <ul>
    <li>若 <b>Evidence today</b> = 0：手动跑 Public Change Poller；仍 0 → 明天扩大窗口</li>
    <li>若 <b>Sent today</b> &lt; 8：Outreach Triggered 再跑一次，<code>window_h=168</code></li>
    <li>日终在 SMTP 后台看 Open/Click；退订≤0.5%，投诉≤0.1%</li>
  </ul>
  <p><small>Open/Click/Unsub/Spam 由 SMTP 控制台提供，本页不展示。</small></p>
</div>

<div class="card">
  <h3>Details</h3>
  <div class="kv"><div>Evidence total</div><div>${kpi.evidence_total||0}</div></div>
  <div class="kv"><div>Dry today</div><div>${kpi.dry_today||0}</div></div>
</div>

</body></html>`;
}

(function main(){
  const data = readJSON(ART);
  if(!data){ console.error('missing artifacts/daily_ops.json, run fullchain_check first'); process.exit(1); }
  const dir = path.join(OUTBASE, data.date);
  fs.mkdirSync(dir, { recursive:true });
  fs.writeFileSync(path.join(dir,'index.html'), renderPage(data), 'utf8');

  // 更新索引页（最近10天）
  const days = fs.readdirSync(OUTBASE, { withFileTypes:true })
    .filter(d=>d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map(d=>d.name).sort().slice(-10).reverse();

  const links = days.map(d=>`<li><a href="./${d}/">${d}</a></li>`).join('');
  const idx = `<!doctype html><html><head><meta charset="utf-8"><title>Daily Ops</title>
<style>body{font-family:system-ui,Arial;padding:24px;max-width:700px;margin:auto} li{margin:6px 0}</style></head>
<body><h1>Daily Ops</h1><ol>${links}</ol></body></html>`;
  fs.writeFileSync(path.join(OUTBASE,'index.html'), idx, 'utf8');

  console.log(`daily ops report -> reports/ops/${data.date}/index.html`);
})();
