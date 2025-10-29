#!/usr/bin/env node
// 读 artifacts/daily_ops.json → 生成 updates/weekly.html（轻量版）
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

const ROOT = process.cwd();
const src = path.join(ROOT, 'artifacts', 'daily_ops.json');
const outDir = path.join(ROOT, 'updates');
const out = path.join(outDir, 'weekly.html');

let k = {};
try {
  const j = JSON.parse(fs.readFileSync(src, 'utf-8'));
  k = j.kpi || {};
} catch (_) {}

fs.mkdirSync(outDir, { recursive: true });
const now = dayjs();
const html = `<!doctype html><html><head>
<meta charset="utf-8"><title>Weekly Vendor Change Report</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="canonical" href="/updates/weekly.html">
</head><body>
<h1>Weekly Vendor Change Report</h1>
<p>Date: <b>${now.format('YYYY-MM-DD')}</b></p>
<ul>
  <li>Evidence today: <b>${k.evidence_today ?? '-'}</b></li>
  <li>Emails sent: <b>${k.emails_sent ?? '-'}</b></li>
  <li>False positives: <b>${k.false_positives ?? '-'}</b></li>
</ul>
</body></html>`;
fs.writeFileSync(out, html, 'utf-8');
console.log('weekly_report: wrote', out);
