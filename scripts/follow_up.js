// scripts/follow_up.js
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL,
  SLACK_WEBHOOK_URL,
  MAX_SEND_PER_RUN = '25',
  MIN_DELAY_SEC = '45',
  MAX_DELAY_SEC = '90',
  PER_DOMAIN_CAP = '2',
  DAYS_SINCE_S1 = '4',
  DRY_RUN = '',
} = process.env;

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function domainOf(email){ return (email.split('@')[1]||'').toLowerCase().trim(); }
async function postSlack(text){ if(!SLACK_WEBHOOK_URL) return; try{ await fetch(SLACK_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})}); }catch{} }
function daysBetween(iso){ if(!iso) return 999; const t=new Date(iso).getTime(); return Math.floor((Date.now()-t)/(1000*3600*24)); }

const leadsPath = path.join(__dirname,'..','data','leads.csv');
const logsDir = path.join(__dirname,'..','logs'); if(!fs.existsSync(logsDir)) fs.mkdirSync(logsDir,{recursive:true});
const logPath = path.join(logsDir, `followup-${new Date().toISOString().slice(0,10)}.jsonl`);

function subject2(company){ return `Quick follow-up on vendor change alerts for ${company}`; }
function body2(company){
  return [
    `Hi ${company} team,`,
    ``,
    `Circling back on vendor change alerts (pricing, ToS/DPA, subprocessors).`,
    `I can share a 30-day snapshot for your top vendors as evidence cards (URL + snippet + timestamp + hash).`,
    `If not a fit, reply "No" and I’ll stop.`,
    ``,
    `— CG Alert`,
    `https://www.cg-alert.com/`,
  ].join('\n');
}

async function main(){
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !FROM_EMAIL) { console.error('Missing SMTP envs'); process.exit(1); }
  const rows = parse(fs.readFileSync(leadsPath,'utf8'), { columns:true, skip_empty_lines:true });

  const candidates = rows.filter(r=>{
    const st = (r.status||'').toLowerCase();
    const seq = (r.seq||'').toUpperCase();
    const noGo = ['replied','optout','bounced','invalid','error'].includes(st);
    return !noGo && seq==='S1' && daysBetween(r.last_touch)>=Number(DAYS_SINCE_S1);
  });

  const transporter = nodemailer.createTransport({ host:SMTP_HOST, port:Number(SMTP_PORT||587), secure:false, auth:{user:SMTP_USER, pass:SMTP_PASS} });
  const domainCount = {}; let sent=0, skipped=0, errors=0;

  for (const row of candidates){
    if (sent>=Number(MAX_SEND_PER_RUN)) break;
    const to=(row.email||'').trim(); if(!to || !to.includes('@')){ skipped++; continue; }
    if (String(row.mx_ok||'').toLowerCase()==='false'){ skipped++; continue; }
    const d = domainOf(to); domainCount[d]=domainCount[d]||0; if (domainCount[d]>=Number(PER_DOMAIN_CAP)){ skipped++; continue; }

    const company = row.company || row.domain || 'your team';
    const mail = {
      from: FROM_EMAIL, to, subject: subject2(company), text: body2(company),
      headers: {
        'List-Unsubscribe': `<mailto:${FROM_EMAIL}?subject=unsubscribe>`,
        'In-Reply-To': row.message_id || undefined,
        'References': row.message_id || undefined,
        'X-CG-Track': `lead:${row.domain||row.company||''};seq:S2`,
        'Precedence': 'bulk',
      }
    };

    try{
      if (DRY_RUN) console.log('[DRY_RUN] S2 would send to', to);
      else await transporter.sendMail(mail);

      row.status='sent'; row.seq='S2'; row.last_touch=new Date().toISOString();
      domainCount[d]+=1; sent++;
      fs.appendFileSync(logPath, JSON.stringify({ to, ts: row.last_touch, seq:'S2' })+'\n');
      await sleep(randInt(Number(MIN_DELAY_SEC), Number(MAX_DELAY_SEC))*1000);
    }catch(e){
      errors++; row.status='error';
      row.notes=(row.notes||'')+` | s2_error:${e.message}`;
      fs.appendFileSync(logPath, JSON.stringify({ to, error:e.message, ts:new Date().toISOString(), seq:'S2' })+'\n');
      await sleep(3000);
    }
  }

  fs.writeFileSync(leadsPath, stringify(rows,{header:true}), 'utf8');
  const summary = `Outreach S2: sent=${sent}, skipped=${skipped}, errors=${errors}`; console.log(summary); await postSlack(summary);
}
main().catch(async e=>{ console.error(e); await postSlack(`Outreach S2 failed: ${e.message}`); process.exit(1); });
