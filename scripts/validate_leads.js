#!/usr/bin/env node
/**
 * 更严格的 leads.csv 校验：
 * - 恰好 9 列：email,company,domain,vendor1,vendor2,vendor3,persona,status,mx_ok
 * - email 合法、domain 合法
 * - status ∈ {new,sent,bounced,unsub}
 * - mx_ok ∈ {0,1}
 * - 提示粘连/缺列的“人话原因”
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'leads.csv');
if(!fs.existsSync(file)) { console.error('缺失 data/leads.csv'); process.exit(1); }

const raw = fs.readFileSync(file);
if (raw.includes(0x0D)) {
  console.warn('⚠ leads.csv 含 CRLF（\\r\\n）。建议统一 LF（dos2unix data/leads.csv），避免某些解析器边缘问题。');
}
const lines = raw.toString('utf8').split(/\r?\n/).filter(Boolean);
const allowedStatus = new Set(['new','sent','bounced','unsub']);
const bad = [];
const seen = new Set();

function isEmail(x){
  return /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(x||'');
}

lines.forEach((line, i)=>{
  const n = i+1;
  const cols = line.split(',');

  if(cols.length !== 9){
    if(cols.length % 9 === 0){
      bad.push(`第 ${n} 行：检测到 ${cols.length} 列（是 9 的倍数），疑似多条线索被粘在一行，缺少换行 \\n。请拆成 ${cols.length/9} 行，每行 9 列。`);
    }else{
      bad.push(`第 ${n} 行：列数=${cols.length}（应为 9）。当前内容：${line}`);
    }
    return;
  }

  const [email, company, domain, v1, v2, v3, persona, status, mx_ok] = cols.map(s=>s.trim());

  if(!isEmail(email)) bad.push(`第 ${n} 行：email 非法 -> ${email}`);
  if(!company) bad.push(`第 ${n} 行：company 为空`);
  if(!/^[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(domain)) bad.push(`第 ${n} 行：domain 非法 -> ${domain}`);
  if(!allowedStatus.has(status)) bad.push(`第 ${n} 行：status 必须为 new|sent|bounced|unsub，当前 -> ${status}`);
  if(!/^[01]$/.test(mx_ok)) bad.push(`第 ${n} 行：mx_ok 必须为 0 或 1，当前 -> ${mx_ok}`);

  const key = email.toLowerCase();
  if(seen.has(key)) bad.push(`第 ${n} 行：重复 email -> ${email}`);
  else seen.add(key);
});

if(bad.length){
  console.error('❌ leads.csv 校验失败：');
  bad.forEach(m => console.error(' - ' + m));
  process.exit(1);
}
console.log(`✅ leads.csv 校验通过，行数=${lines.length}`);
