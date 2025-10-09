const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const nodemailer = require('nodemailer');

const DRY = process.env.DRY_RUN === '1';
const CAP = Number(process.env.S1_DAILY_CAP || 40);
const leadsPath = 'data/leads.csv';
const logPath = 'data/outreach_log.csv';
const tmplPath = 'templates/s1.md';

function ensureFile(p, head){ if(!fs.existsSync(p)) fs.writeFileSync(p, head + '\n'); }
ensureFile(leadsPath, 'email,company,domain,vendor1,vendor2,vendor3');
ensureFile(logPath, 'ts,email,stage,result,msg');

const leads = parse(fs.readFileSync(leadsPath), { columns: true, skip_empty_lines: true });
const log = parse(fs.readFileSync(logPath), { columns: true, skip_empty_lines: true });

const sentS1 = new Set(log.filter(r=>r.stage==='S1' && r.result==='OK').map(r=>r.email.toLowerCase()));
const batch = [];
for(const r of leads){
  const e = (r.email||'').toLowerCase().trim();
  if(!e || sentS1.has(e)) continue;
  batch.push(r);
  if(batch.length>=CAP) break;
}
if(batch.length===0){ console.log('No S1 targets. Exit.'); process.exit(0); }

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT||587)===465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const from = `${process.env.FROM_NAME || 'CG Alert'} <${process.env.FROM_EMAIL}>`;
const replyTo = process.env.REPLY_TO || process.env.FROM_EMAIL;
const fallback = `Hi {{company}} team,

We track public changes for {{vendor1}}, {{vendor2}}, {{vendor3}} and provide verifiable evidence cards (Pricing/ToS/DPA/Subprocessors/Status).
2-min overview → https://www.cg-alert.com/`;
const tmpl = fs.existsSync(tmplPath) ? fs.readFileSync(tmplPath,'utf8') : fallback;

function render(t, r){
  return t.replaceAll('{{company}}', r.company||'')
          .replaceAll('{{vendor1}}', r.vendor1||'')
          .replaceAll('{{vendor2}}', r.vendor2||'')
          .replaceAll('{{vendor3}}', r.vendor3||'');
}

(async ()=>{
  const rows=[];
  for(const r of batch){
    const to = r.email.trim();
    const subject = `Evidence-backed alerts for ${r.vendor1 || r.domain}`;
    const text = render(tmpl, r);
    try{
      if(!DRY) await transporter.sendMail({ from, to, replyTo, subject, text });
      rows.push({ts:new Date().toISOString(),email:to,stage:'S1',result:'OK',msg:''});
      console.log('Sent S1 ->', to);
      await new Promise(res=>setTimeout(res,3000));
    }catch(e){
      rows.push({ts:new Date().toISOString(),email:to,stage:'S1',result:'ERR',msg:String(e).slice(0,200)});
      console.error('ERR S1 ->', to, e.message);
      await new Promise(res=>setTimeout(res,1000));
    }
  }
  fs.appendFileSync(logPath, stringify(rows, {header:false}));
})();
