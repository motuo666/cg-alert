// node scripts/send_monthly_digest.js
// 读取 customers.csv / evidence/ 生成每客户 CSV 并通过 SMTP 发送邮件 + Slack 提醒
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const nodemailer = require('nodemailer'); // 你仓库里已经在其他 workflow 装过 nodemailer；如无请 npm 安装
const { stringify } = require('csv-stringify/sync');

const SMTP_HOST = process.env.SMTP_HOST, SMTP_PORT = +process.env.SMTP_PORT,
      SMTP_USER = process.env.SMTP_USER, SMTP_PASS = process.env.SMTP_PASS,
      MAIL_FROM = process.env.MAIL_FROM, MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'CG Alert',
      SLACK_WEBHOOK = process.env.SLACK_WEBHOOK;

function loadCsv(file){
  if(!fs.existsSync(file)) return [];
  const txt = fs.readFileSync(file,'utf8').trim();
  const [header, ...rows] = txt.split(/\r?\n/);
  const cols = header.split(',');
  return rows.filter(Boolean).map(r=>{
    const parts = [];
    let cur='', inQ=false;
    for(let i=0;i<r.length;i++){
      const ch=r[i];
      if(ch=='"'){ if(inQ && r[i+1]=='"'){ cur+='"'; i++; } else inQ=!inQ; }
      else if(ch==',' && !inQ){ parts.push(cur); cur=''; }
      else cur+=ch;
    }
    parts.push(cur);
    const obj={}; cols.forEach((c,i)=>obj[c]=parts[i]||''); return obj;
  });
}

// 假定 customers.csv 字段: email,company,domain,delivery,vendors (vendors以; 分隔)
const customers = loadCsv('data/customers.csv');
const ym = new Date(); ym.setMonth(ym.getMonth()-1);
const year = ym.getFullYear(), month = String(ym.getMonth()+1).padStart(2,'0');

// 收集 evidence 目录，假设文件名含年月日，如 evidence/<vendor>/2025-09-*.json
function collectEvidence(){
  const out = [];
  if(!fs.existsSync('evidence')) return out;
  for(const vendor of fs.readdirSync('evidence')){
    const vdir = path.join('evidence', vendor);
    if(!fs.statSync(vdir).isDirectory()) continue;
    for(const f of fs.readdirSync(vdir)){
      if(!/^\d{4}-\d{2}-\d{2}/.test(f)) continue;
      if(!f.startsWith(`${year}-${month}-`)) continue;
      const obj = JSON.parse(fs.readFileSync(path.join(vdir,f),'utf8'));
      out.push({ vendor, ...obj }); // obj 里应包含: url, snippet, detected_at 等
    }
  }
  return out;
}

async function main(){
  const evs = collectEvidence();
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT===465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  // 简单按 domain 过滤：如 evidence 里有字段 domain 或由 vendors 命中（最简版：不筛选，统一发）
  for(const c of customers){
    const rows = evs.map(e => ({
      vendor: e.vendor,
      change: e.change || '',
      url: e.url || '',
      detected_at: e.detected_at || e.timestamp || '',
      snippet: (e.snippet||'').replace(/\s+/g,' ').slice(0,300)
    }));
    const csv = stringify(rows, { header:true, columns:['vendor','change','url','detected_at','snippet'] });
    const subj = `CG Alert — ${year}-${month} evidence digest`;
    const body = `Hi ${c.company || ''},

Attached is your ${year}-${month} evidence digest (CSV). 
Let us know if you'd like Slack delivery or API access.

— CG Alert
`;

    await transporter.sendMail({
      from: { name: MAIL_FROM_NAME, address: MAIL_FROM },
      to: c.email,
      subject: subj,
      text: body,
      attachments: [{ filename: `digest-${year}-${month}.csv`, content: csv }]
    });
  }

  if(SLACK_WEBHOOK){
    await fetch(SLACK_WEBHOOK, { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ text:`Monthly digest sent for ${year}-${month} to ${customers.length} customers.` })
    });
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
