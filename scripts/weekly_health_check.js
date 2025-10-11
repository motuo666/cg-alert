// 每周健康巡检：SMTP/IMAP/DNS(SPF/DKIM/DMARC)、站点关键页、Stripe 链接、Google Form、数据新鲜度

const fs   = require('fs');
const path = require('path');
const dns  = require('dns').promises;

const SITE   = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const DOMAIN = process.env.DOMAIN      || 'cg-alert.com';

// Slack：兼容两种命名
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || process.env.SLACK_WEBHOOK || '';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

let IMAP_HOST = process.env.IMAP_HOST || (SMTP_HOST ? SMTP_HOST.replace(/^smtp\./i, 'imap.') : '');
let IMAP_PORT = Number(process.env.IMAP_PORT || 993);
let IMAP_USER = process.env.IMAP_USER || SMTP_USER;
let IMAP_PASS = process.env.IMAP_PASS || SMTP_PASS;

function nowISO(){ return new Date().toISOString(); }
async function postSlack(text){
  if (!SLACK_WEBHOOK_URL) return;
  await fetch(SLACK_WEBHOOK_URL, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ text }) }).catch(()=>{});
}
async function httpGet(url, okStatuses=[200], mustContains=[]){
  const res  = await fetch(url, { redirect:'follow' });
  const text = await res.text();
  const okS  = Array.isArray(okStatuses) ? okStatuses.includes(res.status) : (res.status === okStatuses);
  const okB  = mustContains.every(s => text.includes(s));
  return { ok: okS && okB, status: res.status, text, url };
}
async function dnsTxt(name){
  try { const rr = await dns.resolveTxt(name); return rr.map(a=>a.join('')).join(' '); }
  catch { return ''; }
}
function readCsvRows(fp){
  try{
    const raw = fs.readFileSync(fp,'utf8').trim();
    if (!raw) return [];
    const [h, ...lines] = raw.split(/\r?\n/).filter(Boolean);
    const head = h.split(',').map(s=>s.trim());
    return lines.map(line=>{
      const v = line.split(',');
      const o = {};
      head.forEach((k,i)=>o[k]=String(v[i]??'').trim());
      return o;
    });
  }catch{ return []; }
}
function parseDateMaybe(s){ const t = Date.parse(s); return isNaN(t) ? 0 : t; }
function daysAgo(n){ return Date.now() - n*24*3600*1000; }

// -------- 检查项 --------
async function checkDNS(){
  const issues = [];
  const allTxt = await (async ()=> {
    try { const rr = await dns.resolveTxt(DOMAIN); return rr.map(x=>x.join(' ')); }
    catch { return []; }
  })();
  const spfRec = allTxt.find(s => /v=spf1/i.test(s)) || '';
  if (!spfRec) issues.push('SPF 缺失（未找到 v=spf1 TXT）');

  const dmarc = await dnsTxt(`_dmarc.${DOMAIN}`);
  if (!/v=DMARC1/i.test(dmarc)) issues.push('DMARC 缺失（未找到 _dmarc TXT）');

  const selectors = ['zmail','zoho','default','mail','s1','s2'];
  let hasDKIM = false;
  for (const s of selectors){
    const txt = await dnsTxt(`${s}._domainkey.${DOMAIN}`);
    if (/v=DKIM1/i.test(txt)) { hasDKIM = true; break; }
  }
  if (!hasDKIM) issues.push('DKIM 记录未发现（尝试 zmail/zoho/default/mail/s1/s2）');

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
    return `SMTP 验证失败：${e && e.message ? e.message : String(e)}`;
  }
}

async function checkIMAP(){
  try{
    const { ImapFlow } = require('imapflow');
    const client = new ImapFlow({
      host: IMAP_HOST, port: IMAP_PORT, secure: IMAP_PORT===993,
      auth: { user: IMAP_USER, pass: IMAP_PASS }
    });
    await client.connect();
    await client.logout();
    return null;
  }catch(e){
    return `IMAP 登录失败：${e && e.message ? e.message : String(e)}`;
  }
}

async function checkHTTP(){
  const fails = [];
  const pages = [
    [ `${SITE}/`,              ['CG Alert','Pricing'] ],
    [ `${SITE}/updates/`,      ['Top Public Changes'] ],
    [ `${SITE}/vendors/`,      ['Vendors'] ],
    [ `${SITE}/categories/`,   ['Categories'] ],
    [ `${SITE}/updates/rss.xml`,['<rss','<channel>'] ],
  ];
  for (const [url, must] of pages){
    try{
      const r = await httpGet(url, [200], must);
      if (!r.ok) fails.push(`${url} → ${r.status} 内容校验失败`);
    }catch(e){
      fails.push(`${url} 请求失败：${e && e.message ? e.message : String(e)}`);
    }
  }
  return fails;
}

async function checkExternal(){
  const fails = [];
  const stripe = [
    process.env.STRIPE_PORTFOLIO_URL || 'https://buy.stripe.com/cNi6oJ6JwcYUe2K72ics801',
    process.env.STRIPE_BUSINESS_URL  || 'https://buy.stripe.com/3cI28t6Jw4soaQy0DUcs800'
  ];
  for (const u of stripe){
    try{
      const res = await fetch(u, { method:'GET', redirect:'manual' });
      if (![200,301,302,303,307,308].includes(res.status)){
        fails.push(`Stripe 链接异常：${u} → ${res.status}`);
      }
    }catch(e){
      fails.push(`Stripe 链接不可达：${u}（${e && e.message ? e.message : String(e)}）`);
    }
  }

  const form = process.env.FORM_URL || 'https://forms.gle/TCaom33BRJGbcJ3r5';
  try{
    const r = await httpGet(form, [200], ['<html','form']);
    if (!r.ok) fails.push('Google Form 检查失败（状态或内容异常）');
  }catch(e){
    fails.push(`Google Form 不可达：${e && e.message ? e.message : String(e)}`);
  }

  return fails;
}

function checkDataFreshness(){
  const issues = [];
  const ROOT = path.join(__dirname,'..');

  // 优先 last_outreach.txt（Outreach 心跳）
  const hb = path.join(ROOT,'data','last_outreach.txt');
  try {
    const s = fs.readFileSync(hb,'utf8').trim();
    const t = parseDateMaybe(s);
    if (t && t > daysAgo(7)) return issues; // 一周内有触达
  } catch {/* 无心跳则回退看 leads.csv */}

  const leads = readCsvRows(path.join(ROOT,'data','leads.csv'));
  const touches = leads.map(r => parseDateMaybe(r.last_touch)).filter(Boolean);
  const newest = touches.length ? Math.max(...touches) : 0;
  if (!newest || newest < daysAgo(7)) {
    issues.push('leads.csv 近 7 天无触达更新（可能 discover/Outreach 未运行；或只跑了 DRY 未提交）');
  }

  const intakes   = readCsvRows(path.join(ROOT,'data','intakes.csv'));
  const customers = readCsvRows(path.join(ROOT,'data','customers.csv'));
  if (intakes.length && customers.length){
    const li = Math.max(...intakes.map(r => parseDateMaybe(r.created_at || r.createdAt || r.date || '0')).filter(Boolean));
    const lc = Math.max(...customers.map(r => parseDateMaybe(r.created_at || r.createdAt || r.date || '0')).filter(Boolean));
    if (li && lc && (li - lc > 24*3600*1000)) {
      issues.push('intakes→customers 可能卡住（24h 内 intake>customer）');
    }
  }

  return issues;
}

// -------- 主流程 --------
(async function main(){
  // 配置检查（避免误连到 127.0.0.1）
  const missing = [];
  for (const k of ['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS']) {
    if (!process.env[k] || String(process.env[k]).trim()==='') missing.push(k);
  }
  for (const [k,v] of Object.entries({IMAP_HOST,IMAP_PORT,IMAP_USER,IMAP_PASS})) {
    if (!v && v!==0) missing.push(k);
  }
  if (missing.length) {
    const msg = `配置缺失：${missing.join(', ')}（请在仓库 Secrets 补齐，Zoho 需 App Password）`;
    console.error('❌ Weekly Health Check FAIL (config): ' + msg);
    await postSlack('❌ Weekly Health Check FAIL (config): ' + msg);
    process.exit(1);
  }

  const problems = [];

  const dnsIssues = await checkDNS();
  if (dnsIssues.length) problems.push(`DNS：\n• ${dnsIssues.join('\n• ')}`);

  const smtpIssue = await checkSMTP(); if (smtpIssue) problems.push(smtpIssue);
  const imapIssue = await checkIMAP(); if (imapIssue) problems.push(imapIssue);

  const httpIssues = await checkHTTP();
  if (httpIssues.length) problems.push(`站点：\n• ${httpIssues.join('\n• ')}`);

  const extIssues = await checkExternal();
  if (extIssues.length) problems.push(`外链：\n• ${extIssues.join('\n• ')}`);

  const dataIssues = checkDataFreshness();
  if (dataIssues.length) problems.push(`数据：\n• ${dataIssues.join('\n• ')}`);

  if (problems.length === 0) {
    const okMsg = `✅ Weekly Health Check PASS @ ${nowISO()}\n• ${DOMAIN}\n• ${SITE}`;
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
