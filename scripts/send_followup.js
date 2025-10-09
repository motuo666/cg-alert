const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const nodemailer = require('nodemailer');

const DRY = process.env.DRY_RUN === '1';
const leadsPath = 'data/leads.csv';
const logPath = 'data/outreach_log.csv';
const optPath = 'data/optouts.csv';
const tmplPath = 'templates/s2.md';

function ensureFile(p, head){ if(!fs.existsSync(p)) fs.writeFileSync(p, head + '\n'); }
ensureFile(logPath, 'ts,email,stage,result,msg');

const leads = parse(fs.readFileSync(leadsPath), { columns: true, skip_empty_lines: true });
const log = parse(fs.readFileSync(logPath), { columns: true, skip_empty_lines: true });
const opted = new Set(fs.existsSync(optPath) ? parse(fs.readFileSync(optPath), {columns:true}).map(r=>(r.email||'').toLowerCase()) : []);

const s1ok = new Set(log.filter(r=>r.stage==='S1' && r.result==='OK').map(r=>r.email.toLowerCase()));
const s2ok = new Set(log.filter(r=>r.stage==='S2' && r.result==='OK').map(r=>r.email.toLowerCase()));
const cands = leads.filter(r=>{
  const e=(r.email||'').toLowerCase();
  return e && s1ok.has(e) && !s2ok.has(e) && !opted.has(e);
});
if(cands.length===0){ console.log('No S2 targets. Exit.'); process.exit(0); }

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT||587)===465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const from = `${process.env.FROM_NAME || 'CG Alert'} <${process.env.FROM_EMAIL}>`;
const replyTo = process.env.REPLY_TO || process.env.FROM_EMAIL;
const fallback = `Quick follow-up on supplier change alerts for {{vendor1}} / {{vendor2}}.
Overview → https://www.cg-alert.com/`;
const tmpl = fs.existsSync(tmplPath) ? fs.readFileSync(tmplPath,'utf8') : fallback;

function render(t, r){
  return t.replaceAll('{{vendor1}}', r.vendor1||'').replaceAll('{{vendor2}}', r.vendor2||'');
}

(async ()=>{
  const rows=[];
  for(const r of cands){
    const to = r.email.trim();
    const subject = `Circling back on ${r.vendor1 || 'your vendors'}`;
    const text = render(tmpl, r);
    try{
      if(!DRY) await transporter.sendMail({ from, to, replyTo, subject, text });
      rows.push({ts:new Date().toISOString(),email:to,stage:'S2',result:'OK',msg:''});
      console.log('Sent S2 ->', to);
      await new Promise(res=>setTimeout(res,3000));
    }catch(e){
      rows.push({ts:new Date().toISOString(),email:to,stage:'S2',result:'ERR',msg:String(e).slice(0,200)});
      console.error('ERR S2 ->', to, e.message);
      await new Promise(res=>setTimeout(res,1000));
    }
  }
  fs.appendFileSync(logPath, stringify(rows, {header:false}));
})();
