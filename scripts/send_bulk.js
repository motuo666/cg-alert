// scripts/send_bulk.js
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const nodemailer = require('nodemailer');

const CSV_PATH = 'data/leads.csv';
const SUBJECT_PATH = 'data/s1_subject.txt';
const HTML_PATH = 'data/s1.html';

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, S1_SUBJECT, DRY_RUN='0' } = process.env;

function tryRead(p){ try{ return fs.readFileSync(p,'utf8'); }catch{ return null; } }

function loadCsvAndHeader(){
  const raw = fs.readFileSync(CSV_PATH,'utf8').trim();
  const [headerLine] = raw.split(/\r?\n/);
  const header = headerLine.split(',').map(s=>s.trim());
  const rows = parse(raw,{columns:true,skip_empty_lines:true,trim:true});
  return { header, rows };
}
function ensureColumns(rows, header){
  const must=['status','last_error','last_sent'];
  for(const r of rows){ for(const k of must){ if(!(k in r)) r[k]=''; } }
  for(const k of must){ if(!header.includes(k)) header.push(k); }
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
async function getTransport(){
  if(!SMTP_HOST||!SMTP_PORT||!SMTP_USER||!SMTP_PASS) throw new Error('缺少 SMTP_* secrets');
  const secure=Number(SMTP_PORT)===465;
  return nodemailer.createTransport({
    host:SMTP_HOST, port:Number(SMTP_PORT), secure,
    auth:{user:SMTP_USER, pass:SMTP_PASS},
    tls:{minVersion:'TLSv1.2'}
  });
}
const getSubject=()=> (S1_SUBJECT || tryRead(SUBJECT_PATH) || '').trim();
const getHtml=()=> tryRead(HTML_PATH);

(async()=>{
  if(!fs.existsSync(CSV_PATH)) throw new Error('缺失 data/leads.csv');
  const {header, rows} = loadCsvAndHeader();
  const hdr = ensureColumns(rows, header);
  const pending = pickPending(rows);
  if(!pending.length){ console.log('✅ 无待发送行'); saveCsv(hdr, rows); return; }

  const subject=getSubject(), html=getHtml();
  if(!subject) throw new Error('缺少主题：配置 S1_SUBJECT 或提供 data/s1_subject.txt');
  if(!html) throw new Error('缺少正文模板：提供 data/s1.html');

  const tr = await getTransport();
  await tr.verify();

  const from = MAIL_FROM || SMTP_USER;
  const now = new Date().toISOString();

  console.log(`准备发送 ${pending.length} 封，DRY_RUN=${DRY_RUN}`);
  for(const r of pending){
    try{
      if(DRY_RUN!=='1'){
        await tr.sendMail({
          from: from, to: r.email, subject, html,
          headers:{'List-Unsubscribe':'<mailto:optout@cg-alert.com?subject=unsubscribe>',
                   'Auto-Submitted':'auto-generated'}
        });
      }
      r.status='sent'; r.last_error=''; r.last_sent=now;
      console.log(`✅ ${r.email}`);
    }catch(e){
      r.status='err'; r.last_error=(e && e.message ? e.message.slice(0,200) : 'unknown');
      console.log(`❌ ${r.email} :: ${r.last_error}`);
    }
    await new Promise(res=>setTimeout(res,400+Math.random()*400));
  }
  saveCsv(hdr, rows);
  console.log('✅ 完成回写 CSV');
})().catch(e=>{ console.error('❌ 发送失败:', e.message); process.exit(1); });
