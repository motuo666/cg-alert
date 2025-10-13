#!/usr/bin/env node
// send_triggered.js — 触发式：仅在 48h 有证据时发；动态主题/正文；历史抑制（7天）；日上限 20
const fs=require('fs'), path=require('path'), nodemailer=require('nodemailer');
const argv=require('minimist')(process.argv.slice(2),{boolean:['dry'],string:['limit','window-h'],default:{dry:true,limit:'20','window-h':'48'}});
const { SMTP_HOST, SMTP_PORT=587, SMTP_USER, SMTP_PASS, MAIL_FROM, BCC_TO } = process.env;
function read(p){ try{return fs.readFileSync(p,'utf8');}catch{return '';} } function lines(p){ return read(p).split(/\r?\n/).filter(Boolean); }
function parseLead(row){ const a=row.split(','); if(a.length<9) return null;
  return { email:a[0].trim().toLowerCase(), company:a[1].trim(), domain:a[2].trim().toLowerCase(), vendors:[a[3],a[4],a[5]].map(s=>String(s||'').trim()).filter(Boolean), persona:a[6].trim(), status:a[7].trim(), mx_ok:a[8].trim()==='1' };
}
function leads(){ const arr=(lines(path.join('data','leads.csv')).map(parseLead).filter(Boolean)||[]); return arr.filter(x=>!['unsub','optout','bounced','invalid','bad-mx'].includes(x.status)); }
function vendorsURL(slug){ const p=path.join('vendors',slug,'index.html'); return fs.existsSync(p)?`https://www.cg-alert.com/vendors/${encodeURIComponent(slug)}/`:`https://www.cg-alert.com/updates/?utm=outreach_triggered`; }
function detectType(obj,f=''){ const t=(JSON.stringify(obj||{}).toLowerCase()+' '+f.toLowerCase());
  if(/pricing|price|plan/.test(t)) return 'Pricing'; if(/\btos\b|terms/.test(t)) return 'ToS'; if(/\bdpa\b|data processing/.test(t)) return 'DPA';
  if(/subprocessor|sub-?processor/.test(t)) return 'Subprocessors'; if(/status|incident|uptime/.test(t)) return 'Status'; return 'Public change'; }
function freshEvidence(h){ const base='evidence', min=Date.now()-h*3600e3, out=[]; if(!fs.existsSync(base)) return out;
  for(const d of fs.readdirSync(base,{withFileTypes:true})){ if(!d.isDirectory()) continue; const slug=d.name;
    for(const f of fs.readdirSync(path.join(base,slug))){ if(!/\.json$/i.test(f)) continue; const p=path.join(base,slug,f); const st=fs.statSync(p); if(st.mtimeMs<min) continue;
      let obj={}; try{ obj=JSON.parse(fs.readFileSync(p,'utf8')); }catch{} out.push({ slug, type:detectType(obj,f), when:new Date(st.mtimeMs) }); } }
  return out.sort((a,b)=>b.when-a.when);
}
function subjectOf(changes){ if(changes.length===1) return `[${changes[0].type}] ${changes[0].slug} updated — evidence inside`;
  const map={}; for(const c of changes){ (map[c.type] ||= new Set()).add(c.slug); }
  const parts=Object.entries(map).map(([t,sl])=>`${t}(${[...sl].slice(0,3).join('+')}${sl.size>3?'+…':''})`); return `Recent changes: ${parts.slice(0,3).join(' · ')}`; }
function bodyHTML(changes, h){ const lis=changes.slice(0,6).map(c=>`<li><b>[${c.type}]</b> ${c.slug} — <a href="${vendorsURL(c.slug)}">evidence</a> <span style="color:#666">(${c.when.toISOString().slice(0,10)})</span></li>`).join('');
  return `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,Arial"><p>Hi, we detected verifiable public changes in the past ${h} hours:</p><ul>${lis||'<li>No recent changes.</li>'}</ul><p>We monitor Pricing / ToS / DPA / Subprocessors / Status.</p><p><a href="https://www.cg-alert.com/updates/?utm=outreach_triggered">More updates</a></p><hr style="border:none;border-top:1px solid #eee"><p style="color:#666;font-size:12px">Unsubscribe: reply "STOP" or use the List-Unsubscribe header.</p></body></html>`; }
// 7 天抑制
function suppressSet(days=7){ const f='data/sent_recipients.csv'; if(!fs.existsSync(f)) return new Set(); const min=Date.now()-days*24*3600e3;
  const S=new Set(); for(const l of lines(f)){ const [email,ts]=l.split(','); if(!email||!ts) continue; if(new Date(ts).getTime()>=min) S.add(email.toLowerCase()); } return S;
}
function appendRecipients(list){ const f='data/sent_recipients.csv'; const ts=new Date().toISOString(); fs.appendFileSync(f, list.map(e=>`${e},${ts}`).join('\n')+'\n','utf8'); }
(async function main(){
  const windowH=Number(argv['window-h']); const limit=Math.min(Number(argv.limit)||0, 20); const dry=!!argv.dry;
  const changes=freshEvidence(windowH); if(!changes.length){ console.log(`[triggered] no fresh evidence in ${windowH}h → exit`); return; }
  const sup=suppressSet(7); const list=leads().filter(x=>x.mx_ok!==false && !sup.has(x.email)).slice(0, limit); if(!list.length){ console.log('[triggered] no eligible leads'); return; }
  const transport=nodemailer.createTransport({host:SMTP_HOST,port:Number(SMTP_PORT),secure:Number(SMTP_PORT)===465,pool:true,maxConnections:2,maxMessages:50,rateDelta:60000,rateLimit:120,auth:{user:SMTP_USER,pass:SMTP_PASS}});
  const subject=subjectOf(changes); const html=bodyHTML(changes, windowH); const headers={'List-Unsubscribe':`<mailto:${MAIL_FROM}?subject=unsubscribe>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'};
  let sent=0; const sentEmails=[];
  for(const lead of list){ if(dry){ console.log(`[dry] ${lead.email} ← ${subject}`); continue; }
    try{ await transport.sendMail({from:MAIL_FROM,to:lead.email,bcc:BCC_TO||undefined,subject,html,headers}); sent++; sentEmails.push(lead.email); }catch(e){ console.error('[send][err]', lead.email, e.message); } }
  if(!dry) await transport.close(); const dt=new Date().toISOString(); if(sentEmails.length) appendRecipients(sentEmails);
  fs.appendFileSync(path.join('data','sent_log.csv'), `${dt},triggered,${sent},${subject.replace(/,/g,';')}\n`);
  fs.writeFileSync(path.join('data','last_outreach.txt'), `${dt} triggered sent=${sent}\n`);
  console.log(`[triggered] done: sent=${sent}/${list.length}`);
})().catch(e=>{ console.error(e); process.exit(1); });
