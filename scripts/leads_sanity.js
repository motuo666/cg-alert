// scripts/leads_sanity.js
const fs=require('fs');
const path='data/leads.csv';
if(!fs.existsSync(path)){ console.error('❌ 缺失 data/leads.csv'); process.exit(1); }
const raw=fs.readFileSync(path,'utf8').trim();
if(!raw){ console.error('❌ data/leads.csv 为空'); process.exit(1); }

const [headerLine,...lines]=raw.split(/\r?\n/);
const have=headerLine.split(',').map(s=>s.trim());

// 只强制最小集；status/last_error/last_sent 允许缺失（由发送脚本自动补）
const need=['email','company','domain','vendor1','vendor2','vendor3'];
const miss=need.filter(k=>!have.includes(k));
if(miss.length){ console.error('❌ 表头至少要包含：', need.join(',')); process.exit(1); }

let bad=0, ok=0;
for(const l of lines){ const email=(l.split(',')[0]||'').trim();
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad++; else ok++;
}
if(bad){ console.error(`❌ 邮箱格式异常 ${bad} 行`); process.exit(1); }
console.log(`✅ leads.csv OK: ${ok} 行；表头=${have.join('|')}`);
