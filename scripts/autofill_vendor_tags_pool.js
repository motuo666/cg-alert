// 从 evidence/<vendor>/*.json 推断 vendor 的分类，写入 data/vendor_tags_pool.csv（仅高置信、去重、每次最多 +50）
// 规则基于 URL/snippet 关键词计分；得分>=2 才写入，避免误标。
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const EVID=path.join(ROOT,'evidence');
const POOL=path.join(ROOT,'data','vendor_tags_pool.csv');

// 标签→关键字（可按需扩展）
const RULES={
  auth:[/sso|single\s*sign[-\s]?on|oauth|oidc|saml|mfa|passkey|identity|iam|auth/i],
  payments:[/payment|checkout|billing|invoice|card|pci|revenue|stripe|adyen|braintree|paddle|recurly/i],
  crm:[/\bcrm\b|salesforce|lead|pipeline|hubspot|zoho crm?/i],
  cs:[/help\s?desk|ticket|support|zendesk|intercom|help\s?scout/i],
  devtools:[/repository|git\b|ci\/?cd|issue|pull\s?request|developer|sdk|api|atlassian|github|gitlab|bitbucket/i],
  observability:[/monitor|metrics|traces|logs|observability|apm|uptime|statuspage/i],
  infra:[/\bcdn\b|dns|edge|waf|ddos|cloudflare|fastly|vercel|netlify|kubernetes|serverless|infra/i],
  email:[/\bemail\b|smtp|deliver(y|ability)|sendgrid|mailgun|postmark/i],
  search:[/\bsearch\b|index|algolia|elastic(?!ity)/i],
  content:[/\bcms\b|contentful|sanity|headless/i],
  design:[/\bdesign\b|figma|prototype|whiteboard|miro|canva/i],
  db:[/\bdatabase\b|sql|mongodb|postgres|snowflake|warehouse/i],
  paas:[/platform as a service|heroku|render|\bpaas\b|app\s*platform|deploy(ment)?/i],
  comm:[/\bsms\b|voice|twilio|messag(e|ing)|chat/i],
  storage:[/\bstorage\b|bucket|s3|dropbox|box/i],
  collaboration:[/workspace|microsoft 365|share|collaborat/i],
  productivity:[/task|notes|notion|asana|monday|linear/i],
  'customer-data':[/\bcustomer data\b|segment|cdp|event tracking/i],
  security:[/\bsecurity\b|dpa|subprocessors|soc\s*2|iso\s*27|gdpr|hipaa|trust|compliance|privacy/i] // 兜底但权重较低
};

function readCSV(fp){
  if(!fs.existsSync(fp)) return [];
  const raw=fs.readFileSync(fp,'utf8').trim(); if(!raw) return [];
  const [h,...rows]=raw.split(/\r?\n/).filter(Boolean); const head=h.split(',').map(s=>s.trim());
  return rows.map(l=>{const v=l.split(','); const o={}; head.forEach((k,i)=>o[k]=String(v[i]||'').trim()); return o;});
}
function writeCSV(fp,rows){
  const head='vendor,tag\n';
  const body=rows.map(r=>`${r.vendor},${r.tag}`).join('\n');
  fs.mkdirSync(path.dirname(fp),{recursive:true});
  fs.writeFileSync(fp, head+body+'\n','utf8');
}
function vendorsFromEvidence(){
  if(!fs.existsSync(EVID)) return [];
  return fs.readdirSync(EVID,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
}
function collectText(vendor,limit=5){
  const dir=path.join(EVID,vendor); const files=(fs.existsSync(dir)?fs.readdirSync(dir):[]).filter(f=>f.endsWith('.json')).sort().slice(-limit);
  let buff=vendor+' ';
  for(const f of files){
    try{
      const arr=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
      const items=Array.isArray(arr)?arr:[arr];
      for(const it of items){ buff += ' ' + (it.url||it.link||'') + ' ' + (it.snippet||it.fragment||it.text||''); }
    }catch{}
  }
  return buff.slice(0,40000);
}
function guessTag(text){
  let best=null,score=0;
  for(const [tag,regs] of Object.entries(RULES)){
    let s=0; for(const r of regs){ if(r.test(text)) s++; }
    if(s>score){ score=s; best=tag; }
  }
  return (score>=2)?best:null; // 置信度门槛
}

(function main(){
  const cur=readCSV(POOL); const have=new Set(cur.map(r=>`${r.vendor.toLowerCase()}::${r.tag.toLowerCase()}`));
  const seenVendor=new Set(cur.map(r=>r.vendor.toLowerCase()));
  const vs=vendorsFromEvidence();
  const append=[];
  for(const v of vs){
    if(seenVendor.has(v.toLowerCase())) continue; // 已有任意 tag 的供应商就不再猜
    const text=collectText(v);
    const tag=guessTag(text);
    if(tag && !have.has(`${v.toLowerCase()}::${tag}`)){
      append.push({vendor:v, tag});
      if(append.length>=50) break;
    }
  }
  if(!append.length){ console.log('autofill_tags: nothing to add'); return; }
  const next=[...cur, ...append];
  writeCSV(POOL,next);
  console.log(`autofill_tags: appended=${append.length}`);
})();
