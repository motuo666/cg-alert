// scripts/weekly_health_check.js
// 每周巡检：DNS(SPF/MX/DMARC) / 站点 200 / CSV 在位 / Secrets 在位
// 异常时，发 Slack 文本摘要（不泄露敏感值）

const dns = require('dns').promises;

const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const DOMAIN = process.env.DOMAIN || 'cg-alert.com';
const SLACK = process.env.SLACK_WEBHOOK_URL || '';

const fetchText = async (url) => {
  const r = await fetch(url, { redirect:'follow' });
  const t = await r.text();
  return { status: r.status, text: t };
};

async function checkDNS() {
  const out = [];
  // SPF
  let spfOK=false;
  try{
    const txt = await dns.resolveTxt(DOMAIN);
    spfOK = txt.flat().some(s => /v=spf1/i.test(s));
  }catch{}
  out.push({ name:'SPF TXT', ok: spfOK });

  // MX
  let mxOK=false;
  try{
    const mx = await dns.resolveMx(DOMAIN);
    mxOK = Array.isArray(mx) && mx.length>0;
  }catch{}
  out.push({ name:'MX', ok: mxOK });

  // DMARC
  let dmarcOK=false, dmarcQuarantine=false;
  try{
    const d = await dns.resolveTxt(`_dmarc.${DOMAIN}`);
    const s = d.flat().join(' ');
    dmarcOK = /v=DMARC1/i.test(s);
    dmarcQuarantine = /p=quarantine/i.test(s);
  }catch{}
  out.push({ name:'DMARC present', ok: dmarcOK });
  out.push({ name:'DMARC policy quarantine (非none)', ok: dmarcQuarantine });

  return out;
}

async function checkHTTP() {
  const urls = [
    { url: `${SITE}/`, must: ['CG Alert','Portfolio'] },
    { url: `${SITE}/updates/`, must: ['Top Public Changes'] },
    { url: `${SITE}/updates/rss.xml`, must: ['<rss'] },
    { url: `${SITE}/vendors/`, must: ['Vendors'] },
    { url: `${SITE}/categories/`, must: ['Categories'] }
  ];
  const out=[];
  for (const u of urls) {
    try{
      const { status, text } = await fetchText(u.url);
      const pass = status===200 && u.must.every(s=>text.includes(s));
      out.push({ name: u.url, ok: pass });
    }catch{
      out.push({ name: u.url, ok: false });
    }
  }
  return out;
}

async function checkFiles() {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..');
  const req = ['data/domains.csv','data/leads.csv','data/intakes.csv','data/customers.csv'];
  const out=[];
  for (const p of req) {
    const fp = path.join(ROOT, p);
    let ok=false;
    try{
      const t = fs.readFileSync(fp,'utf8').trim();
      ok = !!t && t.split(/\r?\n/).length >= 1;
    }catch{ ok=false; }
    out.push({ name: p, ok });
  }
  return out;
}

async function checkSecretsPresence() {
  // 只检查“是否存在”，不打印内容
  const need = {
    SMTP_HOST: !!process.env.SMTP_HOST,
    SMTP_PORT: !!process.env.SMTP_PORT,
    SMTP_USER: !!process.env.SMTP_USER,
    SMTP_PASS: !!process.env.SMTP_PASS,
    IMAP_HOST: !!process.env.IMAP_HOST,
    IMAP_PORT: !!process.env.IMAP_PORT,
    IMAP_USER: !!process.env.IMAP_USER,
    IMAP_PASS: !!process.env.IMAP_PASS,
    CF_API_TOKEN: !!process.env.CF_API_TOKEN,
    CF_ZONE_ID:   !!process.env.CF_ZONE_ID,
    SLACK_WEBHOOK_URL: !!process.env.SLACK_WEBHOOK_URL
  };
  return Object.entries(need).map(([k,v])=>({name:`secret:${k}`, ok:v}));
}

function summarize(results){
  const bad = results.filter(x=>!x.ok).map(x=>`- ${x.name}`).join('\n');
  return { ok: bad.length===0, bad };
}

async function main(){
  const chunks = [];
  chunks.push(...await checkDNS());
  chunks.push(...await checkHTTP());
  chunks.push(...await checkFiles());
  chunks.push(...await checkSecretsPresence());

  const { ok, bad } = summarize(chunks);
  if (ok) {
    console.log('WEEKLY HEALTH OK');
    return;
  }
  console.error('WEEKLY HEALTH FAIL:\n'+bad);

  if (SLACK) {
    await fetch(SLACK, {
      method: 'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify({ text: `⚠️ CG Alert weekly health failed:\n${bad}` })
    });
    console.log('Slack notified');
  } else {
    console.log('Slack webhook not set; skipped notify');
  }
  process.exit(1);
}

main().catch(e=>{ console.error(e); process.exit(1); });
