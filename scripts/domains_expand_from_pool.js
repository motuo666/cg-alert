#!/usr/bin/env node
// 从 data/domain_pool.csv 向 data/domains.csv 追加 N 个未收录域（幂等）
// 用法: node scripts/domains_expand_from_pool.js 50
const fs=require('fs'), path=require('path');
const N = Math.max(1, Number(process.argv[2]||50));
const poolF='data/domain_pool.csv', domF='data/domains.csv';
if(!fs.existsSync(poolF)) { console.error('no domain_pool.csv'); process.exit(0); }
const norm = s => s.replace(/^https?:\/\//,'').replace(/\/+$/,'').toLowerCase();
const pool = fs.readFileSync(poolF,'utf8').split(/\r?\n/).map(s=>norm(s.trim())).filter(Boolean);
const had  = fs.existsSync(domF)? fs.readFileSync(domF,'utf8').split(/\r?\n/).map(s=>norm(s.trim())).filter(Boolean) : [];
const S=new Set(had);
const add=[]; for(const d of pool){ if(!S.has(d)){ add.push(d); S.add(d); if(add.length>=N) break; } }
if(!add.length){ console.log('[expand] no new domains'); process.exit(0); }
fs.appendFileSync(domF, add.join('\n')+'\n','utf8');
console.log(`[expand] +${add.length} domains`);
