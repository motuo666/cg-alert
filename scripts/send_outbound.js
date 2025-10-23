// scripts/send_outbound.js
const fs = require('fs'); const path = require('path');
const nodemailer = require('nodemailer');
const fetch = (...a)=>import('node-fetch').then(({default:f})=>f(...a));

const CF_ACCOUNT_ID   = process.env.CF_ACCOUNT_ID;
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID;
const CF_API_TOKEN    = process.env.CF_API_TOKEN;
const SEND_RATE       = parseInt(process.env.SEND_RATE||'20',10);

const SMTP_HOST = process.env.SMTP_HOST, SMTP_PORT=+process.env.SMTP_PORT||465;
const SMTP_USER = process.env.SMTP_USER, SMTP_PASS=process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM || 'CG Alert <noreply@cg-alert.com>';
const WORKER_URL= process.env.WORKER_URL;
const UNSUB_HMAC_SECRET = process.env.UNSUB_HMAC_SECRET;

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
let sent=0, winStart=Date.now();
async function ratelimit() {
  sent++; const el=Date.now()-winStart;
  if (sent>=SEND_RATE){ if (el<60_000) await sleep(60_000-el); sent=0; winStart=Date.now();}
}

function sha1(s){ return require('crypto').createHmac('sha1', UNSUB_HMAC_SECRET).update(s).digest('hex'); }
function unsubUrl(email){ return `${WORKER_URL.replace(/\/+$/,'')}/u?u=${encodeURIComponent(sha1(email))}&email=${encodeURIComponent(email)}`; }

async function kvList(prefix){
  const emails = []; const hours=[-1,0].map(h=>{const d=new Date(Date.now()+h*3600*1000);return d.toISOString().slice(0,13).replace(/[-:T]/g,'')});
  for (const hh of hours){
    let cursor;
    do{
      const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/keys?prefix=${encodeURIComponent(prefix+':'+hh+':')}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`;
      const r = await fetch(url, { headers:{'Authorization':`Bearer ${CF_API_TOKEN}`}});
      const j = await r.json();
      (j.result||[]).forEach(k=>emails.push(k.name.split(':').pop()));
      cursor = j.result_info?.cursor;
    }while(cursor);
  }
  return Array.from(new Set(emails));
}

async function kvGetLead(email){
  const key = `lead:${email}`;
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  const r = await fetch(url, { headers:{'Authorization':`Bearer ${CF_API_TOKEN}`}});
  if (r.status===404) return null;
  const t = await r.text(); try{ return JSON.parse(t);}catch{ return null}
}

async function kvPutLead(email, obj){
  const key = `lead:${email}`;
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  await fetch(url, { method:'PUT', headers:{'Authorization':`Bearer ${CF_API_TOKEN}`, 'content-type':'application/json'}, body: JSON.stringify(obj) });
}

function pickSeg(lead){
  const tech = (lead.tech||[]).map(s=>s.toLowerCase());
  if (tech.some(t=>/shopify/.test(t))) return 'shopify';
  if (tech.some(t=>/wordpress|wp|woo/.test(t))) return 'wordpress';
  return 'saas';
}

function loadTpl(seg, step){
  const dir = path.join(process.cwd(), 'config/email_templates/outbound');
  const p = path.join(dir, `${seg}_${step}.html`);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8');
  return `<p>Hi,</p><p>We noticed your stack might benefit from CG Alert. </p>`;
}

async function main(){
  const emails = await kvList('dripq:outbound');
  if (!emails.length){ console.log('no outbound queue'); return; }
  const tx = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT===465, auth:{user:SMTP_USER, pass:SMTP_PASS}});
  for (const email of emails){
    const lead = await kvGetLead(email); if (!lead) continue;
    if (lead.unsub||lead.bounced||lead.status==='unsub'||lead.status==='suppressed'||lead.status==='bounced') continue;
    lead.outbound = lead.outbound || { sent:[] };
    const stage = lead.outbound.sent.includes('d0') ? (lead.outbound.sent.includes('d2') ? 'd7':'d2') : 'd0';
    const seg = pickSeg(lead);
    const tpl = loadTpl(seg, stage);
    const lid = lead.cg_lead_id || '';
    const utm = `utm_source=outbound&utm_medium=email&utm_campaign=${seg}&utm_content=${stage}&lid=${encodeURIComponent(lid)}`;
    const cta = `https://www.cg-alert.com/?${utm}`;
    const unsub = unsubUrl(email);
    const html = tpl
      .replace(/{{\s*cta_url\s*}}/g, cta)
      .replace(/{{\s*unsub_url\s*}}/g, unsub)
      .concat(`<p style="margin-top:24px;font-size:12px;color:#666;">No longer interested? <a href="${unsub}">Unsubscribe</a>.</p>`);
    const subject = stage==='d0' ? `[${seg}] Quick question` : (stage==='d2' ? `Worth a look for ${seg}` : `Last note re: ${seg}`);
    try{
      await tx.sendMail({ from: MAIL_FROM, to: email, subject, html });
      lead.outbound.sent.push(stage);
      lead.touches = lead.touches||[]; lead.touches.push({ ts: Date.now(), source:'outbound', seg, stage });
      await kvPutLead(email, lead);
      console.log('sent', email, seg, stage);
      await ratelimit();
    }catch(e){
      console.error('send fail', email, e.message||e);
    }
  }
}
main().catch(e=>{ console.error(e); process.exit(1); });
