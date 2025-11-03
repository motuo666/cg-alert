#!/usr/bin/env node
const fs=require('fs'), path=require('path'), cp=require('child_process'), crypto=require('crypto');
function walk(root){ const out=[]; if(!fs.existsSync(root)) return out;
  for(const vendor of fs.readdirSync(root)){ const vp=path.join(root,vendor); if(!fs.statSync(vp).isDirectory()) continue;
    for(const d of fs.readdirSync(vp)){ const dp=path.join(vp,d); if(/^\d{4}-\d{2}-\d{2}$/.test(d) && fs.statSync(dp).isDirectory()) out.push({vendor,date:d,dir:dp}); }
  } return out;
}
function sha256(p){ return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
const ROOT=process.cwd(), EVID=path.join(ROOT,'public','evidence');
const items = walk(EVID); let built=0;
for(const it of items){
  const files = fs.readdirSync(it.dir).filter(f=>fs.statSync(path.join(it.dir,f)).isFile());
  if(!files.length) continue;
  const manifest = { vendor: it.vendor, date: it.date, files: files.map(f=>({ name:f, sha256:sha256(path.join(it.dir,f)) })) };
  fs.writeFileSync(path.join(it.dir,'manifest.json'), JSON.stringify(manifest,null,2));
  try{ cp.execSync(`zip -r -q bundle.zip .`, {cwd: it.dir}); built++; }catch(e){ console.log('zip failed for', it.dir, e.message); }
}
if(built){
  try{
    cp.execSync('git add public/evidence/**/manifest.json public/evidence/**/bundle.zip', {stdio:'inherit'});
    cp.execSync('git -c user.email=bot@cg-alert.com -c user.name=cg-alert-bot commit -m "evidence: add manifest + bundle.zip"');
    cp.execSync('git push', {stdio:'inherit'});
  }catch{}
}
console.log('bundles built:', built);
