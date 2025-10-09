// scripts/alert_changes.js
// 用法：node scripts/alert_changes.js changed.txt
// changed.txt 每行是一个改动的文件路径；只处理 evidence/<vendor>/*.json
const fs=require('fs'),path=require('path');
const { notifySlack } = require('./lib/slack_notify');

const ROOT=path.join(__dirname,'..');

function readCSV(fp){
  if(!fs.existsSync(fp)) return {header:[],rows:[]};
  const raw=fs.readFileSync(fp,'utf8').trim(); if(!raw) return {header:[],rows:[]};
  const [h,...rs]=raw.split(/\r?\n/).filter(Boolean);
  const header=h.split(',').map(s=>s.trim());
  const rows=rs.map(l=>{const v=l.split(',');const o={};header.forEach((k,i)=>o[k]=String(v[i]??'').trim());return o;});
  return {header,rows};
}

function vendorToCustomers(){
  const {header,rows}=readCSV(path.join(ROOT,'data','customers.csv'));
  const i=Object.fromEntries(header.map((k,n)=>[k,n]));
  const map=new Map(); // vendor -> Set of {company,id,email,plan}
  for(const r of rows){
    const company=r.company||r.name||''; const id=r.id||r.customer_id||''; const email=r.email||'';
    const vendors=(r.vendors||'').split(/[, \t\r\n]+/).map(s=>s.trim()).filter(Boolean);
    for(const v of vendors){
      const key=v.toLowerCase(); if(!map.has(key)) map.set(key,new Set());
      map.get(key).add(JSON.stringify({company,id,email}));
    }
  }
  // 转为 vendor -> arr
  const out=new Map();
  for(const [v,set] of map.entries()){ out.set(v, Array.from(set).map(s=>JSON.parse(s))); }
  return out;
}

function summarizeFile(fp){
  try{
    const txt=fs.readFileSync(fp,'utf8');
    const data=JSON.parse(txt); const arr=Array.isArray(data)?data:[data];
    const items=arr.map(it=>({
      url: it.url||it.URL||it.link||'',
      snippet: String(it.snippet||it.fragment||it.text||'').slice(0,200),
      ts: (it.timestamp||it.ts||'')
    }));
    return {count:arr.length, first:items[0]||null};
  }catch{ return {count:0, first:null}; }
}

async function main(){
  const changedListPath=process.argv[2]||'';
  if(!changedListPath||!fs.existsSync(changedListPath)){ console.log('no changed list'); return; }
  const lines=fs.readFileSync(changedListPath,'utf8').split(/\r?\n/).filter(Boolean);
  const v2c=vendorToCustomers();

  for(const rel of lines){
    if(!/^evidence\//.test(rel)) continue;
    const parts=rel.split('/'); if(parts.length<3) continue;
    const vendor=parts[1];
    const {count,first}=summarizeFile(path.join(ROOT,rel));
    if(count===0) continue;

    const customers = v2c.get(vendor.toLowerCase()) || [];
    if(customers.length===0) continue; // 没有绑定客户就不发

    const pageUrl=`https://www.cg-alert.com/vendors/${encodeURIComponent(vendor)}/`;
    const head=`${vendor} 有 ${count} 条更新`;
    const tail= first ? `\n示例：${first.url||pageUrl}\n“${first.snippet}”` : '';
    const text=`${head}\n${pageUrl}${tail}`;

    // 向每个绑定客户发送，有 Business/Enterprise 自动加 [PRIORITY]
    for(const c of customers){
      await notifySlack(text, { customerCompany: c.company, customerId: c.id, customerEmail: c.email });
    }
  }
}
main().catch(e=>{ console.error(e); process.exit(1); });
