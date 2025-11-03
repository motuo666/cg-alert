#!/usr/bin/env node
const fs=require('fs');
function env(k,d=''){const v=process.env[k];return (v===undefined||v===null||v==='')?d:String(v);}
function loadJSON(p, def){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch{ return def; } }
const kpi=loadJSON('artifacts/kpi_guard.json',{sent7:0,complaints:0,bounces:0,unsub:0,complaintRate:0,breach:{}});
const policy=loadJSON('config/volume_policy.json',{
  base:20,step:10,max:60,min:10,
  guard:{unsub7:3,complaintRate:0.1,bounce7:8},
  soft:{complaintRate:0.07,bounce7:5}
});
const targetEnv=parseInt(env('TARGET_SENT',policy.base),10);
let limit=Math.max(policy.min,Math.min(targetEnv,policy.max));
let reason=`start=${limit}`;
if(kpi.complaintRate>policy.guard.complaintRate||kpi.bounces>policy.guard.bounce7||kpi.unsub>policy.guard.unsub7){
  limit=policy.min; reason+=` | hard-guard → ${limit}`;
}else{
  if(kpi.complaintRate>policy.soft.complaintRate){ limit=Math.max(policy.min,limit-policy.step); reason+=` | soft-complaint ↓ → ${limit}`; }
  if(kpi.bounces>policy.soft.bounce7){ limit=Math.max(policy.min,limit-policy.step); reason+=` | soft-bounce ↓ → ${limit}`; }
  if(kpi.sent7<100 && kpi.complaintRate<0.05 && kpi.bounces<=2){ limit=Math.min(policy.max,limit+policy.step); reason+=` | low-vol healthy ↑ → ${limit}`; }
}
const out=process.env.GITHUB_OUTPUT||''; const txt=`limit=${limit}\nreason=${reason}\n`;
if(out) fs.appendFileSync(out, txt); console.log(txt);
