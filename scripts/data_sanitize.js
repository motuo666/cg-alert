#!/usr/bin/env node
// data_sanitize.js — 修正 data/*.csv 中的常见格式问题；确保 endpoints.csv 三列规范化(host,url,type)
const fs = require('fs');
const path = require('path');

const VALID_TYPES = new Set(['Pricing','ToS','Privacy','DPA','Subprocessors','Security','Status','Other']);

function normHost(s){
  s = String(s||'').trim().replace(/^"|"$/g,'');
  s = s.split(/[\s,]+/)[0];                      // 只取逗号/空白前
  s = s.replace(/^https?:\/\//,'').replace(/\/.*/,''); // 去协议与路径
  s = s.replace(/^www\./,'').toLowerCase();
  s = s.replace(/[^a-z0-9._-]/g,'');
  return s;
}

function fixDomains(){
  const f = 'data/domains.csv';
  if(!fs.existsSync(f)) return;
  const lines = fs.readFileSync(f,'utf8').split(/\r?\n/).filter(Boolean);
  const out = [];
  const seen = new Set();
  for(const l of lines){
    const h = normHost(l);
    if(!h) continue;
    if(/^(_seed|acme|example)\./i.test(h) || h==='example.com') continue;
    if(!seen.has(h)){ seen.add(h); out.push(h); }
  }
  fs.writeFileSync(f, out.join('\n')+'\n','utf8');
  console.log(`[sanitize] domains.csv => ${out.length} lines`);
}

function parseEndpointLine(l){
  // 尝试从一行中提取 url 与类型；容错处理逗号造成的脏数据
  const urlMatch = l.match(/https?:\/\/[^,\s]+/i);
  const typeMatch = l.split(',').map(s=>s.trim()).reverse().find(s=>VALID_TYPES.has(s));
  const url = urlMatch ? urlMatch[0] : '';
  const host = url ? new URL(url).hostname.replace(/^www\./,'').toLowerCase() : normHost(l.split(',')[0]);
  const type = typeMatch || 'Other';
  if(!url || !host) return null;
  return `${host},${url},${type}`;
}

function fixEndpoints(){
  const f = 'data/endpoints.csv';
  if(!fs.existsSync(f)) return;
  const lines = fs.readFileSync(f,'utf8').split(/\r?\n/).filter(Boolean);
  const outSet = new Set();
  for(const l of lines){
    const fixed = parseEndpointLine(l);
    if(fixed){
      const host = fixed.split(',')[0];
      if(/^(_seed|acme|example)\./i.test(host) || host==='example.com') continue;
      outSet.add(fixed);
    }
  }
  const out = [...outSet].sort();
  fs.writeFileSync(f, out.join('\n')+'\n','utf8');
  console.log(`[sanitize] endpoints.csv => ${out.length} lines`);
}

(function main(){
  fixDomains();
  fixEndpoints();
})();
