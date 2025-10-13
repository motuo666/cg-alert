#!/usr/bin/env node
// internal_linking.js — 极简版（为 vendors/* 页面补齐面包屑/返回链接），幂等
const fs=require('fs'), path=require('path');
(function main(){
  const root='vendors'; if(!fs.existsSync(root)) return;
  for(const d of fs.readdirSync(root,{withFileTypes:true})){
    if(!d.isDirectory()) continue;
    const idx=path.join(root,d.name,'index.html'); if(!fs.existsSync(idx)) continue;
    let html=fs.readFileSync(idx,'utf8');
    if(html.includes('data-cg-breadcrumb="1"')) continue;
    html=html.replace(/<body([^>]*)>/i,(m,a)=>`<body$1><nav data-cg-breadcrumb="1" style="margin:10px 0"><a href="/">Home</a> · <a href="/updates/">Updates</a> · <a href="/vendors/">Vendors</a></nav>`);
    fs.writeFileSync(idx, html, 'utf8');
  }
  console.log('[internal-linking] done');
})(); 
