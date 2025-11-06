import fs from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SEND_LIMIT = parseInt(process.env.SEND_LIMIT || '12', 10);

if(!SMTP_HOST || !SMTP_USER || !SMTP_PASS){
  console.error('Missing SMTP_* env');
  process.exit(1);
}

const leadsCsv = path.join(process.cwd(),'data','leads.csv');
const unsubJson = path.join(process.cwd(),'suppression','unsub.json');

function parseCSV(text){
  const lines = text.split(/\r?\n/).filter(Boolean);
  const hdr = lines.shift().split(',').map(s=>s.trim());
  return lines.map(l=>{
    const cols = l.split(',').map(s=>s.trim());
    const obj = {}; hdr.forEach((h,i)=>obj[h]=cols[i]||''); return obj;
  });
}

async function loadLeads(){
  try{ return parseCSV(await fs.readFile(leadsCsv,'utf8')); }catch{ return []; }
}
async function loadUnsub(){
  try{ const j = JSON.parse(await fs.readFile(unsubJson,'utf8')); return new Set(j.unsub||[]); }catch{ return new Set(); }
}

async function main(){
  const unsub = await loadUnsub();
  const leads = (await loadLeads()).filter(x=>x.email && !unsub.has(x.email.toLowerCase()));
  if(leads.length === 0){ console.log('no leads to send'); return; }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: 587, secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  let sent = 0;
  for(const lead of leads){
    if(sent >= SEND_LIMIT) break;
    const to = lead.email;
    const subj = `[CG Alert] Evidence-backed vendor change monitoring for ${lead.company || 'your team'}`;
    const body = `Hi ${lead.name || ''},
We monitor pricing/ToS/DPA/Subprocessors for your named vendors and deliver evidence cards (timestamp + hash) by email/Slack.
Reply with your top 3 vendors and we will set them up.
– CG Alert`;
    try{
      await transporter.sendMail({
        from: SMTP_USER,
        to, subject: subj, text: body
      });
      sent++;
    }catch(e){ /* ignore per-recipient errors */ }
  }
  console.log('sent', sent);
}

main().catch(e=>{ console.error(e); process.exit(1); });
