// 规范化：去空行/去重复/修剪空白；不改字段含义，不大小写转换（避免破坏 vendor 目录匹配）
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..'); const DAT=path.join(ROOT,'data');
const files=['domain_pool.csv','vendor_tags_pool.csv','domains.csv','vendor_tags.csv','leads.csv'];
function norm(fp,pk){
  if(!fs.existsSync(fp)) return false;
  const raw=fs.readFileSync(fp,'utf8').trim(); if(!raw) return false;
  const rows=raw.split(/\r?\n/).filter(Boolean); const head=rows.shift();
  const keys=head.split(',').map(s=>s.trim()); const idx=keys.reduce((m,k,i)=> (m[k]=i,m),{});
  const seen=new Set(); const out=[];
  for(const line of rows){
    const cols=line.split(','); if(cols.length===0) continue;
    // 修剪
    for(let i=0;i<cols.length;i++) cols[i]=String(cols[i]||'').trim();
    // 主键
    const key=(pk.map(k=>cols[idx[k]]||'').join('::')).toLowerCase();
    if(seen.has(key)) continue; seen.add(key);
    out.push(cols.map((c,i)=>c).join(','));
  }
  const next=head+'\n'+out.join('\n')+'\n';
  if(next!==raw+'\n'){ fs.writeFileSync(fp,next,'utf8'); return true; }
  return false;
}
(function main(){
  let changed=false;
  changed |= norm(path.join(DAT,'domain_pool.csv'),['domain']);
  changed |= norm(path.join(DAT,'vendor_tags_pool.csv'),['vendor','tag']);
  changed |= norm(path.join(DAT,'domains.csv'),['domain']);
  changed |= norm(path.join(DAT,'vendor_tags.csv'),['vendor','tag']);
  changed |= norm(path.join(DAT,'leads.csv'),['email']);
  console.log('csv_normalize: changed=',changed);
})();
