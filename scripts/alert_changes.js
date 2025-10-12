#!/usr/bin/env node
// alert_changes.js — push Slack alert when new evidence landed in last 24h
const fs=require('fs'), path=require('path'); const { post } = require('./lib/slack_notify');
const SLACK=process.env.SLACK_WEBHOOK || process.env.SLACK_WEBHOOK_URL || '';
(function main(){
  const base='evidence', min=Date.now()-24*3600e3; let n=0;
  if(fs.existsSync(base)){ for(const d of fs.readdirSync(base,{withFileTypes:true})){ if(!d.isDirectory()) continue; for(const f of fs.readdirSync(path.join(base,d.name))){ if(!/\.json$/i.test(f)) continue; const st=fs.statSync(path.join(base,d.name,f)); if(st.mtimeMs>=min) n++; } } }
  const msg = `New evidence last 24h: ${n}`; console.log(msg); if(SLACK) post(SLACK, msg);
})();