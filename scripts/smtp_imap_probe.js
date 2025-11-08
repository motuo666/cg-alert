// CJS: SMTP/IMAP smoke probe with safe fallbacks.
// - 优先用 nodemailer 验证（如未安装则自动回退到原生握手，不报错不崩溃）
// - 仅做“通道连通/横幅/握手”级别体检；详细可在后续工作流里做 AUTH/往返

'use strict';

const net = require('node:net');
const tls = require('node:tls');
const fs  = require('node:fs');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);

const IMAP_HOST = process.env.IMAP_HOST || '';
const IMAP_USER = process.env.IMAP_USER || '';
const IMAP_PASS = process.env.IMAP_PASS || '';
const IMAP_PORT = parseInt(process.env.IMAP_PORT || '993', 10);

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const appendOutput = (k, v) => {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${String(v)}\n`);
  }
};

async function smtpVerifyRaw() {
  if (!SMTP_HOST) return { ok:false, msg:'smtp missing SMTP_HOST' };

  const secure = SMTP_PORT === 465;
  return new Promise((resolve) => {
    const sock = secure
      ? tls.connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST, rejectUnauthorized: false })
      : net.connect({ host: SMTP_HOST, port: SMTP_PORT });

    let buf = '';
    const cleanup = (ok, msg) => {
      try { sock.end(); } catch {}
      resolve({ ok, msg });
    };

    sock.setTimeout(5000, () => cleanup(false, 'smtp timeout'));
    sock.on('error',  (e) => cleanup(false, `smtp ${e.message}`));
    sock.on('data',   (d) => { buf += d.toString('utf8'); });

    const readyEvent = secure ? 'secureConnect' : 'connect';
    sock.once(readyEvent, async () => {
      // 期望 220 greeting
      await wait(250);
      if (!/^220[ -]/m.test(buf)) {
        cleanup(false, 'smtp no 220 greeting'); return;
      }
      buf = '';
      sock.write('EHLO cg-alert.com\r\n');
      await wait(400);
      const has250 = /^250[ -]/m.test(buf);
      const hasStarttls = /STARTTLS/i.test(buf);
      sock.write('QUIT\r\n');
      cleanup(
        has250 ? true : false,
        has250 ? 'smtp ok (raw)' : `smtp EHLO failed${hasStarttls ? ' (server may require STARTTLS)' : ''}`
      );
    });
  });
}

async function smtpVerify() {
  if (!SMTP_HOST || !SMTP_PORT) return { ok:false, msg:'smtp missing env' };
  try {
    let nm = null;
    try { nm = require('nodemailer'); } catch { nm = null; }

    if (nm) {
      const tr = nm.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        // 若未配 USER/PASS，仅做握手通道验证
        auth: (SMTP_USER && SMTP_PASS) ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
        tls: { rejectUnauthorized: false },
      });
      await tr.verify(); // 握手 / 可选 AUTH 检查
      return { ok:true, msg:'smtp ok (nodemailer)' };
    }

    // 无 nodemailer 时，降级到原生握手探活（不崩溃）
    return await smtpVerifyRaw();

  } catch (e) {
    return { ok:false, msg:`smtp ${e.message}` };
  }
}

function once(emitter, ev) {
  return new Promise(res => emitter.once(ev, res));
}

async function imapVerify() {
  if (!IMAP_HOST) return { ok:false, msg:'imap missing IMAP_HOST' };
  try {
    // 只校验 993/TLS 能否握手，以及 CAPABILITY 横幅
    const socket = tls.connect({
      host: IMAP_HOST,
      port: IMAP_PORT,
      servername: IMAP_HOST,
      rejectUnauthorized: false,
      timeout: 5000,
    });
    await once(socket, 'secureConnect');

    socket.write('a1 CAPABILITY\r\n');
    let data = '';
    socket.on('data', chunk => { data += chunk.toString('utf8'); });

    await wait(600);
    socket.write('a2 LOGOUT\r\n');
    socket.end();

    if (/IMAP4rev1|CAPABILITY/i.test(data)) {
      return { ok:true, msg:'imap banner ok' };
    }
    return { ok:false, msg:'imap no capability banner' };
  } catch (e) {
    return { ok:false, msg:`imap ${e.message}` };
  }
}

(async function main() {
  const smtp = await smtpVerify();
  const imap = await imapVerify();
  const ok = Boolean(smtp.ok && imap.ok);
  const reason = [smtp.msg, imap.msg].join(' | ');
  console.log('probe', { smtp: smtp.msg, imap: imap.msg, ok });

  appendOutput('ok', ok);
  appendOutput('reason', reason);

  // 软退出：不让整个 job 挂；让后续工作流根据 outputs 决定是否 fail
  if (!ok) process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(0); // 兜底：任何异常也软退出
});
