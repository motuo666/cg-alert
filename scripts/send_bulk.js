const fs=require('fs'),path=require('path'),crypto=require('crypto'); const nodemailer=require('nodemailer');
const ROOT=path.join(__dirname,'..'), LEADS=path.join(ROOT,'data','leads.csv');
const SMTP_HOST=process.env.SMTP_HOST, SMTP_PORT=Number(process.env.SMTP_PORT||465), SMTP_USER=process.env.SMTP_USER, SMTP_PASS=process.env.SMTP_PASS;
const FROM={name:'CG Alert',address:'outreach@mail2.cg-alert.com'}, REPLY_TO='outreach@cg-alert.com', LIST_UNSUB='mailto:optout@cg-alert.com?subject=unsubscribe';
const DRY_RUN=String(process.env.DRY_RUN||'0')==='1';
const sha=(s)=>crypto.createHash('sha1').update(String(s)).digest()[0];
const wrap78=(s='')=>s.split('\n').map(l=>l.length<=78?l:(l.match(/.{1,78}/g)||[]).join('\n')).join('\n');
const urlCount=(t='')=>((t.match(/\bhttps?:\/\/[^\s)]+/ig))||[]).length;
function readCSV(fp){ if(!fs.existsSync(fp)) return {h:[],r:[]}; const raw=fs.readFileSync(fp,'utf8').trim(); if(!raw) return {h:[],r:[]};
  const [hrow,...rs]=raw.split(/\r?\n/).filter(Boolean); const h=hrow.split(',').map(s=>s.trim());
  const r=rs.map(l=>{const v=l.split(','); const o={}; h.forEach((k,i)=>o[k]=String(v[i]??'').trim()); return o;}); return {h,r};}
function writeCSV(fp,h,rows){ const head=h.join(',')+'\n'; const body=rows.map(x=>h.map(k=>x[k]??'').join(',')).join('\n'); fs.writeFileSync(fp, head+(rows.length?body+'\n':''),'utf8'); }
const S1_SUBJECTS=[v=>`Evidence-backed alerts for ${v.company||v.domain}`, v=>`${v.domain}: pricing/ToS changes with proof`, ()=>`Compliance-ready change alerts (DPA/Subprocessors)`];
const S1_BODIES=[v=>`Hi team,

We monitor your vendors’ public pages (Pricing/ToS/DPA/Subprocessors/Status) and deliver verifiable evidence cards with Slack/Email alerts.

• ${v.domain} — sample: https://www.cg-alert.com/updates/
• Refund: 30 days if no material alert.

Interested in a quick check?`,
v=>`Hello,

We track material changes on vendors’ public legal/pricing pages and ship evidence cards (hash, snippet, timestamp) + alerts.

Your team can stop manual page patrol; keep audit-ready.

Open to a short trial on your top vendors?`,
v=>`Hi,

Third-party changes (ToS/DPA/Subprocessors/Status) create audit risk. We send proof-backed alerts so you can act fast.

Refund if no material alert in 30 days.

Worth a look for ${v.company||v.domain}?`];

function normDomain(d,e){ let x=(d||'').toLowerCase().trim(); if(!x && e) x=e.split('@')[1]||''; x=x.replace(/^https?:\/\//,'').replace(/^www\./,'').split(/[/:]/)[0]; return x; }

async function main(){
  const {h,r}=readCSV(LEADS); if(h.length===0){console.error('leads.csv missing'); return;}
  const need=['email','company','domain','status','seq','last_touch']; need.forEach(k=>{if(!h.includes(k)) h.push(k);});
  const tr=nodemailer.createTransport({host:SMTP_HOST,port:SMTP_PORT,secure:SMTP_PORT===465,auth:{user:SMTP_USER,pass:SMTP_PASS},requireTLS:SMTP_PORT!==465,tls:{minVersion:'TLSv1.2'},logger:true,debug:true});
  if(!DRY_RUN){ await tr.verify().catch(e=>{ console.error('SMTP verify fail:', e && (e.response || e.message || e)); process.exit(1); }); }
  const now=new Date().toISOString(); const out=[];
  for(const lead of r){
    const email=(lead.email||'').toLowerCase(); const company=lead.company||''; const domain=normDomain(lead.domain||'', email);
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ lead.status='invalid'; lead.last_touch=now; out.push(lead); continue; }
    if(['optout','invalid'].includes((lead.status||'').toLowerCase())){ out.push(lead); continue; }
    const sub=S1_SUBJECTS[sha(email)%S1_SUBJECTS.length]({company,domain});
    const body=S1_BODIES[sha(email+'b')%S1_BODIES.length]({company,domain});
    if(urlCount(body)>3){ out.push(lead); continue; }
    try{
      if(!DRY_RUN){
        await tr.sendMail({ from:FROM, to:email, replyTo:REPLY_TO, subject:sub, text:wrap78(body),
          headers:{'List-Unsubscribe':`<mailto:optout@cg-alert.com?subject=unsubscribe>`,'Auto-Submitted':'auto-generated'} });
        await new Promise(r=>setTimeout(r,1200+Math.random()*800));
      }
      lead.seq=lead.seq||'s1'; lead.last_touch=now; lead.status=lead.status||'sent';
    }catch(e){
      const code=(e && (e.responseCode || e.code)) || 'send-failed';
      lead.status=`err:${code}`; lead.last_touch=now; console.error(`send fail ${email}:`, e && (e.response || e.message || e));
    }
    out.push(lead);
  }
  writeCSV(LEADS, h, out);
}
main().catch(e=>{console.error(e); process.exit(1);});
