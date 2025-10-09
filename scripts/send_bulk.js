const fs = require('fs');
const { parse } = require('csv-parse/sync');
const nodemailer = require('nodemailer');
const dns = require('dns').promises;

const CSV_PATH = 'data/leads.csv';
const SUBJECT_PATH = 'data/s1_subject.txt';
const HTML_PATH = 'data/s1.html';

const {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
  MAIL_FROM, S1_SUBJECT, DRY_RUN = '0',
} = process.env;

function tryRead(p){ try{ return fs.readFileSync(p,'utf8'); }catch{ return null; } }

function loadCsvAndHeader(){
  if (!fs.existsSync(CSV_PATH)) throw new Error('缺失 data/leads.csv');
  const raw = fs.readFileSync(CSV_PATH,'utf8').trim();
  if (!raw) throw new Error('data/leads.csv 为空');
  const [headerLine] = raw.split(/\r?\n/);
  const header = headerLine.split(',').map(s=>s.trim());
  const rows = parse(raw,{columns:true,skip_empty_lines:true,trim:true});
  return { header, rows };
}
function ensureColumns(rows, header){
  const must = ['status','last_error','last_sent'];
  for (const r of rows){ for (const k of must){ if(!(k in r)) r[k]=''; } }
  for (const k of must){ if(!header.includes(k)) header.push(k); }
  return header;
}
function saveCsv(header, rows){
  const out=[header.join(',')];
  for(const r of rows){
    out.push(header.map(k => (r[k]??'').toString().replace(/\n/g,' ')).join(','));
  }
  fs.writeFileSync(CSV_PATH, out.join('\n'));
}
function pickPending(rows){
  return rows.filter(r=>{
    const st=(r.status||'').toLowerCase();
    return !st || st==='new' || st==='retry';
  });
}

async function ipv4(host){
  try { const a = await dns.lookup(host, { family: 4 }); return a.address; }
  catch { return host; }
}

async function getTransportWithFallback(){
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) throw new Error('缺少 SMTP_* secrets');
  const ip4 = await ipv4(SMTP_HOST);
  const portEnv = Number(SMTP_PORT || 0);
  const candidates = portEnv
    ? [{ host: ip4, port: portEnv, secure: portEnv===465, requireTLS: portEnv===587 }]
    : [{ host: ip4, port: 465, secure: true }, { host: ip4, port: 587, secure: false, requireTLS: true }];

  let lastErr, working;
  for (const c of candidates) {
    const tr = nodemailer.createTransport({
      host: c.host, port: c.port, secure: c.secure, requireTLS: !!c.requireTLS,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { minVersion: 'TLSv1.2', servername: SMTP_HOST },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000,
    });
    try { await tr.verify(); working = tr; break; }
    catch(e){ lastErr = e; }
  }
  if (!working) throw new Error(`SMTP 连接失败（465/587 均不通）：${lastErr && lastErr.message}`);
  return working;
}

async function realSend(rows, header){
  const subject = (S1_SUBJECT || tryRead(SUBJECT_PATH) || '').trim();
  const html = tryRead(HTML_PATH);
  if (!subject) throw new Error('缺少主题：配置 S1_SUBJECT 或提供 data/s1_subject.txt');
  if (!html) throw new Error('缺少正文模板：提供 data/s1.html');

  const tr = await getTransportWithFallback();
  const from = MAIL_FROM || SMTP_USER;
  const now = new Date().toISOString();

  let sent=0, fail=0;
  for (const r of rows){
    try{
      await tr.sendMail({
        from: from, to: r.email, subject, html,
        headers: {'List-Unsubscribe':'<mailto:optout@cg-alert.com?subject=unsubscribe>','Auto-Submitted':'auto-generated'}
      });
      r.status='sent'; r.last_error=''; r.last_sent=now; sent++;
    }catch(e){
      r.status='err'; r.last_error=(e && e.message ? e.message.slice(0,200) : 'unknown'); fail++;
    }
    await new Promise(res=>setTimeout(res,400+Math.random()*400));
  }
  saveCsv(header, rows);
  console.log(`✅ 真发完成：sent=${sent} fail=${fail}`);
}

(async()=>{
  const { header, rows } = loadCsvAndHeader();
  const hdr = ensureColumns(rows, header);
  const pending = pickPending(rows);

  if (DRY_RUN === '1') {
    console.log(`🔎 DRY-RUN：发现待发送 ${pending.length} 行（不检查模板/SMTP，不改CSV）`);
    for (const r of pending.slice(0,20)) console.log('→', r.email);
    if (pending.length > 20) console.log(`… 以及 ${pending.length - 20} 行`);
    process.exit(0);
  }

  if (!pending.length) { console.log('✅ 无待发送行'); saveCsv(hdr, rows); return; }
  await realSend(pending, hdr);
})().catch(e=>{ console.error('❌ 发送失败:', e.message); process.exit(1); });
