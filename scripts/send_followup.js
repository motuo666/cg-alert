// scripts/send_followup.js — S2 跟进（仅 seq=='s1' 且已过阈值天数，未退订/无硬退）
// 依赖：node18 + nodemailer
const fs=require('fs'),path=require('path'),crypto=require('crypto'),dns=require('dns').promises;
const nodemailer=require('nodemailer'); const ROOT=path.join(__dirname,'..'); const LEADS=path.join(ROOT,'data','leads.csv');

const SMTP_HOST=process.env.SMTP_HOST, SMTP_PORT=Number(process.env.SMTP_PORT||465),
      SMTP_USER=process.env.SMTP_USER, SMTP_PASS=process.env.SMTP_PASS;

const DAYS_SINCE_S1 = Number(process.env.S2_AFTER_DAYS || 7); // 跟进间隔（天）
const FROMS=[{name:'CG Alert',address:'outreach@mail.cg-alert.com'}, {name:'CG Alert',address:'outreach@mail2.cg-alert.com'}];
const REPLY_TO='outreach@cg-alert.com'; const LIST_UNSUB='mailto:optout@cg-alert.com?subject=unsubscribe';

const h=(s)=>crypto.createHash('sha1').update(String(s)).digest()[0]; const pickFrom=(e)=>FROMS[h(e)%FROMS.length];
const wrap78=(s='')=>s.split('\n').map(l=>l.length<=78?l:(l.match(/.{1,78}/g)||[]).join('\n')).join('\n');
const linkCount=(t='')=>((t.match(/\bhttps?:\/\/[^\s)]+/ig))||[]).length;
const daysAgo=(d)=>{ const t=Date.parse(d||''); return isNaN(t)?Infinity: (Date.now()-t)/86400000; };

function readCSV(fp){ if(!fs.existsSync(fp))return{header:[],rows:[]}; const raw=fs.readFileSync(fp,'utf8').trim(); if(!raw) return{header:[],rows:[]};
  const [hrow,...rs]=raw.split(/\r?\n/).filter(Boolean); const header=hrow.split(',').map(s=>s.trim());
  const rows=rs.map(l=>{const v=l.split(','); const o={}; header.forEach((k,i)=>o[k]=String(v[i]??'').trim()); return o;}); return {header,rows};}
function writeCSV(fp,header,rows){ const head=header.join(',')+'\n'; const body=rows.map(r=>header.map(k=>r[k]??'').join(',')).join('\n'); fs.writeFileSync(fp, head+(rows.length?body+'\n':''),'utf8'); }
async function hasMX(domain){ try{ const mx=await dns.resolveMx(domain); return Array.isArray(mx)&&mx.length>0; }catch{ return false; } }

// S2 模板（克制、简短、纯文本 ≤3 链接）
const S2_SUBJECTS=[
  v=>`Quick nudge: proof-backed vendor change alerts`,
  v=>`Following up: ${v.company||v.domain} vendor change evidence`,
  v=>`Last ping — audit-ready change alerts`
];
const S2_BODIES=[
  v=>`Hi again,

Circling back on proof-backed alerts for your vendors' Pricing/ToS/DPA/Subprocessors/Status pages.
We ship evidence cards (hash, snippet, timestamp) + Slack/Email alerts.

30-day refund if no material alert.

Open to a brief pilot on your top vendors?`,
  v=>`Hello,

Just checking if ${v.company||v.domain} wants automated, verifiable alerts on vendor legal/pricing pages.
Stops manual page patrol; keeps you audit-ready.

Happy to enable a short run on 5–10 vendors.`,
  v=>`Hi,

Last note from me — we can monitor your vendors’ public changes and deliver evidence cards on each material change.
Refund if no material alert in 30 days.

Worth a try?`
];

(async function main(){
  const {header,rows}=readCSV(LEADS); if(header.length===0){console.error('leads.csv missing'); return;}
  const need=['email','company','domain','status','seq','last_touch']; need.forEach(c=>{if(!header.includes(c)) header.push(c);});
  const idx=Object.fromEntries(header.map((k,i)=>[k,i]));
  const tr=nodemailer.createTransport({host:SMTP_HOST,port:SMTP_PORT,secure:SMTP_PORT===465,auth:{user:SMTP_USER,pass:SMTP_PASS}});
  const nowISO=new Date().toISOString(); const updated=[];

  for(const lead of rows){
    const email=(lead.email||'').toLowerCase(), domain=(lead.domain||'').toLowerCase();
    const status=(lead.status||'').toLowerCase(), seq=(lead.seq||'').toLowerCase();
    // 只给：已发过 S1、距上次触达>=阈值天、且未退订/无硬退/非坏MX 的人发 S2
    if(status==='optout' || status==='invalid' || status==='bad-mx') { updated.push(lead); continue; }
    if(seq!=='s1') { updated.push(lead); continue; }
    if(daysAgo(lead.last_touch) < DAYS_SINCE_S1) { updated.push(lead); continue; }
    if(!(await hasMX(domain))){ lead.status='bad-mx'; lead.last_touch=nowISO; updated.push(lead); continue; }

    const sIdx=h(email+'s2')%S2_SUBJECTS.length, bIdx=h(email+'s2b')%S2_BODIES.length;
    const subject=S2_SUBJECTS[sIdx](lead), bodyRaw=S2_BODIES[bIdx](lead);
    if(linkCount(bodyRaw)>3){ updated.push(lead); continue; }

    await tr.sendMail({ from:pickFrom(email), to:email, replyTo:REPLY_TO, subject,
      text:wrap78(bodyRaw),
      headers:{'List-Unsubscribe':`<${LIST_UNSUB}>`,'Auto-Submitted':'auto-generated','X-Entity-Ref-ID':`${Date.now()}-${Math.random().toString(36).slice(2)}`}});
    await new Promise(r=>setTimeout(r,1200+Math.random()*800));

    lead.seq='s2'; lead.last_touch=nowISO; lead.status=lead.status||'sent';
    updated.push(lead);
  }
  writeCSV(LEADS, header, updated);
})();
