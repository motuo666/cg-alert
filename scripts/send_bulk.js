// 最优投递：双子域分流 + 主题/首句 A/B + 退场过滤 + MX 预检（Node 18）
const fs=require('fs'),path=require('path'),crypto=require('crypto'),dns=require('dns').promises;
const nodemailer=require('nodemailer'); const ROOT=path.join(__dirname,'..'); const LEADS=path.join(ROOT,'data','leads.csv');

const SMTP_HOST=process.env.SMTP_HOST, SMTP_PORT=Number(process.env.SMTP_PORT||465),
      SMTP_USER=process.env.SMTP_USER, SMTP_PASS=process.env.SMTP_PASS;

const FROMS=[{name:'CG Alert',address:'outreach@mail.cg-alert.com'}, {name:'CG Alert',address:'outreach@mail2.cg-alert.com'}];
const REPLY_TO='outreach@cg-alert.com'; const LIST_UNSUB='mailto:optout@cg-alert.com?subject=unsubscribe';

const h=(s)=>crypto.createHash('sha1').update(String(s)).digest()[0]; const pickFrom=(e)=>FROMS[h(e)%FROMS.length];
const wrap78=(s='')=>s.split('\n').map(l=>l.length<=78?l:(l.match(/.{1,78}/g)||[]).join('\n')).join('\n');
const linkCount=(t='')=>((t.match(/\bhttps?:\/\/[^\s)]+/ig))||[]).length;

function readCSV(fp){ if(!fs.existsSync(fp))return{header:[],rows:[]}; const raw=fs.readFileSync(fp,'utf8').trim(); if(!raw) return{header:[],rows:[]};
  const [hrow,...rs]=raw.split(/\r?\n/).filter(Boolean); const header=hrow.split(',').map(s=>s.trim());
  const rows=rs.map(l=>{const v=l.split(','); const o={}; header.forEach((k,i)=>o[k]=String(v[i]??'').trim()); return o;}); return {header,rows};}
function writeCSV(fp,header,rows){ const head=header.join(',')+'\n'; const body=rows.map(r=>header.map(k=>r[k]??'').join(',')).join('\n'); fs.writeFileSync(fp, head+(rows.length?body+'\n':''),'utf8'); }

async function hasMX(domain){ try{ const mx=await dns.resolveMx(domain); return Array.isArray(mx)&&mx.length>0; }catch{ return false; } }

// A/B 模板（不改你文案，只做选择器）
const S1_SUBJECTS=[ v=>`Evidence-backed alerts for ${v.company||v.domain}`,
  v=>`${v.domain}: pricing/ToS changes with proof`, v=>`Compliance-ready change alerts (DPA/Subprocessors)` ];
const S1_BODIES=[ v=>`Hi team,

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

Worth a look for ${v.company||v.domain}?` ];

async function main(){
  const {header,rows}=readCSV(LEADS); if(header.length===0){console.error('leads.csv missing');return;}
  const need=['email','company','domain','status','seq','last_touch']; need.forEach(c=>{if(!header.includes(c)) header.push(c);});
  const tr=nodemailer.createTransport({host:SMTP_HOST,port:SMTP_PORT,secure:SMTP_PORT===465,auth:{user:SMTP_USER,pass:SMTP_PASS}});
  const nowISO=new Date().toISOString(), updated=[];
  for(const lead of rows){
    const email=(lead.email||'').toLowerCase(), domain=(lead.domain||'').toLowerCase(), status=(lead.status||'').toLowerCase();
    if(['optout','invalid','bad-mx'].includes(status)) { updated.push(lead); continue; }
    if(!(await hasMX(domain))){ lead.status='bad-mx'; lead.last_touch=nowISO; updated.push(lead); continue; }

    const sIdx=h(email)%S1_SUBJECTS.length, bIdx=h(email+'b')%S1_BODIES.length;
    const subject=S1_SUBJECTS[sIdx](lead), bodyRaw=S1_BODIES[bIdx](lead);
    if(linkCount(bodyRaw)>3){ updated.push(lead); continue; }

    await tr.sendMail({ from:pickFrom(email), to:email, replyTo:REPLY_TO, subject,
      text:wrap78(bodyRaw),
      headers:{'List-Unsubscribe':`<${LIST_UNSUB}>`,'Auto-Submitted':'auto-generated','X-Entity-Ref-ID':`${Date.now()}-${Math.random().toString(36).slice(2)}`}});
    await new Promise(r=>setTimeout(r,1200+Math.random()*800)); // 1.2–2.0s/封

    lead.seq = lead.seq || 's1'; lead.last_touch=nowISO; lead.status=lead.status||'sent'; updated.push(lead);
  }
  writeCSV(LEADS, header, updated);
}
main().catch(e=>{console.error(e);process.exit(1);});
