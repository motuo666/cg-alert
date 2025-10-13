#!/usr/bin/env node
// send_triggered.js — 触发式：仅在 48h 有证据时发；动态主题/正文；历史抑制（7天）；日上限 20
const fs=require('fs'), path=require('path'), nodemailer=require('nodemailer'), crypto=require('crypto');
const argv=require('minimist')(process.argv.slice(2),{boolean:['dry'],string:['limit','window-h'],default:{dry:true,limit:'20','window-h':'48'}});
const { SMTP_HOST, SMTP_PORT=587, SMTP_USER, SMTP_PASS, MAIL_FROM, BCC_TO } = process.env;

function read(p,def=''){ try{return fs.readFileSync(p,'utf8');}catch{return def;} }
function lines(p){ return read(p).split(/\r?\n/).filter(Boolean); }
function parseLead(row){ const a=row.split(','); if(a.length<9) return null;
  return { email:a[0].trim().toLowerCase(), company:a[1].trim(), domain:a[2].trim(), vendors:[a[3],a[4],a[5]].map(s=>s.trim()).filter(Boolean), persona:a[6].trim(), status:a[7].trim(), mx_ok:a[8].trim()==='1' };
}
function leads(){ const arr=(lines(path.join('data','leads.csv'))).map(parseLead).filter(Boolean);
  return arr.filter(x=>x.mx_ok && x.status==='new');
}
function vendorsURL(slug){ const p=path.join('vendors',slug,'index.html'); if(fs.existsSync(p)) return `https://www.cg-alert.com/vendors/${encodeURIComponent(slug)}/`; return `https://www.cg-alert.com/updates/?utm=outreach_s1`; }
function sampleURLForLead(lead){ for(const slug of lead.vendors){ const url=vendorsURL(slug); if(url) return url; } return `https://www.cg-alert.com/updates/?utm=outreach_s1`; }
function personalize(html, lead){ return html.replace(/\{\{company\}\}/g, lead.company||'your team').replace(/\{\{sample_url\}\}/g, sampleURLForLead(lead)); }
function subjectFor(type){ return `Heads-up: ${type} changed on a vendor you track`; }
function freshVendors(windowH){
  const base='evidence', recent=new Set(); const min=Date.now()-Number(windowH)*3600e3;
  if(!fs.existsSync(base)) return recent;
  for(const d of fs.readdirSync(base,{withFileTypes:true})){ if(!d.isDirectory()) continue; const slug=d.name;
    for(const f of fs.readdirSync(path.join(base,slug))){ if(!/\.json$/i.test(f)) continue;
      const st=fs.statSync(path.join(base,slug,f)); if(st.mtimeMs>=min) recent.add(slug);
    }
  } return recent;
}
function suppressSet(days=7){ const f='data/sent_recipients.csv'; if(!fs.existsSync(f)) return new Set(); const min=Date.now()-days*24*3600e3;
  const S=new Set(); for(const l of lines(f)){ const [email,ts]=l.split(','); if(Number(ts)>=min) S.add(email.toLowerCase()); } return S;
}
function appendRecipients(list){ const f='data/sent_recipients.csv'; const ts=Date.now(); fs.appendFileSync(f, list.map(e=>`${e},${ts}`).join('\n')+'\n','utf8'); }

(async function main(){
  const dry=argv.dry!==false && String(argv.dry)!=='false';
  const limit=Math.max(1, Number(argv.limit||'20'));
  const recent=freshVendors(Number(argv['window-h']||'48'));
  if(recent.size===0){ console.log('no fresh evidence → skip'); process.exit(0); }
  const all=leads().filter(l=> l.vendors.some(v=>recent.has(v)));
  const sup=suppressSet(7);
  const queue=all.filter(l=>!sup.has(l.email)).slice(0, limit);
  if(queue.length===0){ console.log('no eligible leads'); process.exit(0); }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT), secure: Number(SMTP_PORT)==465,
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    pool:true, maxConnections:2, maxMessages:50, rateLimit:120
  });

  const subjTpl = read('data/s1_subject.txt','Heads-up: vendor changes you care about');
  const htmlTpl = read('data/s1.html','<p>Hi, {{company}} — here is a sample: {{sample_url}}</p>');

  const sent=[];
  for(const lead of queue){
    const html = personalize(htmlTpl, lead);
    const subject = subjTpl || subjectFor('Public page');
    const to = lead.email;
    const msg = { from: MAIL_FROM, to, subject, html, headers: { 'List-Unsubscribe': `<mailto:${MAIL_FROM}?subject=unsubscribe>` } };
    if(BCC_TO) msg.bcc=BCC_TO;
    if(dry){ console.log('[dry] send:', to); } else { await transporter.sendMail(msg); }
    sent.push(to);
  }
  appendRecipients(sent);
  console.log(`triggered sent=${sent.length}/${limit}, dry=${dry}`);
})();
