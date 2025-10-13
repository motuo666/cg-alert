#!/usr/bin/env node
// send_bulk.js — 稳定 S1：池化/限速 + 模板化 + 链接回退 + 历史抑制（3天）+ 当日总量上限
const fs=require('fs'), path=require('path'), nodemailer=require('nodemailer');
const argv=require('minimist')(process.argv.slice(2),{boolean:['dry'],string:['limit'],default:{dry:true,limit:'20'}});
const { SMTP_HOST, SMTP_PORT=587, SMTP_USER, SMTP_PASS, MAIL_FROM, BCC_TO } = process.env;
function read(p,def=''){ try{ return fs.readFileSync(p,'utf8'); }catch{ return def; } }
function lines(p){ return read(p).split(/\r?\n/).filter(Boolean); }
function parseLead(row){ const a=row.split(','); if(a.length<9) return null;
  return { email:a[0].trim().toLowerCase(), company:a[1].trim(), domain:a[2].trim().toLowerCase(), vendors:[a[3],a[4],a[5]].map(s=>String(s||'').trim()).filter(Boolean), persona:a[6].trim(), status:a[7].trim(), mx_ok:a[8].trim()==='1' };
}
function leads(){ const arr=(lines(path.join('data','leads.csv')).map(parseLead).filter(Boolean)||[]); return arr.filter(x=>!['unsub','optout','bounced','invalid','bad-mx'].includes(x.status)); }
function sampleURL(lead){ for(const slug of lead.vendors){ const p=path.join('vendors',slug,'index.html'); if(fs.existsSync(p)) return `https://www.cg-alert.com/vendors/${encodeURIComponent(slug)}/`; } return `https://www.cg-alert.com/updates/?utm=outreach_s1`; }
function personalize(html, lead){ return html.replace(/\{\{company\}\}/g, lead.company||lead.domain||'your team').replace(/\{\{sample_url\}\}/g, sampleURL(lead)); }
// 读取历史收件抑制（N 天内不重复）
function suppressSet(days=3){ const f='data/sent_recipients.csv'; if(!fs.existsSync(f)) return new Set(); const min=Date.now()-days*24*3600e3;
  const S=new Set(); for(const l of lines(f)){ const [email,ts]=l.split(','); if(!email||!ts) continue; if(new Date(ts).getTime()>=min) S.add(email.toLowerCase()); } return S;
}
function appendRecipients(list){ const f='data/sent_recipients.csv'; const ts=new Date().toISOString(); fs.appendFileSync(f, list.map(e=>`${e},${ts}`).join('\n')+'\n','utf8'); }
(async function main(){
  const dry=!!argv.dry, limit=Math.min(Number(argv.limit)||0, 20); // 当日总量上限 20
  const subject = read(path.join('data','s1_subject.txt'),'Evidence-backed vendor changes for you');
  const htmlTpl = read(path.join('data','s1.html'), '<p>Hi {{company}}, see {{sample_url}}</p>');
  const sup = suppressSet(3); const list = leads().filter(x=>x.mx_ok!==false && !sup.has(x.email)).slice(0, limit);
  if(!list.length){ console.log('[bulk] no eligible leads'); return; }
  const transport = nodemailer.createTransport({ host:SMTP_HOST, port:Number(SMTP_PORT), secure:Number(SMTP_PORT)===465, pool:true, maxConnections:2, maxMessages:50, rateDelta:60000, rateLimit:120, auth:{user:SMTP_USER, pass:SMTP_PASS} });
  const headers = { 'List-Unsubscribe': `<mailto:${MAIL_FROM}?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  let sent=0; const sentEmails=[];
  for(const lead of list){ const html=personalize(htmlTpl, lead); if(dry){ console.log(`[dry] ${lead.email} ← ${subject}`); continue; }
    try{ await transport.sendMail({ from:MAIL_FROM, to:lead.email, bcc:BCC_TO||undefined, subject, html, headers }); sent++; sentEmails.push(lead.email); }catch(e){ console.error('[send][err]', lead.email, e.message); } }
  if(!dry) await transport.close(); const dt=new Date().toISOString();
  if(sentEmails.length) appendRecipients(sentEmails);
  fs.appendFileSync(path.join('data','sent_log.csv'), `${dt},bulk,${sent},${subject.replace(/,/g,';')}\n`);
  fs.writeFileSync(path.join('data','last_outreach.txt'), `${dt} bulk sent=${sent}\n`);
  console.log(`[bulk] done: sent=${sent}/${list.length}`);
})().catch(e=>{ console.error(e); process.exit(1); });
