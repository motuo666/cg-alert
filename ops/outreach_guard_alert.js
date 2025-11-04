#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const SRC = path.join('reports','metrics','daily.json');
const POL = path.join('config','volume_policy.json');
const webhook = process.env.SLACK_WEBHOOK_URL || process.env.SLACK_WEBHOOK;
function postSlack(text){
  if(!webhook){ console.log('no slack webhook, skip'); return; }
  const {execSync} = require('child_process');
  try{
    execSync(`curl -s -X POST -H 'Content-type: application/json' --data ${JSON.stringify(JSON.stringify({text}))} '${webhook}'`, {stdio:'inherit'});
  }catch(e){ console.log('slack failed', e.message); }
}
let min = 10;
try { min = JSON.parse(fs.readFileSync(POL,'utf8')).min || 10; } catch{}
if(!fs.existsSync(SRC)){ console.log('no daily.json, skip'); process.exit(0); }
let arr = JSON.parse(fs.readFileSync(SRC,'utf8'));
if(!Array.isArray(arr)){ arr = Object.keys(arr).sort().map(k=>Object.assign({date:k}, arr[k])); }
arr = arr.slice(-10);
const last3 = arr.slice(-3);
const sent3 = last3.map(d=>Number(d.sent24||d.sent||0));
const open3 = last3.map(d=>Number(d.open24||d.open||0));
const reply3= last3.map(d=>Number(d.reply24||d.reply||0));
const bounce3= last3.map(d=>Number(d.bounce24||d.bounce||0));
const below = sent3.every(v => v <= min + 2);
const unhealthy = (bounce3.reduce((a,b)=>a+b,0)/Math.max(sent3.reduce((a,b)=>a+b,0),1)) > 0.03;
console.log('min', min, 'sent3', sent3, 'below?', below, 'unhealthy?', unhealthy);
if(below){
  const t = `⚠️ Outreach Guard: 连续3天 ~min(${min}) 档运行。\n`+
            `sent3=${sent3.join('/')}  open3=${open3.join('/')}  reply3=${reply3.join('/')}  bounce3=${bounce3.join('/')}\n`+
            `建议：检查 KV 画像/黑名单、扩大 Autopilot 扩面、核对发信别名轮转；健康异常则先压档。`;
  postSlack(t);
}
if(unhealthy){
  const t = `🚨 Outreach Health: 3日加权退信>3%。\n`+
            `sent3=${sent3.join('/')}  bounce3=${bounce3.join('/')}\n`+
            `已建议系统自动压档；请检查退信域，确认 Auto-Blacklist 是否更新。`;
  postSlack(t);
}