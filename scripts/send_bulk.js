// scripts/send_bulk.js  —— 技术增强版（不改文案）
// 依赖：node 18 + nodemailer（或你现有 SMTP 客户端）
const nodemailer = require('nodemailer');
const os = require('os');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const FROM_NAME = 'CG Alert';
const FROM_ADDR = 'outreach@cg-alert.com';
const REPLY_TO  = 'outreach@cg-alert.com';
const LIST_UNSUB = 'mailto:optout@cg-alert.com?subject=unsubscribe';

function wrap78(s=''){
  return s.split('\n').map(line=>{
    if(line.length<=78) return line;
    const chunks=[]; let rest=line;
    while(rest.length>78){ chunks.push(rest.slice(0,78)); rest=rest.slice(78); }
    chunks.push(rest); return chunks.join('\n');
  }).join('\n');
}

function linkCount(text=''){
  const re = /\bhttps?:\/\/[^\s)]+/ig;
  return (text.match(re)||[]).length;
}

async function main(){
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT===465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  const leads = loadLeads(); // 你现有的读取 leads.csv 的逻辑
  for(const lead of leads){
    if((lead.status||'')==='optout' || (lead.status||'')==='invalid') continue;

    const subject = renderSubject(lead);      // 不改你文案
    const body    = renderBodyPlain(lead);    // 不改你文案（纯文本）
    if(linkCount(body)>3) continue;           // 超 3 链接直接跳过（保守）

    const headers = {
      'List-Unsubscribe': `<${LIST_UNSUB}>`,
      'Auto-Submitted': 'auto-generated',
      'X-Entity-Ref-ID': `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };

    await transporter.sendMail({
      from: { name: FROM_NAME, address: FROM_ADDR },
      to:   lead.email,
      replyTo: REPLY_TO,
      subject,
      text: wrap78(body),
      headers,
    });

    await sleep(1200 + Math.random()*800); // 1.2–2.0s/封，稳
  }
}

function loadLeads(){ /* 读取 CSV 并生成 {email,...} 数组 —— 保持你原逻辑 */ return []; }
function renderSubject(lead){ /* 你的 S1 文案 —— 不修改 */ return '...'; }
function renderBodyPlain(lead){ /* 你的 S1 文案 —— 不修改 */ return '...'; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

main().catch(err=>{ console.error(err); process.exit(1); });
