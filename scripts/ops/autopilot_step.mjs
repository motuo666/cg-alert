
import { spawn } from 'node:child_process';
function sh(cmd, args){ return new Promise((res,rej)=>{ const p=spawn(cmd,args,{stdio:'inherit'}); p.on('exit',c=>c===0?res():rej(new Error(`${cmd} ${args.join(' ')} -> ${c}`))); }); }
async function main(){
  await sh('node',['scripts/target_discovery.mjs']);
  const alsoBuild = (process.env.ALSO_BUILD||'false').toLowerCase()==='true';
  if (alsoBuild){ await sh('node',['scripts/build_sitemap.mjs']); await sh('node',['scripts/render_evidence_pages.mjs']); await sh('node',['scripts/evidence_to_rss.mjs']); }
}
main().catch(e=>{ console.error(e); process.exit(1); });
