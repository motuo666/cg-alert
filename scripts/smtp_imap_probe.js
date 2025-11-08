// CJS: Dependency-free SMTP/IMAP smoke probe (no nodemailer required)
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
    const done = (ok, msg) => { try { sock.end(); } catch {} ; resolve({ ok, msg }); };

    sock.setTimeout(7000, () => done(false, 'smtp timeout'));
    sock.on('error', (e) => done(false, `smtp ${e.message}`));
    sock.on('data',  (d) => { buf += d.toString('utf8'); });

    const readyEv = secure ? 'secureConnect' : 'connect';
    sock.once(readyEv, async () => {
      await wait(250);
      if (!/^220[ -]/m.test(buf)) return done(false, 'smtp no 220 greeting');
      buf='';
      sock.write('EHLO cg-alert.com\r\n');
      await wait(400);
      const has250 = /^250[ -]/m.test(buf);
      const hasStarttls = /STARTTLS/i.test(buf);
      sock.write('QUIT\r\n');
      return done(has250, has250 ? 'smtp ok (raw)' : `smtp EHLO failed${hasStarttls ? ' (server may require STARTTLS)' : ''}`);
    });
  });
}

function once(emitter, ev){ return new Promise(res => emitter.once(ev, res)); }

async function imapVerify() {
  if (!IMAP_HOST) return { ok:false, msg:'imap missing IMAP_HOST' };
  try {
    const socket = tls.connect({
      host: IMAP_HOST,
      port: IMAP_PORT,
      servername: IMAP_HOST,
      rejectUnauthorized: false,
      timeout: 7000,
    });
    await once(socket, 'secureConnect');
    socket.write('a1 CAPABILITY\r\n');

    let data = '';
    socket.on('data', chunk => { data += chunk.toString('utf8'); });

    await wait(600);
    socket.write('a2 LOGOUT\r\n');
    socket.end();

    if (/IMAP4rev1|CAPABILITY/i.test(data)) return { ok:true, msg:'imap banner ok' };
    return { ok:false, msg:'imap no capability banner' };
  } catch (e) {
    return { ok:false, msg:`imap ${e.message}` };
  }
}

(async function main() {
  const smtp = await smtpVerifyRaw();
  const imap = await imapVerify();
  const ok = Boolean(smtp.ok && imap.ok);
  const reason = [smtp.msg, imap.msg].join(' | ');
  console.log('probe', { smtp: smtp.msg, imap: imap.msg, ok });

  appendOutput('ok', ok);
  appendOutput('reason', reason);

  // 软退出，交由后续 Job/Step 判断
  if (!ok) process.exit(0);
})().catch(e => { console.error(e); process.exit(0); });
