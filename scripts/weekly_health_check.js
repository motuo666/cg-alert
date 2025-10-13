#!/usr/bin/env node
// weekly_health_check.js — SMTP/IMAP/KPI 健康检查（可配置“无密钥时跳过 SMTP/IMAP”）
// 约定：
// - SMTP_* / IMAP_* 来自环境变量（工作流里传 secrets）
// - KPI 阈值：KPI_48H_MIN / KPI_7D_MIN（默认 4/4，可在 CI 调高）
// - 严格模式：SMTP_REQUIRED=1 / IMAP_REQUIRED=1；否则未配置则跳过该项

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');

const KPI_48H_MIN = Number(process.env.KPI_48H_MIN || 4);
const KPI_7D_MIN  = Number(process.env.KPI_7D_MIN  || 4);

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || (process.env.SMTP_HOST ? 587 : 0));
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_REQUIRED = String(process.env.SMTP_REQUIRED || '1'); // 有密钥时建议“1”；无密钥可设“0”
const SMTP_TIMEOUT_MS = Number(process.env.SMTP_TIMEOUT_MS || 8000);
const MAIL_FROM = process.env.MAIL_FROM || '';

const IMAP_HOST = process.env.IMAP_HOST || '';
const IMAP_PORT = Number(process.env.IMAP_PORT || 993);
const IMAP_USER = process.env.IMAP_USER || '';
const IMAP_PASS = process.env.IMAP_PASS || '';
const IMAP_REQUIRED = String(process.env.IMAP_REQUIRED || '0'); // IMAP 可选，默认不强制

function countEvidence(hours) {
  const root = path.join(__dirname, '..', 'evidence');
  if (!fs.existsSync(root)) return 0;
  const since = Date.now() - hours * 3600 * 1000;
  let n = 0;
  for (const vendor of fs.readdirSync(root, { withFileTypes: true })) {
    if (!vendor.isDirectory()) continue;
    const vd = path.join(root, vendor.name);
    for (const f of fs.readdirSync(vd)) {
      if (!/\.json$/i.test(f)) continue;
      const st = fs.statSync(path.join(vd, f));
      if (st.mtimeMs >= since) n++;
    }
  }
  return n;
}

async function checkSMTP() {
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    if (SMTP_REQUIRED === '1') {
      throw new Error('SMTP required but missing SMTP_* envs');
    }
    return { ok: true, note: 'skip (no SMTP_* provided)' };
  }
  const secure = String(SMTP_PORT) === '465';
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
  try {
    await transport.verify();
    return { ok: true, note: 'ok' };
  } catch (e) {
    return { ok: false, note: `fail ${e.code || e.message}` };
  }
}

async function checkIMAP() {
  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASS) {
    if (IMAP_REQUIRED === '1') {
      throw new Error('IMAP required but missing IMAP_* envs');
    }
    return { ok: true, note: 'skip (no IMAP_* provided)' };
  }
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: false
  });
  try {
    await client.connect();
    await client.logout();
    return { ok: true, note: 'ok' };
  } catch (e) {
    return { ok: false, note: `fail ${e.code || e.message}` };
  }
}

(async function main() {
  const ev48 = countEvidence(48);
  const ev7d = countEvidence(24 * 7);
  const evOk = ev48 >= KPI_48H_MIN && ev7d >= KPI_7D_MIN;

  const smtp = await checkSMTP();
  const imap = await checkIMAP();

  const lines = [];
  lines.push('Health Check');
  lines.push(`• SMTP: ${smtp.note}`);
  lines.push(`• IMAP: ${imap.note}`);
  lines.push(`• Evidence: 48h=${ev48}, 7d=${ev7d}`);
  const ok = smtp.ok && imap.ok && evOk;
  if (!ok) {
    if (!evOk) lines.push(`• KPI: need >= ${KPI_48H_MIN}/48h and >= ${KPI_7D_MIN}/7d`);
    lines.push('• Status: FAIL 🔴');
    console.log(lines.join('\n'));
    process.exit(1);
  } else {
    lines.push('• Status: OK 🟢');
    console.log(lines.join('\n'));
    process.exit(0);
  }
})().catch(e => {
  console.error('Health Check fatal:', e.message || e);
  process.exit(1);
});
