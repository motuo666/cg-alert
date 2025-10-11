#!/usr/bin/env node
/**
 * E2E Full Chain Self Test for CG Alert
 * 目标：一次跑完“采集→校验→分段→发信(DRY)→入站→客户→构建→交付”全链路，
 *      出任何问题立即 FAIL，并输出人话原因与定位。
 *
 * 运行：
 *   node scripts/e2e_fullchain.js               # 默认 DRY、只连通验证，不发真实邮件
 *   DRY=false node scripts/e2e_fullchain.js     # 可选，真发（不建议在 CI 用）
 *
 * 依赖：仅 Node 内置模块 + 仓库现有脚本。无第三方包。
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');
const net = require('net');
const tls = require('tls');

const DRY = String(process.env.DRY || 'true').toLowerCase() !== 'false'; // 默认 DRY
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

const EXIT = { ok:0, warn:0, fail:0 };
const START = Date.now();

const COLORS = {
  green: s => `\x1b[32m${s}\x1b[0m`,
  red:   s => `\x1b[31m${s}\x1b[0m`,
  yellow:s => `\x1b[33m${s}\x1b[0m`,
  cyan:  s => `\x1b[36m${s}\x1b[0m`,
  gray:  s => `\x1b[90m${s}\x1b[0m`,
};

function logOK(msg){ console.log('✅', COLORS.green(msg)); EXIT.ok++; }
function logWARN(msg){ console.log('⚠️ ', COLORS.yellow(msg)); EXIT.warn++; }
function logFAIL(msg){ console.error('❌', COLORS.red(msg)); EXIT.fail++; }
function section(title){ console.log('\n' + COLORS.cyan(`▶ ${title}`)); }

function run(cmd, args=[], opts={}){
  const r = cp.spawnSync(cmd, args, { stdio:'pipe', cwd:ROOT, env:process.env, encoding:'utf8', ...opts });
  if(r.error) throw r.error;
  return { code:r.status, out:r.stdout.trim(), err:r.stderr.trim() };
}

function mustFile(p, hint){
  if(!fs.existsSync(p)) throw new Error(`缺失文件: ${p}${hint?` (${hint})`:''}`);
}

function readLines(p){
  const buf = fs.readFileSync(p);
  // 检测 CRLF
  if (buf.includes(0x0D)) logWARN(`${p} 包含 CRLF，建议统一为 LF（dos2unix 处理），否则有时会触发 CSV 解析边缘问题`);
  return buf.toString('utf8').split(/\r?\n/);
}

function isEmail(x){
  return /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(x || '');
}

function assertCSV9(line, i){
  const arr = line.split(',');
  if(arr.length !== 9) throw new Error(`data/leads.csv 第 ${i} 行列数=${arr.length}，应为 9（email,company,domain,vendor1,vendor2,vendor3,persona,status,mx_ok）`);
  const [email, company, domain, v1, v2, v3, persona, status, mx_ok] = arr.map(s => s.trim());

  if(!isEmail(email)) throw new Error(`第 ${i} 行 email 非法：${email}`);
  if(!company) throw new Error(`第 ${i} 行 company 为空`);
  if(!/^[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(domain)) throw new Error(`第 ${i} 行 domain 非法：${domain}`);

  const allowedStatus = new Set(['new','sent','bounced','unsub']);
  if(!allowedStatus.has(status)) throw new Error(`第 ${i} 行 status 必须为 new|sent|bounced|unsub，当前：${status}`);

  if(!/^[01]$/.test(mx_ok)) throw new Error(`第 ${i} 行 mx_ok 必须为 0 或 1，当前：${mx_ok}`);

  // 逗号位要对，允许 vendor/ persona 为空，但列数不能少
  return true;
}

function uniq(arr){ return Array.from(new Set(arr)); }

/** TCP/TLS连通预检（不发信） */
function probeConnect({host, port, secure=false, servername}){
  return new Promise((resolve) => {
    const onOk = () => resolve({ok:true});
    const onErr = (err) => resolve({ok:false, err});
    if(secure){
      const s = tls.connect({host, port, servername:servername||host, timeout:7000}, onOk);
      s.on('error', onErr);
      s.setTimeout(8000, ()=>{ s.destroy(); onErr(new Error('timeout')); });
    }else{
      const s = net.createConnection({host, port, timeout:7000}, onOk);
      s.on('error', onErr);
      s.setTimeout(8000, ()=>{ s.destroy(); onErr(new Error('timeout')); });
    }
  });
}

async function main(){
  section('环境信息');
  console.log(COLORS.gray(`${process.platform} ${process.arch} node ${process.version}`));
  logOK('Node 环境就绪');

  // -------- 基础文件校验
  section('基础文件校验');
  [
    path.join(DATA, 'leads.csv'),
    path.join(DATA, 'domains.csv'),
    path.join(DATA, 'vendor_tags.csv'),
    path.join(DATA, 'intakes.csv'),
    path.join(DATA, 'customers.csv'),
    path.join(ROOT, 'index.html'),
    path.join(ROOT, 'updates', 'index.html'),
    path.join(ROOT, 'vendors', 'index.html'),
    path.join(ROOT, 'api', 'vendors.json'),
    path.join(ROOT, 'robots.txt'),
    path.join(ROOT, '_headers'),
    path.join(ROOT, '_redirects'),
  ].forEach(p=> mustFile(p));
  logOK('关键文件存在');

  // -------- leads.csv 严格校验（含你刚踩的坑：列数不足/过多、非法 status/mx_ok）
  section('leads.csv 严格校验');
  const leadsRaw = readLines(path.join(DATA,'leads.csv')).filter(Boolean);
  const bad = [];
  let emails = [];
  leadsRaw.forEach((line, idx)=>{
    try{
      assertCSV9(line, idx+1);
      emails.push(line.split(',')[0].trim().toLowerCase());
    }catch(e){
      bad.push(e.message);
    }
  });
  if(bad.length){
    bad.forEach(m => logFAIL(m));
    throw new Error(`leads.csv 校验失败（共 ${bad.length} 处）`);
  }
  // 重复检查
  const dups = emails.filter((x,i)=> emails.indexOf(x)!==i);
  if(dups.length){
    logWARN(`leads.csv 有重复 email：${uniq(dups).slice(0,5).join(', ')}${dups.length>5?' ...':''}`);
  }
  logOK(`leads.csv 校验通过：${leadsRaw.length} 行`);

  // -------- domains/vendor_tags 基本校验
  section('domains.csv / vendor_tags.csv 校验');
  const domains = readLines(path.join(DATA,'domains.csv')).map(x=>x.trim()).filter(Boolean);
  if(domains.length===0) logWARN('domains.csv 为空，本周不会新增 leads；建议每周追加 10–20 个域名');
  const vtags = readLines(path.join(DATA,'vendor_tags.csv')).map(x=>x.trim()).filter(Boolean);
  if(vtags.length===0) logWARN('vendor_tags.csv 为空（不影响运行，但会降低匹配率）');
  logOK('domains/vendor_tags 基本校验通过');

  // -------- 预检 Secrets 与外部连通性（不发信）
  section('Secrets / 连通性预检（不发信）');
  const needEnv = ['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','MAIL_FROM','SLACK_WEBHOOK'];
  const missing = needEnv.filter(k => !process.env[k]);
  if(missing.length) logWARN(`未设置的 Secrets: ${missing.join(', ')}（部分检查将跳过）`);

  if(process.env.SMTP_HOST && process.env.SMTP_PORT){
    const r = await probeConnect({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: String(process.env.SMTP_PORT)==='465',
      servername: process.env.SMTP_HOST
    });
    if(r.ok) logOK(`SMTP ${process.env.SMTP_HOST}:${process.env.SMTP_PORT} 连通`);
    else logWARN(`SMTP 连通失败：${r.err && r.err.message}`);
  }
  if(process.env.IMAP_HOST && process.env.IMAP_PORT){
    const r2 = await probeConnect({
      host: process.env.IMAP_HOST,
      port: Number(process.env.IMAP_PORT),
      secure: String(process.env.IMAP_SECURE||'true')!=='false',
      servername: process.env.IMAP_HOST
    });
    if(r2.ok) logOK(`IMAP ${process.env.IMAP_HOST}:${process.env.IMAP_PORT} 连通`);
    else logWARN(`IMAP 连通失败：${r2.err && r2.err.message}`);
  }

  // -------- 采集（Discover Contacts）
  section('Discover Contacts（采集）');
  // 允许脚本不存在时跳过：不同分支可能命名略异
  let r = run('node', ['scripts/discover_contacts.js', DRY?'--dry=1':'--dry=0', '--limit=50', '--verbose=1']);
  if(r.code===0){
    console.log(COLORS.gray(r.out || 'discover_contacts ok'));
    logOK('Discover Contacts PASS');
  }else{
    logWARN('discover_contacts.js 不存在或运行异常（非致命）。若存在采集逻辑，请确认文件名与参数。');
  }

  // -------- Leads Lint（再次防呆）
  section('Leads Lint（再次防呆）');
  r = run('node', ['scripts/validate_leads.js']);
  if(r.code!==0){
    console.error(r.out); console.error(r.err);
    throw new Error('validate_leads.js 失败');
  }
  logOK('validate_leads.js PASS');

  // -------- 分段（segment）
  section('分段（segment）');
  r = run('node', ['scripts/segment.js', '--dry=1']);
  if(r.code!==0) { console.error(r.out); console.error(r.err); throw new Error('segment 失败'); }
  logOK('segment PASS');

  // -------- 发信（send_bulk.js）DRY
  section('外发（DRY）');
  mustFile(path.join(DATA,'s1.html'), '缺少发信模板 data/s1.html');
  mustFile(path.join(DATA,'s1_subject.txt'), '缺少发信主题 data/s1_subject.txt');
  r = run('node', ['scripts/send_bulk.js', '--dry=1', '--limit=10']);
  if(r.code!==0){ console.error(r.out); console.error(r.err); throw new Error('send_bulk(DRY) 失败'); }
  logOK('send_bulk(DRY) PASS');

  // -------- 入站解析（poll_inbox）
  section('入站解析（poll_inbox）');
  r = run('node', ['scripts/poll_inbox.js', '--once=1', '--dry=1']);
  if(r.code!==0) { console.error(r.out); console.error(r.err); throw new Error('poll_inbox 失败'); }
  logOK('poll_inbox PASS');

  // -------- 客户提升（promote_intakes）
  section('客户提升（promote_intakes）');
  r = run('node', ['scripts/promote_intakes.js', '--dry=1']);
  if(r.code!==0) { console.error(r.out); console.error(r.err); throw new Error('promote_intakes 失败'); }
  logOK('promote_intakes PASS');

  // -------- 构建：Vendor Catalog
  section('构建：Vendor Catalog');
  r = run('node', ['scripts/build_vendor_catalog.js']);
  if(r.code!==0){ console.error(r.out); console.error(r.err); throw new Error('build_vendor_catalog 失败'); }
  mustFile(path.join(ROOT,'vendors','index.html'));
  mustFile(path.join(ROOT,'api','vendors.json'));
  JSON.parse(fs.readFileSync(path.join(ROOT,'api','vendors.json'),'utf8'));
  logOK('Vendor Catalog 构建 PASS');

  // -------- 构建：Updates（页面+RSS）
  section('构建：Updates & RSS');
  r = run('node', ['scripts/build_updates.js']);
  if(r.code!==0){ console.error(r.out); console.error(r.err); throw new Error('build_updates 失败'); }
  mustFile(path.join(ROOT,'updates','index.html'));
  const rss = path.join(ROOT,'updates','rss.xml');
  mustFile(rss);
  const rssTxt = fs.readFileSync(rss,'utf8');
  if(!/^\s*<\?xml/.test(rssTxt) || !/<rss[^>]+version="2\.0"/.test(rssTxt)){
    throw new Error('RSS 非 RSS 2.0 格式');
  }
  logOK('Updates & RSS 构建 PASS');

  // -------- 构建：Categories
  section('构建：Categories');
  r = run('node', ['scripts/build_categories.js']);
  if(r.code!==0){ console.error(r.out); console.error(r.err); throw new Error('build_categories 失败'); }
  mustFile(path.join(ROOT,'categories','index.html'));
  const smV = path.join(ROOT,'sitemap-vendors.xml');
  const smC = path.join(ROOT,'sitemap-categories.xml');
  [smV, smC].forEach(p => mustFile(p));
  logOK('Categories & Sitemaps PASS');

  // -------- 站点连贯校验
  section('站点连贯校验');
  const robots = fs.readFileSync(path.join(ROOT,'robots.txt'),'utf8');
  const hasSitemap = /Sitemap:\s*https?:\/\/(www\.)?cg-alert\.com\/sitemap\.xml/i.test(robots) ||
                     /Sitemap:\s*\/sitemap\.xml/i.test(robots);
  if(!hasSitemap) logWARN('robots.txt 未声明 Sitemap（不致命，但建议补上）');
  logOK('站点文件连贯 PASS');

  // -------- Slack Webhook 自检（DRY=TRUE时只打印，不真实发）
  section('Slack webhook 自检');
  if(process.env.SLACK_WEBHOOK){
    if(DRY){
      logOK('DRY 模式：跳过真实发 Slack，只验证变量存在');
    }else{
      try{
        const payload = JSON.stringify({text:`[E2E] CG Alert 全链路 PASS @ ${new Date().toISOString()}`});
        const res = run('curl', ['-sS','-X','POST','-H','Content-Type: application/json','-d',payload, process.env.SLACK_WEBHOOK]);
        if(res.code===0) logOK('Slack 通知发送 PASS');
        else logWARN('Slack 发送失败（检查 webhook）');
      }catch(e){
        logWARN('Slack curl 不可用，跳过');
      }
    }
  } else {
    logWARN('未设置 SLACK_WEBHOOK，跳过 Slack 测试');
  }

  // -------- 总结
  console.log('\n' + COLORS.cyan('=== E2E SUMMARY ==='));
  console.log(`OK: ${EXIT.ok}  WARN: ${EXIT.warn}  FAIL: ${EXIT.fail}  用时: ${((Date.now()-START)/1000).toFixed(1)}s`);
  if(EXIT.fail>0) process.exit(1);
  logOK('E2E 全链路 PASS');
}

main().catch(err=>{
  logFAIL(err.stack||String(err));
  console.log('\n' + COLORS.cyan('=== E2E SUMMARY ==='));
  console.log(`OK: ${EXIT.ok}  WARN: ${EXIT.warn}  FAIL: ${EXIT.fail+1}`);
  process.exit(1);
});
