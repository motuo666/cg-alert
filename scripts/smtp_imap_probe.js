// CJS: Lightweight SMTP+IMAP probe (no external deps except nodemailer for SMTP verify)
const net = require('node:net');
const tls = require('node:tls');
const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const IMAP_HOST = process.env.IMAP_HOST;
const IMAP_USER = process.env.IMAP_USER;
const IMAP_PASS = process.env.IMAP_PASS;
const IMAP_PORT = parseInt(process.env.IMAP_PORT || '993', 10);

async function smtpVerify(){
  if(!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return {ok:false, msg:'missing SMTP env'};
  try{
    const tr = nodemailer.createTransport({host:SMTP_HOST, port:SMTP_PORT, secure: SMTP_PORT===465, auth:{user:SMTP_USER, pass:SMTP_PASS}});
    await tr.verify();
    return {ok:true, msg:'smtp ok'};
  }catch(e){
    return {ok:false, msg:'smtp '+e.message};
  }
}

function once(emitter, ev){
  return new Promise(res => emitter.once(ev, res));
}

async function imapVerify(){
  if(!IMAP_HOST || !IMAP_USER || !IMAP_PASS) return {ok:false, msg:'missing IMAP env'};
  try{
    const socket = tls.connect({host:IMAP_HOST, port:IMAP_PORT, servername:IMAP_HOST, rejectUnauthorized:false});
    await once(socket, 'secureConnect');
    socket.write('a1 CAPABILITY\r\n');
    let data = '';
    socket.on('data', chunk => data += chunk.toString('utf8'));
    await new Promise(r => setTimeout(r, 600));
    socket.write('a2 LOGOUT\r\n');
    socket.end();
    if(/IMAP4rev1|CAPABILITY/i.test(data)) return {ok:true, msg:'imap banner ok'};
    return {ok:false, msg:'imap no capability banner'};
  }catch(e){
    return {ok:false, msg:'imap '+e.message};
  }
}

(async function(){
  const smtp = await smtpVerify();
  const imap = await imapVerify();
  const ok = smtp.ok && imap.ok;
  const reason = [smtp.msg, imap.msg].join(' | ');
  console.log('probe', {smtp:smtp.msg, imap:imap.msg, ok});
  if(process.env.GITHUB_OUTPUT){
    require('node:fs').appendFileSync(process.env.GITHUB_OUTPUT, `ok=${ok}\nreason=${reason}\n`);
  }
  if(!ok) process.exit(0); // soft gate; downstream job checks needs.probe.outputs.ok
})().catch(e=>{ console.error(e); process.exit(1); });
