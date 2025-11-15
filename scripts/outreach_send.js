// CommonJS; persona-aware outreach sender
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const { tplOPS, tplLEGAL, tplREVOPS } = require('../templates/email_personas.js');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;
const UNSUB_ORIGIN = process.env.UNSUB_ORIGIN || 'https://www.cg-alert.com';
const UNSUB_HMAC_SECRET = process.env.UNSUB_HMAC_SECRET || 'change-me';
const DRY_RUN = (process.env.DRY || '').toLowerCase() === 'true';
const SEND_LIMIT = parseInt(process.env.SEND_LIMIT || process.env.LIMIT || '12', 10);


if(!SMTP_HOST || !SMTP_USER || !SMTP_PASS){
  console.error('Missing SMTP_* env'); process.exit(1);
}

const leadsCsv = path.join(process.cwd(),'data','leads.csv');
const unsubJson = path.join(process.cwd(),'suppression','unsub.json');
const personaRulesPath = path.join(process.cwd(),'config','persona_rules.json');
const regionFilterPath = path.join(process.cwd(),'config','region_filter.json');

function parseCSV(text){
  const lines = text.split(/\r?\n/).filter(Boolean);
  if(lines.length===0) return [];
  const hdr = lines.shift().split(',').map(s=>s.trim());
  return lines.map(l=>{
    const cols = l.split(',').map(s=>s.trim());
    const obj = {}; hdr.forEach((h,i)=>obj[h]=cols[i]||''); return obj;
  });
}

async function loadLeads(){ try{ return parseCSV(await fs.readFile(leadsCsv,'utf8')); }catch{ return []; } }
async function loadUnsub(){
  try{ const j = JSON.parse(await fs.readFile(unsubJson,'utf8')); return new Set(j.unsub||[]); }catch{ return new Set(); }
}
async function loadJSON(p, def){ try{ return JSON.parse(await fs.readFile(p,'utf8')); } catch{ return def; } }

function choosePersona(lead, rules, idx){
  const t = (lead.title||'').toLowerCase();
  const email = (lead.email||'').toLowerCase();
  const matchAny = (keys)=> keys.some(k => t.includes(k) || email.includes(k));
  if(matchAny(rules.legal_keywords||[])) return 'LEGAL';
  if(matchAny(rules.ops_keywords||[])) return 'OPS';
  if(matchAny(rules.revops_keywords||[])) return 'REVOPS';
  const order = rules.rotation_order || ['LEGAL','OPS','REVOPS'];
  return order[idx % order.length];
}

function vendorsStrFromLead(lead){
  const vs = (lead.vendors||'').split(/[;|,]/).map(s=>s.trim()).filter(Boolean);
  return vs.slice(0,3).join(', ');
}

function hmac(email){
  return crypto.createHmac('sha256', UNSUB_HMAC_SECRET).update(email.toLowerCase()).digest('hex');
}

function renderMail(persona, ctx){
  switch(persona){
    case 'LEGAL': return tplLEGAL(ctx);
    case 'OPS': return tplOPS(ctx);
    case 'REVOPS': return tplREVOPS(ctx);
    default: return tplOPS(ctx);
  }
}

(async function(){
  const unsub = await loadUnsub();
  const leads = (await loadLeads()).filter(x=>x.email && !unsub.has(x.email.toLowerCase()));
  if(leads.length===0){ console.log('no leads to send'); return; }

  const rules = await loadJSON(personaRulesPath, {});
  const region = await loadJSON(regionFilterPath, {});
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  let sent = 0, idx = 0;
  for(const lead of leads){
    if(sent >= SEND_LIMIT) break;
    const email = lead.email.toLowerCase();
    if((region.block_email_domains||[]).some(prefix => email.includes(prefix))) continue;

    const persona = choosePersona(lead, rules, idx++);
    const ctx = {
      name: lead.name || '',
      company: lead.company || '',
      vendorsStr: vendorsStrFromLead(lead),
      UNSUB_ORIGIN,
      EMAIL: email,
      HMAC: hmac(email)
    };
    const { subject, body } = renderMail(persona, ctx);
    try{
      if(DRY_RUN){
        console.log('dry_run', email, 'persona', persona);
      }else{
        await transporter.sendMail({ from: MAIL_FROM, to: email, subject, text: body });
        sent++;
        console.log('sent', email, 'persona', persona);
      }
    }catch(e){
      console.log('fail', email, e.message);
    }
  }
  console.log('sent_total', sent);
})().catch(e=>{ console.error(e); process.exit(1); });