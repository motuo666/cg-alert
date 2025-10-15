#!/usr/bin/env node
/**
 * merge_suppression.js  —  把退信/退订合并回 leads.csv（9列、无表头）
 * 目标：
 *   - 将 data/bounces.csv / data/unsubscribes.csv 中出现的邮箱，回写到 data/leads.csv
 *   - 优先级：unsub/optout > bounced > 其它（保持原值）
 *   - bounced 会把 mx_ok 置为 0，避免后续再投
 *   - 生成 data/suppression_log.csv 变更日志（可追溯）
 * 用法：
 *   node scripts/merge_suppression.js         # 正常执行
 *   node scripts/merge_suppression.js --dry   # 只输出统计，不写文件
 *
 * 兼容：
 *   - bounces.csv / unsubscribes.csv 任意列数、可有表头；从整行提取第一个邮箱即可
 *   - leads.csv 的公司字段可能含逗号，本脚本按“首列 + 尾8列”回组装为9列
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = (p) => path.join(ROOT, 'data', p);

const DRY = process.argv.includes('--dry');

const FILE_LEADS   = DATA('leads.csv');
const FILE_BOUNCES = DATA('bounces.csv');
const FILE_UNSUBS  = DATA('unsubscribes.csv');
const FILE_LOG     = DATA('suppression_log.csv');

const PREFER_OPTOUT = process.env.PREFER_OPTOUT === '1'; // 可选：把退订标记写成 optout（默认 unsub）

// ---------- 工具 ----------
function readText(fp){ return fs.existsSync(fp) ? fs.readFileSync(fp,'utf8') : ''; }
function writeText(fp, txt){ fs.mkdirSync(path.dirname(fp),{recursive:true}); fs.writeFileSync(fp, txt, 'utf8'); }
function firstEmailInLine(line){
  const m = String(line).toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0] : null;
}
function parseEmailSet(fp){
  const raw = readText(fp);
  if (!raw) return new Set();
  const set = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const e = firstEmailInLine(line);
    if (e) set.add(e.toLowerCase());
  }
  return set;
}
function parseLeads9(fp){
  const out = [];
  const raw = readText(fp);
  if (!raw) return out;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split(',');
    if (parts.length < 1) continue;

    if (parts.length < 9) {
      // 非法行，跳过（不修改）
      out.push({ _raw: line, bad: true });
      continue;
    }
    if (parts.length === 9) {
      out.push({
        email: parts[0].trim(),
        company: parts[1].trim(),
        domain: parts[2].trim(),
        v1: parts[3].trim(),
        v2: parts[4].trim(),
        v3: parts[5].trim(),
        persona: parts[6].trim(),
        status: parts[7].trim(),
        mx_ok: parts[8].trim(),
      });
      continue;
    }
    // 公司字段中带逗号：首列email + 尾8列固定字段，中间全部合并成company
    const [email, ...rest] = parts;
    const tail = rest.slice(-8);
    const company = rest.slice(0, rest.length - 8).join(' ').trim();
    const [domain, v1, v2, v3, persona, status, mx_ok_a, mx_ok_b] = tail; // 尾8列固定顺序
    out.push({
      email: email.trim(),
      company,
      domain: (domain||'').trim(),
      v1: (v1||'').trim(),
      v2: (v2||'').trim(),
      v3: (v3||'').trim(),
      persona: (persona||'').trim(),
      status: (status||'').trim(),
      mx_ok: (mx_ok_b ?? mx_ok_a ?? '').trim(), // 兼容历史脏行
    });
  }
  return out;
}
function toCSVRow9(r){
  return [
    r.email, r.company, r.domain, r.v1, r.v2, r.v3, r.persona, r.status, r.mx_ok
  ].join(',');
}
function ensureLogHeader(){
  if (!fs.existsSync(FILE_LOG)){
    writeText(FILE_LOG, 'when,email,old_status,new_status,source\n');
  }
}
function appendLog(when, email, oldStatus, newStatus, source){
  ensureLogHeader();
  fs.appendFileSync(FILE_LOG, `${when},${email},${oldStatus},${newStatus},${source}\n`, 'utf8');
}
function setSummary(lines){
  try {
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n')+'\n', 'utf8');
    }
  } catch {}
}

// ---------- 读取 ----------
const leads = parseLeads9(FILE_LEADS);
if (leads.length === 0) {
  console.log('merge_suppression: no leads.csv found or empty; nothing to do');
  process.exit(0);
}
const bounces = parseEmailSet(FILE_BOUNCES);
const unsubs  = parseEmailSet(FILE_UNSUBS);

// ---------- 规则 ----------
const NOW_ISO = new Date().toISOString();
const ST_UNSUB = PREFER_OPTOUT ? 'optout' : 'unsub';

function nextStatus(cur, source){
  // 优先级：unsub/optout > bounced > 其它
  if (source === 'unsub') {
    if (cur === ST_UNSUB) return cur;
    return ST_UNSUB;
  }
  if (source === 'bounced') {
    if (cur === ST_UNSUB) return cur;    // 已退订不降级
    if (cur === 'bounced') return cur;
    return 'bounced';
  }
  return cur || 'new';
}

// ---------- 合并 ----------
let touched = 0, toUnsub = 0, toBounce = 0;
const outRows = [];
for (const r of leads) {
  if (r.bad) { outRows.push(r._raw); continue; }

  const emailLc = String(r.email||'').toLowerCase();

  // 决定新状态
  let newStatus = r.status;
  let hitSource = null;

  if (unsubs.has(emailLc)) {
    newStatus = nextStatus(newStatus, 'unsub');
    hitSource = 'unsubscribes.csv';
  } else if (bounces.has(emailLc)) {
    newStatus = nextStatus(newStatus, 'bounced');
    hitSource = 'bounces.csv';
  }

  // 写回
  if (hitSource && newStatus !== r.status) {
    touched++;
    if (newStatus === ST_UNSUB) toUnsub++;
    if (newStatus === 'bounced') toBounce++;
    if (!DRY) appendLog(NOW_ISO, r.email, r.status, newStatus, hitSource);
    r.status = newStatus;
    if (newStatus === 'bounced') r.mx_ok = '0';
  }

  outRows.push(toCSVRow9(r));
}

// ---------- 输出 ----------
if (DRY) {
  console.log(`merge_suppression (dry): leads=${leads.length} unsub_hits=${toUnsub} bounce_hits=${toBounce} changed=${touched}`);
} else {
  // 先备份
  try { fs.copyFileSync(FILE_LEADS, FILE_LEADS + '.bak'); } catch {}
  writeText(FILE_LEADS, outRows.join('\n') + '\n');
  console.log(`merge_suppression: leads=${leads.length} unsub_applied=${toUnsub} bounce_applied=${toBounce} changed=${touched}`);
}

// ---------- Summary ----------
setSummary([
  '### Merge Suppression',
  `- leads: ${leads.length}`,
  `- applied unsub/optout: ${toUnsub}`,
  `- applied bounced: ${toBounce}`,
  `- changed rows: ${touched}`,
  `- mode: ${DRY ? 'dry-run' : 'write'}`
]);
