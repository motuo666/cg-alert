#!/usr/bin/env node
/**
 * e2e_fullchain.js（覆盖版）
 * 目标：
 *  - 完整跑一遍从校验 → 采集 → 分段 →（DRY）外发 →（DRY）入站解析
 *  - leads.csv 严格校验：先调用 validate_leads.js，再做“表头友好”的严检
 *  - 仅使用 Node 内置模块（无第三方依赖），不会影响真实自动化运行
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LEADS_FILE = path.join(ROOT, 'data', 'leads.csv');
const DOMAINS_CSV = path.join(ROOT, 'data', 'domains.csv');
const VENDOR_TAGS = path.join(ROOT, 'vendors', 'vendor_tags.csv');

// DRY 从 inputs/env/命令行综合判断（默认 true：只演练不触达）
const argv = process.argv.join(' ');
const DRY =
  /\b(--dry|--dry=1)\b/i.test(argv) ||
  /^1|true$/i.test(process.env.DRY || '') ||
  (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'
    ? (process.env.DRY || 'true').toLowerCase() !== 'false'
    : true);

// ---------------------------------- //
//    日志与工具
// ---------------------------------- //
const say = (...a) => console.log(...a);
const ok  = (msg) => console.log(`✅ ${msg}`);
const ng  = (msg) => console.log(`❌ ${msg}`);

function fileExists(p){ try{ return fs.existsSync(p); }catch{ return false; } }

function runNode(scriptRel, args = [], extraEnv = {}) {
  const file = path.join(__dirname, scriptRel);
  if (!fileExists(file)) return { status: 0, skipped: true };
  const env = { ...process.env, ...extraEnv };
  const r = spawnSync('node', [file, ...args], { stdio: 'inherit', env });
  return { status: r.status || 0, skipped: false };
}

// ---------------------------------- //
//  严格校验（覆盖版）：首先调用 validate_leads.js，再做表头友好的严检
// ---------------------------------- //
const HEAD = ['email','company','domain','vendor1','vendor2','vendor3','persona','status','mx_ok'];
const ALLOWED_STATUS = new Set(['new','sent','bounced','unsub']);
const trim  = s => String(s ?? '').trim();
const lower = s => trim(s).toLowerCase();
const validEmail  = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower(e));
const validDomain = d => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trim(d));

function csvParseLite(text){
  const rows=[]; let row=[], field='', inQ=false;
  for (let i=0;i<text.length;i++){
    const ch=text[i];
    if (inQ){
      if (ch === '"'){
        if (text[i+1] === '"'){ field+='"'; i++; }
        else inQ=false;
      } else field+=ch;
    }else{
      if (ch === '"') inQ=true;
      else if (ch === ','){ row.push(field); field=''; }
      else if (ch === '\n'){ if (text[i-1] === '\r'){} row.push(field); field=''; rows.push(row); row=[]; }
      else field+=ch;
    }
  }
  row.push(field); rows.push(row);
  if (rows.length && rows[rows.length-1].length===1 && rows[rows.length-1][0]==='') rows.pop();
  return rows;
}

function strictValidateLeads() {
  // 先跑权威校验/规范化脚本
  const r = runNode('validate_leads.js', []);
  if (r.status !== 0) throw new Error('leads.csv 规范化/校验失败');

  // 读取规范化后的 CSV，再做轻量严检（自动跳过表头）
  const raw = fs.readFileSync(LEADS_FILE, 'utf8').replace(/^\uFEFF/,'');
  const rows = csvParseLite(raw);
  if (!rows.length) throw new Error('leads.csv 为空');

  // 识别表头
  const head = rows[0].map(x=>lower(x));
  let start = 0;
  const isHeader = HEAD.length === head.length && HEAD.every((k, i)=> head[i] === k);
  if (isHeader) start = 1;

  const errs = [];
  for (let i=start; i<rows.length; i++){
    const r = rows[i];
    if (r.length !== 9){
      errs.push(`第 ${i+1} 行：列数=${r.length}（应为 9）`);
      continue;
    }
    const [email, company, domain, , , , , status, mx_ok] = r.map(trim);
    if (!validEmail(email))   errs.push(`第 ${i+1} 行 email 非法: ${email}`);
    if (!validDomain(domain)) errs.push(`第 ${i+1} 行 domain 非法: ${domain}`);
    if (!ALLOWED_STATUS.has(lower(status))) errs.push(`第 ${i+1} 行 status 非法: ${status}`);
    if (!/^(0|1)$/.test(mx_ok)) errs.push(`第 ${i+1} 行 mx_ok 非法: ${mx_ok}`);
  }

  if (errs.length){
    console.error('Error: leads.csv 严格校验失败：');
    errs.forEach(e=>console.error(' - ' + e));
    throw new Error(`leads.csv 校验失败（共 ${errs.length} 处）`);
  }
  ok('leads.csv 校验通过');
}

// ---------------------------------- //
//  轻量连通性（TCP）探测：不引入依赖、仅用于 E2E
// ---------------------------------- //
function tcpProbe(host, port, timeoutMs=5000){
  return new Promise((resolve)=>{
    const s = net.createConnection({ host, port }, ()=>{ s.destroy(); resolve(true); });
    s.setTimeout(timeoutMs, ()=>{ s.destroy(); resolve(false); });
    s.on('error', ()=>{ s.destroy(); resolve(false); });
  });
}

// ---------------------------------- //
//  主流程
// ---------------------------------- //
(async function main(){
  let OK=0, WARN=0, FAIL=0;

  function section(title){ say(`▶ ${title}`); }
  function pass(msg){ ok(msg); OK++; }
  function warn(msg){ console.log(`⚠️  ${msg}`); WARN++; }
  function fail(msg){ ng(msg); FAIL++; }

  // 环境信息
  section('环境信息');
  say(`${process.platform} ${process.arch} node v${process.versions.node}`);
  pass('Node 环境就绪');

  // 基础文件校验
  section('基础文件校验');
  const must = [
    path.join(__dirname,'validate_leads.js'),
    LEADS_FILE
  ];
  const miss = must.filter(p=>!fileExists(p));
  if (miss.length){
    miss.forEach(p=>fail(`缺少关键文件：${path.relative(ROOT,p)}`));
    throw new Error('关键文件缺失');
  } else {
    pass('关键文件存在');
  }

  // leads.csv 严格校验（覆盖版）
  section('leads.csv 严格校验');
  try{
    strictValidateLeads();
  }catch(e){
    fail('leads.csv 校验失败');
    say(e && e.message ? e.message : String(e));
    summaryExit(OK,WARN,FAIL);
    process.exit(1);
  }

  // domains.csv / vendor_tags.csv 简要校验（有就校验，无则跳过）
  section('domains.csv / vendor_tags.csv 校验');
  try{
    if (fileExists(DOMAINS_CSV)){
      const s = fs.readFileSync(DOMAINS_CSV,'utf8').trim();
      if (!s) warn('domains.csv 为空'); else pass('domains.csv OK');
    } else warn('缺少 data/domains.csv（可选）');

    if (fileExists(VENDOR_TAGS)){
      const s = fs.readFileSync(VENDOR_TAGS,'utf8').trim();
      if (!s) warn('vendors/vendor_tags.csv 为空'); else pass('vendor_tags.csv OK');
    } else warn('缺少 vendors/vendor_tags.csv（可选）');
  }catch(e){
    warn('domains/vendor_tags 读取异常：'+(e.message||e));
  }

  // Secrets / 连通性预检（不发信）：用 TCP 探测
  section('Secrets / 连通性预检（不发信）');
  const SMTP_HOST = process.env.SMTP_HOST || '';
  const SMTP_PORT = Number(process.env.SMTP_PORT || 0);
  const IMAP_HOST = process.env.IMAP_HOST || (SMTP_HOST ? SMTP_HOST.replace(/^smtp\./i,'imap.') : '');
  const IMAP_PORT = Number(process.env.IMAP_PORT || 993);

  if (SMTP_HOST && SMTP_PORT){
    const okTcp = await tcpProbe(SMTP_HOST, SMTP_PORT, 5000);
    okTcp ? pass(`SMTP ${SMTP_HOST}:${SMTP_PORT} 连通`) : warn(`SMTP ${SMTP_HOST}:${SMTP_PORT} 不通（仅 TCP 探测）`);
  } else warn('SMTP_HOST/SMTP_PORT 未提供（E2E 仅做探测，不影响真实发送工作流）');

  if (IMAP_HOST && IMAP_PORT){
    const okTcp = await tcpProbe(IMAP_HOST, IMAP_PORT, 5000);
    okTcp ? pass(`IMAP ${IMAP_HOST}:${IMAP_PORT} 连通`) : warn(`IMAP ${IMAP_HOST}:${IMAP_PORT} 不通（仅 TCP 探测）`);
  } else warn('IMAP_HOST/IMAP_PORT 未提供（E2E 仅做探测，不影响真实轮询工作流）');

  // Discover Contacts（采集）
  section('Discover Contacts（采集）');
  {
    const r = runNode('discover_contacts.js', [], { DRY: '1' });
    if (r.skipped) pass('discover_contacts.js 缺失 → 跳过');
    else r.status===0 ? pass('Discover Contacts PASS') : fail('Discover Contacts 失败');
  }

  // Leads Lint（再次防呆）
  section('Leads Lint（再次防呆）');
  {
    const r = runNode('validate_leads.js', []);
    r.status===0 ? pass('validate_leads.js PASS') : fail('validate_leads.js 失败');
  }

  // 分段（segment）
  section('分段（segment）');
  {
    const r = runNode('segment.js', [], {});
    if (r.skipped) pass('segment.js 缺失 → 跳过');
    else r.status===0 ? pass('segment PASS') : fail('segment 失败');
  }

  // 外发（DRY）
  section('外发（DRY）');
  {
    // 优先 send_bulk.js；不存在就跳过
    const r = runNode('send_bulk.js', ['--dry=1'], { DRY: '1' });
    if (r.skipped) pass('send_bulk.js 缺失 → 跳过');
    else r.status===0 ? pass('send_bulk(DRY) PASS') : fail('send_bulk(DRY) 失败');
  }

  // 入站解析（poll_inbox，DRY 会直接 PASS）
  section('入站解析（poll_inbox）');
  {
    const r = runNode('poll_inbox.js', ['--dry=1'], { DRY: '1' });
    if (r.skipped) pass('poll_inbox.js 缺失 → 跳过');
    else r.status===0 ? pass('poll_inbox PASS') : fail('poll_inbox 失败');
  }

  summaryExit(OK, WARN, FAIL);
  process.exit(FAIL ? 1 : 0);
})().catch(e=>{
  ng(e && e.message ? e.message : String(e));
  process.exit(1);
});

// 输出总结
function summaryExit(OK, WARN, FAIL){
  say('=== E2E SUMMARY ===');
  say(`OK: ${OK}  WARN: ${WARN}  FAIL: ${FAIL}`);
}
