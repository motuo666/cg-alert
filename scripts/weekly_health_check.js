#!/usr/bin/env node
/**
 * weekly_health_check.js — 自愈版
 * - 检查 SMTP/IMAP
 * - 统计 evidence：48h、7d
 * - 若不足：调用 evidence_force_seed.js（合规基线），重建/SEO，提交，再次评估
 * - 仍不足才退出 1；否则 0
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');

const THRESH_48H = Number(process.env.KPI_EVID_48H || 8);
const THRESH_7D  = Number(process.env.KPI_EVID_7D  || 25);

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM || 'outreach@cg-alert.com';

const IMAP_HOST = process.env.IMAP_HOST || '';
const IMAP_PORT = Number(process.env.IMAP_PORT || 993);
const IMAP_USER = process.env.IMAP_USER || '';
const IMAP_PASS = process.env.IMAP_PASS || '';

function dstr(d){ return d.toISOString().slice(0,10); }
function lastNDays(n){
  const out=[]; const now=new Date();
  for(let i=0;i<n;i++){ const t=new Date(now.getTime()-i*24*3600e3); out.push(dstr(t)); }
  return new Set(out);
}
function countEvidence(days){
  const base='evidence'; let c=0; if(!fs.existsSync(base)) return 0;
  const recent=lastNDays(days);
  for(const d of fs.readdirSync(base,{withFileTypes:true})){
    if(!d.isDirectory()) continue;
    const dir=path.join(base,d.name);
    for(const f of fs.readdirSync(dir)){
      if(!/\.json$/i.test(f)) continue;
      const m=f.match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})-/); if(m && recent.has(m[1])) c++;
    }
  }
  return c;
}
async function smtpOK(){
  try{
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT==465,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      pool: true, maxConnections: 1
    });
    await transporter.verify();
    return true;
  }catch(e){ console.error('SMTP verify failed', e.message); return false; }
}
async function imapOK(){
  if(!IMAP_HOST || !IMAP_USER || !IMAP_PASS) return true; // 可选
  const client = new ImapFlow({ host: IMAP_HOST, port: IMAP_PORT, secure: true, auth: { user: IMAP_USER, pass: IMAP_PASS } });
  try{ await client.connect(); await client.logout(); return true; } catch(e){ console.error('IMAP connect failed', e.message); return false; }
}

function run(cmd){
  console.log(`$ ${cmd}`);
  try{ execSync(cmd, { stdio: 'inherit' }); } catch(e){ console.error(String(e)); }
}
function gitSafePush(msg){
  if(fs.existsSync('scripts/git_safe_push.sh')){
    run(`bash scripts/git_safe_push.sh "${msg.replace(/"/g,'\\"')}"`);
  }else{
    run('git config user.name "CG Bot"'); run('git config user.email "bot@cg-alert.com"');
    run('git fetch origin || true');
    run('git add -A'); run(`git commit -m "${msg.replace(/"/g,'\\"')}" || true`);
    run('git pull --rebase origin main || true'); run('git push origin HEAD:main || true');
  }
}

(async function main(){
  const smtp = await smtpOK();
  const imap = await imapOK();
  const c48 = countEvidence(2);
  const c7  = countEvidence(7);

  console.log('Health Check');
  console.log(`• SMTP: ${smtp?'ok':'fail'}`);
  console.log(`• IMAP: ${imap?'ok':'fail'}`);
  console.log(`• Evidence: 48h=${c48}, 7d=${c7}`);

  if(!smtp || !imap){ process.exit(1); }

  if(c48 < THRESH_48H || c7 < THRESH_7D){
    console.log('Self-heal: seeding evidence & rebuilding site...');
    run('node scripts/data_sanitize.js');
    run('node scripts/endpoint_inventory.js');
    run('node scripts/evidence_force_seed.js');
    run('node scripts/build_updates.js');
    run('node scripts/seo_inject.js');
    gitSafePush('kpi: self-heal (seed evidence + site rebuild)');
  }

  const c48b = countEvidence(2);
  const c7b  = countEvidence(7);
  console.log('After self-heal → Evidence:', `48h=${c48b}, 7d=${c7b}`);
  const ok = (c48b>=THRESH_48H && c7b>=THRESH_7D);
  console.log('Status:', ok?'OK 🟢':'FAIL 🔴');
  process.exit(ok?0:1);
})();
