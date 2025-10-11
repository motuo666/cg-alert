#!/usr/bin/env node
/**
 * Normalize data/leads.csv:
 * - 可识别并移除表头
 * - 每条记录保证 9 列: email,company,domain,vendor1,vendor2,vendor3,persona,status,mx_ok
 * - 空/非法 status -> new
 * - 空/非法 mx_ok -> 1
 * - email/domain 合法性校验；email 去重（保留首条）
 * - 处理“多条粘在一行”（列数为 9 的倍数时切片）
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'leads.csv');

function isEmail(x){ return /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(x||''); }
function isDomain(x){ return /^[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(x||''); }

if(!fs.existsSync(FILE)){
  console.error('❌ 缺失 data/leads.csv');
  process.exit(1);
}

let raw = fs.readFileSync(FILE, 'utf8');
if(/\r\n/.test(raw)) {
  // 统一 LF，避免解析边缘问题
  raw = raw.replace(/\r\n/g, '\n');
}
let lines = raw.split('\n').filter(l => l.trim().length>0);

// 识别表头
const header = 'email,company,domain,vendor1,vendor2,vendor3,persona,status,mx_ok';
if(lines[0].trim().toLowerCase().replace(/\s+/g,'') === header){
  lines.shift();
  console.log('ℹ 已移除表头');
}

const out = [];
const seen = new Set();
let kept=0, skipped=0, fixedStatus=0, fixedMx=0, splitPacked=0;

function pushRecord(cols){
  // 标准化长度
  cols = cols.map(s => (s||'').trim());
  while(cols.length < 9) cols.push('');
  if(cols.length > 9) cols = cols.slice(0,9);

  let [email, company, domain, v1, v2, v3, persona, status, mx_ok] = cols;

  if(!isEmail(email)) { skipped++; return; }
  if(!company)        { skipped++; return; }
  if(!isDomain(domain)){ skipped++; return; }

  // 统一小写/格式化
  email  = email.toLowerCase();
  domain = domain.toLowerCase();

  // persona 可空，status/mx_ok 纠正
  const allowed = new Set(['new','sent','bounced','unsub']);
  if(!allowed.has((status||'').toLowerCase())) { status = 'new'; fixedStatus++; }
  if(!/^[01]$/.test(mx_ok||'')) { mx_ok = '1'; fixedMx++; }

  // 去重
  if(seen.has(email)) { skipped++; return; }
  seen.add(email);

  out.push([email, company, domain, v1, v2, v3, persona||'procurement', status, mx_ok].join(','));
  kept++;
}

for(const line of lines){
  const cols = line.split(',').map(s=>s.trim());
  if(cols.length === 0) continue;

  if(cols.length === 9){
    pushRecord(cols);
  }else if(cols.length % 9 === 0){
    // 多条粘在一行，按 9 列切片
    for(let i=0;i<cols.length;i+=9){
      pushRecord(cols.slice(i, i+9));
    }
    splitPacked++;
  }else if(cols.length > 9){
    // 列数异常但 >9：尽力而为，用前 9 列
    pushRecord(cols.slice(0,9));
  }else{
    // 列数不足，跳过
    skipped++;
  }
}

if(out.length === 0){
  console.error('❌ 归一化后没有有效记录，请检查输入内容。');
  process.exit(1);
}

// 回写（LF）
fs.writeFileSync(FILE, out.join('\n') + '\n', 'utf8');

console.log(`✅ 规范化完成：保留 ${kept} 条，跳过 ${skipped} 条，修正 status=${fixedStatus}、mx_ok=${fixedMx}，拆分粘连行=${splitPacked}`);
