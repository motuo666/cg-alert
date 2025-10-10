// scripts/weekly_health_check.js
// 每周健康巡检：SMTP/IMAP/DNS/HTTP/外链/数据新鲜度 → Slack 报告 + 非零退出码
// 运行：node scripts/weekly_health_check.js

const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;

// ---------- 环境 ----------
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const DOMAIN = process.env.DOMAIN || 'cg-alert.com';
const STRIPE_PORTFOLIO_URL = process.env.STRIPE_PORTFOLIO_URL || 'https://buy.stripe.com/cNi6oJ6JwcYUe2K72ics801';
const STRIPE_BUSINESS_URL  = process.env.STRIPE_BUSINESS_URL  || 'https://buy.stripe.com/3cI28t6Jw4soaQy0DUcs800';
const FORM_URL = process.env.FORM_URL || 'https://forms.gle/TCaom33BRJGbcJ3r5';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

const IMAP_HOST = process.env.IMAP_HOST || '';
const IMAP_PORT = Number(process.env.IMAP_PORT || 993);
const IMAP_USER = process.env.IMAP_USER || '';
const IMAP_PASS = process.env.IMAP_PASS || '';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';

// ---------- 工具 ----------
function nowISO(){ return new Date().toISOString(); }
function agoDays(n){ return Date.now() - n*24*3600*1000; }
async function postSlack(text){
  if (!SLACK_WEBHOOK_URL) return;
  await fetch(SLACK_WEBHOOK_URL, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ text }) });
}
async function httpGet(url, want=200, mustContains=[]){
  const res = await fetch(url, { redirect: 'follow' });
  const txt = await res.text();
  const ok = (res.status === want || (Array.isArray(want)? want.includes(res.status): false))
          && mustContains.every(s => txt.includes(s));
  return { ok, status: res.status, snippet: txt.slice(0,200).replace(/\s+/g,' '), url };
}
async function dnsTxt(name){
  try{
    const rr = await dns.resolveTxt(name);
    return rr.flat().join(' ');
  }catch(e){
    return '';
  }
}
function readCsvLines(fp){
  try{
    const s = fs.readFileSync(fp,'utf8').trim();
    return s? s.split(/\r?\n/).filter(Boolean): [];
  }catch{ return []; }
}
function parseCsvRows(fp){
  const lines = readCsvLines(fp);
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map(s=>s.trim());
  return lines.slice(1).map(line=>{
    const v = line.split(',');
    const o={}; head.forEach((k,i)=>o[k]=String(v[i]??'').trim());
    return o;
  });
}

// ---------- 检查项 ----------
async function checkDNS(){
  const issues = [];
  const spf = await dnsTxt(DOMAIN);
  if (!/v=spf1/i.test(spf)) issues.push(`SPF 缺失：${spf||'（空）'}`);

  // DMARC
  const dmarc = await dnsTxt(`_dmarc.${DOMAIN}`);
  if (!/v=DMARC1/i.test(dmarc)) issues.push(`DMARC 缺失：${dmarc||'（空）'}`);

  // DKIM（尝试常见 selector）
  const selectors = ['zmail','zoho','default','mail','s1','s2'];
  let anyDKIM = false;
  for (const s of selectors){
    const txt = await dnsTxt(`${s}._domainkey.${DOMAIN}`);
    if (/v=DKIM1/i.test(txt)) { anyDKIM = true; break; }
  }
  if (!anyDKIM) issues.push('DKIM 记录未发现（尝试了 zmail/zoho/default/mail/s1/s2）');

  return issues;
}

async function checkSMTP(){
  try{
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT===465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    await transporter.verify();
    return null;
  }catch(e){
    return `SMTP 验证失败：${e.message || e}`;
  }
}

async function checkIMAP(){
  try{
    const { ImapFlow } = require('imapflow');
    const client = new ImapFlow({
      host: IMAP_HOST, port: IMAP_PORT, secure: IMAP_PORT===993,
      auth: { user: IMAP_USER, pass: IMAP_PASS },
      logger: false
    });
    await client.connect();
    await client.logout();
    return null;
  }catch(e){
    return `IMAP 登录失败：${e.message || e}`;
  }
}

async function checkHTTP(){
  const fails = [];
  const pages = [
    [ `${SITE}/`, ['CG Alert','Pricing'] ],
    [ `${SITE}/updates/`, ['Top Public Changes'] ],
    [ `${SITE}/vendors/`, ['Vendors'] ],
    [ `${SITE}/categories/`, ['Categories'] ],
    [ `${SITE}/updates/rss.xml`, ['<rss','<channel>'] ],
  ];
  for (const [url, must] of pages){
    try{
      const r = await httpGet(url, 200, must);
      if (!r.ok) fails.push(`${url} → ${r.status} 内容校验失败`);
    }catch(e){
      fails.push(`${url} 请求失败：${e.message||e}`);
    }
  }
  return fails;
}

async function checkExternal(){
  const fails = [];
  // Stripe Links（200 或 3xx 都可接受）
  for (const u of [STRIPE_PORTFOLIO_URL, STRIPE_BUSINESS_URL]){
    try{
      const r = await fetch(u, { method:'GET', redirect:'manual' });
      if (![200,301,302,303,307,308].includes(r.status)){
        fails.push(`Stripe 链接异常 ${u} → ${r.status}`);
      }
    }catch(e){
      fails.push(`Stripe 链接不可达 ${u}：${e.message||e}`);
    }
  }
  // Google Form
  try{
    const r = await httpGet(FORM_URL, 200, ['<html','form']);
    if (!r.ok) fails.push(`Google Form 检查失败 → 状态/内容异常`);
  }catch(e){
    fails.push(`Google Form 不可达：${e.message||e}`);
  }
  return fails;
}

function checkDataFreshness(){
  const issues = [];
  const ROOT = path.join(__dirname,'..');
  const leads = parseCsvRows(path.join(ROOT,'data','leads.csv'));
  const intakes = parseCsvRows(path.join(ROOT,'data','intakes.csv'));
  const customers = parseCsvRows(path.join(ROOT,'data','customers.csv'));

  // 线索新鲜度：7 天内至少有一次触达或新增
  const lastTouches = leads.map(r=>Date.parse(r.last_touch)).filter(n=>!isNaN(n));
  const newest = lastTouches.length ? Math.max(...lastTouches) : 0;
  if (!newest || newest < agoDays(7)) {
    issues.push('leads.csv 近 7 天无触达更新（可能是 discover/Outreach 未运行）');
  }

  // 入站推进：若 intakes 有新增但 customers 长期不变
  if (intakes.length && customers.length){
    const lastIntakeAt = Math.max(...intakes.map(r=>Date.parse(r.created_at||r.createdAt||r.date||0)).filter(n=>!isNaN(n)));
    const lastCustomerAt = Math.max(...customers.map(r=>Date.parse(r.created_at||r.createdAt||r.date||0)).filter(n=>!isNaN(n)));
    if (lastIntakeAt && lastCustomerAt && lastIntakeAt - lastCustomerAt > 24*3600*1000){
      issues.push('intakes→customers 可能卡住（24h 以来有 intake 但无 customer 更新）');
    }
  }

  return issues;
}

// ---------- 主流程 ----------
(async function main(){
  const problems = [];

  // DNS
  const dnsIssues = await checkDNS();
  if (dnsIssues.length) problems.push(`DNS：\n• ${dnsIssues.join('\n• ')}`);

  // SMTP / IMAP
  const smtpIssue = await checkSMTP(); if (smtpIssue) problems.push(smtpIssue);
  const imapIssue = await checkIMAP(); if (imapIssue) problems.push(imapIssue);

  // 站点
  const httpIssues = await checkHTTP();
  if (httpIssues.length) problems.push(`站点：\n• ${httpIssues.join('\n• ')}`);

  // 外链：Stripe / Form
  const extIssues = await checkExternal();
  if (extIssues.length) problems.push(`外链：\n• ${extIssues.join('\n• ')}`);

  // 数据新鲜度
  const dataIssues = checkDataFreshness();
  if (dataIssues.length) problems.push(`数据：\n• ${dataIssues.join('\n• ')}`);

  // 汇报
  if (problems.length === 0){
    const okMsg = `✅ Weekly Health Check PASS @ ${nowISO()} \n• ${DOMAIN}\n• ${SITE}`;
    console.log(okMsg);
    await postSlack(okMsg);
    process.exit(0);
  } else {
    const msg = `❌ Weekly Health Check FAIL @ ${nowISO()}\n${problems.map(s=>'• '+s).join('\n')}`;
    console.error(msg);
    await postSlack(msg);
    process.exit(1);
  }
})();
