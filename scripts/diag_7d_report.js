#!/usr/bin/env node
/**
 * 7天投递指标一键诊断（Run Summary + 可视化 HTML）
 * 口径：只统计「近7日 且 发生在该邮箱最后一次发送之后」的退订/退信
 * 输出：Run Summary（表格/建议） + reports/ops/diag-7d/index.html
 * 依赖：无第三方库
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const D = p => path.join(ROOT, 'data', p);
const R = p => path.join(ROOT, p);

const vars = {
  MIN_SENT7_FOR_DLVR: parseFloat(process.env.MIN_SENT7_FOR_DLVR || '100'),
  UNSUB_7D_MAX:       parseFloat(process.env.UNSUB_7D_MAX       || '0.005'),
  COMPLAINT_7D_MAX:   parseFloat(process.env.COMPLAINT_7D_MAX   || '0.001'),
  BOUNCE_7D_MAX:      parseFloat(process.env.BOUNCE_7D_MAX      || '0.08'),
};

const now = new Date();
const cutoffMs = now.getTime() - 7*24*3600*1000;

function readLines(fp){
  if (!fs.existsSync(fp)) return [];
  return fs.readFileSync(fp, 'utf8').split(/\r?\n/).filter(Boolean);
}
function parseCSV(fp){
  const lines = readLines(fp);
  if (!lines.length) return { header: [], rows: [] };
  const headerCandidates = lines[0].split(',');
  const looksHeader = headerCandidates.some(h => /when|email|status/i.test(h));
  const header = looksHeader ? headerCandidates : [];
  const start = looksHeader ? 1 : 0;
  const rows = lines.slice(start).map(l => l.split(','));
  return { header, rows };
}
function parseWhen(s){
  if (!s) return null;
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}
function getColIdx(header, fallback){
  // fallback: {when:0,email:1,status:7} etc.
  const idx = {...fallback};
  if (header && header.length){
    const lower = header.map(h => h.toLowerCase());
    const find = key => {
      const i = lower.findIndex(h => h === key || h.includes(key));
      return i >= 0 ? i : (fallback[key] ?? -1);
    };
    Object.keys(fallback).forEach(k => idx[k] = find(k));
  }
  return idx;
}
function fmtPct(n){ return (n*100).toFixed(2) + '%'; }

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function main(){
  // outreach_log.csv
  const out = parseCSV(D('outreach_log.csv'));
  const outIdx = getColIdx(out.header, { when:0, email:1, status:8 });
  // unsubscribes.csv
  const us = parseCSV(D('unsubscribes.csv'));
  // 尝试自动识别列（兼容 "when,email,..." 或只有 "email"）
  const unsubHeader = us.header;
  const usIdx = unsubHeader.length
    ? getColIdx(unsubHeader, { when:0, email:1 })
    : { when:-1, email:0 };
  // bounces.csv
  const bo = parseCSV(D('bounces.csv'));
  const bounceHeader = bo.header;
  const boIdx = bounceHeader.length
    ? getColIdx(bounceHeader, { when:0, email:1 })
    : { when:-1, email:0 };
  // complaints（如无可忽略）
  const cp = parseCSV(D('complaints.csv'));
  const cpIdx = cp.header.length ? getColIdx(cp.header, { when:0, email:1 }) : { when:-1, email:0 };

  // 1) sent7 + last_sent_at map
  const lastSentAt = new Map();
  let sent7 = 0;
  for (const row of out.rows){
    const when = parseWhen(row[outIdx.when] || '');
    const email = (row[outIdx.email] || '').trim().toLowerCase();
    const status = (row[outIdx.status] || '').trim().toLowerCase();
    if (!email) continue;
    if (when && status === 'sent'){
      const prev = lastSentAt.get(email);
      if (!prev || when > prev) lastSentAt.set(email, when);
      if (when.getTime() >= cutoffMs) sent7++;
    }
  }

  // 2) events in 7d & after last_sent
  function countEvents(rows, idx){
    let valid7 = 0, total7=0, invalidWhen=0, beforeLast=0, noLastSent=0;
    const samples = []; // for HTML
    for (const row of rows){
      const email = (row[idx.email] || '').trim().toLowerCase();
      if (!email) continue;
      const when = idx.when >= 0 ? parseWhen(row[idx.when] || '') : null;
      const last = lastSentAt.get(email) || null;
      const rowInfo = { email, when: when? when.toISOString(): '', last: last? last.toISOString(): '', after: false, within7d: false, counted:false };

      if (!when) { invalidWhen++; samples.push({...rowInfo}); continue; }
      const in7d = when.getTime() >= cutoffMs;
      if (in7d) total7++;
      const after = last ? (when >= last) : false;
      rowInfo.after = after; rowInfo.within7d = in7d;
      if (!last) { if (in7d) noLastSent++; samples.push({...rowInfo}); continue; }
      if (in7d && after){ valid7++; rowInfo.counted = true; }
      if (in7d && !after){ beforeLast++; }
      samples.push({...rowInfo});
    }
    return { valid7, total7, invalidWhen, beforeLast, noLastSent, samples };
  }

  const unsub = countEvents(us.rows, usIdx);
  const bounce = countEvents(bo.rows, boIdx);
  const complaints = countEvents(cp.rows, cpIdx);

  // 3) 计算比率
  const s7 = Math.max(0, sent7);
  const unsubRate = s7>0 ? unsub.valid7/s7 : 0;
  const bounceRate = s7>0 ? bounce.valid7/s7 : 0;
  const complaintRate = s7>0 ? complaints.valid7/s7 : 0;

  const sumPath = process.env.GITHUB_STEP_SUMMARY;
  const md = [];
  md.push('### 7-Day Deliverability Diagnosis');
  md.push(`- cutoff (7d): **${new Date(cutoffMs).toISOString()}**`);
  md.push(`- sent7: **${s7}** (MIN_SENT7_FOR_DLVR=${vars.MIN_SENT7_FOR_DLVR})`);
  md.push('');
  md.push(`| Metric | Count (valid/after-last-sent, in 7d) | Rate vs sent7 | Threshold | Notes |`);
  md.push(`|---|---:|---:|---:|---|`);
  md.push(`| Unsub | ${unsub.valid7} | ${fmtPct(unsubRate)} | ${fmtPct(vars.UNSUB_7D_MAX)} | total7=${unsub.total7}, invalid_when=${unsub.invalidWhen}, before_last=${unsub.beforeLast}, no_last_sent=${unsub.noLastSent} |`);
  md.push(`| Bounce | ${bounce.valid7} | ${fmtPct(bounceRate)} | ${fmtPct(vars.BOUNCE_7D_MAX)} | total7=${bounce.total7}, invalid_when=${bounce.invalidWhen}, before_last=${bounce.beforeLast}, no_last_sent=${bounce.noLastSent} |`);
  md.push(`| Complaint | ${complaints.valid7} | ${fmtPct(complaintRate)} | ${fmtPct(vars.COMPLAINT_7D_MAX)} | total7=${complaints.total7}, invalid_when=${complaints.invalidWhen}, before_last=${complaints.beforeLast}, no_last_sent=${complaints.noLastSent} |`);

  if (s7 < vars.MIN_SENT7_FOR_DLVR){
    md.push('\n> ℹ️ **Burn-in**: sent7 小于阈值，仅做诊断不过闸（建议先把发送提升到 sent7≥' + vars.MIN_SENT7_FOR_DLVR + ' 再恢复严格门槛）。');
  }

  // 建HTML
  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>7-Day Deliverability Diagnosis</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:system-ui,Arial;margin:24px;line-height:1.6;max-width:1100px}
table{border-collapse:collapse;width:100%;margin:12px 0} th,td{border:1px solid #e5e7eb;padding:6px 8px;font-size:14px}
th{background:#f9fafb;text-align:left} .pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#eef} .muted{color:#6b7280}
.bad{color:#b91c1c;font-weight:600} .ok{color:#065f46;font-weight:600}
</style></head><body>
<h1>7-Day Deliverability Diagnosis</h1>
<p class="muted">cutoff(7d): ${new Date(cutoffMs).toISOString()}</p>
<h3>Summary</h3>
<table>
<tr><th>Metric</th><th>valid7</th><th>sent7</th><th>Rate</th><th>Threshold</th><th>Notes</th></tr>
<tr><td>Unsub</td><td>${unsub.valid7}</td><td>${s7}</td><td>${fmtPct(unsubRate)}</td><td>${fmtPct(vars.UNSUB_7D_MAX)}</td><td>total7=${unsub.total7}, invalid_when=${unsub.invalidWhen}, before_last=${unsub.beforeLast}, no_last_sent=${unsub.noLastSent}</td></tr>
<tr><td>Bounce</td><td>${bounce.valid7}</td><td>${s7}</td><td>${fmtPct(bounceRate)}</td><td>${fmtPct(vars.BOUNCE_7D_MAX)}</td><td>total7=${bounce.total7}, invalid_when=${bounce.invalidWhen}, before_last=${bounce.beforeLast}, no_last_sent=${bounce.noLastSent}</td></tr>
<tr><td>Complaint</td><td>${complaints.valid7}</td><td>${s7}</td><td>${fmtPct(complaintRate)}</td><td>${fmtPct(vars.COMPLAINT_7D_MAX)}</td><td>total7=${complaints.total7}, invalid_when=${complaints.invalidWhen}, before_last=${complaints.beforeLast}, no_last_sent=${complaints.noLastSent}</td></tr>
</table>

<h3>Samples (latest 50 unsub/bounce events in 7d)</h3>
<table>
<tr><th>Type</th><th>Email</th><th>When</th><th>Last Sent</th><th>Within 7d</th><th>After Last Sent</th><th>Counted</th></tr>
${[...markSamples('Unsub', unsub.samples), ...markSamples('Bounce', bounce.samples)]
  .filter(r => r.within7d).slice(-50).reverse().map(r => `<tr>
<td>${r.type}</td><td>${escapeHtml(r.email)}</td><td>${r.when||''}</td><td>${r.last||''}</td>
<td>${r.within7d? '✓':''}</td><td>${r.after? '✓':''}</td><td>${r.counted? '<span class="ok">YES</span>':'<span class="bad">NO</span>'}</td></tr>`).join('')}
</table>

<p class="muted">Rules: only count events that are both within the last 7d and occurred after the email's last sent time.</p>
</body></html>`;

  ensureDir(R('reports/ops/diag-7d'));
  fs.writeFileSync(R('reports/ops/diag-7d/index.html'), html, 'utf8');

  // 写 Summary
  if (process.env.GITHUB_STEP_SUMMARY){
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n')+'\n', 'utf8');
  }
  console.log(md.join('\n'));

  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function markSamples(type, arr){
    return arr.map(o => ({ type, ...o }));
  }
}

main();
