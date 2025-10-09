// scripts/leads_sanity.js
const fs = require('fs');
const path = 'data/leads.csv';

if (!fs.existsSync(path)) {
  console.error('❌ 缺失 data/leads.csv');
  process.exit(1);
}
const raw = fs.readFileSync(path, 'utf8').trim();
if (!raw) {
  console.error('❌ data/leads.csv 为空');
  process.exit(1);
}

const [headerLine, ...lines] = raw.split(/\r?\n/);
const need = ['email','company','domain','vendor1','vendor2','vendor3','status','last_error','last_sent'];
const have = headerLine.split(',').map(s=>s.trim());
const miss = need.filter(k=>!have.includes(k));
if (miss.length) {
  console.error('❌ 表头缺失字段：', miss.join(', '));
  console.error('   期望表头：', need.join(','));
  process.exit(1);
}
if (lines.length === 0) {
  console.warn('⚠️ 当前无可投递行（只含表头）');
  process.exit(0);
}
let bad = 0, ok = 0;
for (const line of lines) {
  const email = line.split(',')[0]?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad++; else ok++;
}
if (bad) {
  console.error(`❌ 邮箱格式异常行：${bad}；正常：${ok}`);
  process.exit(1);
}
console.log(`✅ leads.csv 正常：${ok} 行`);
