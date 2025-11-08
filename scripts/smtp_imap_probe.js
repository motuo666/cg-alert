// Lightweight SMTP+IMAP probe with core Node only (no deps)
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const IMAP_HOST = process.env.IMAP_HOST;
const IMAP_USER = process.env.IMAP_USER;
const IMAP_PASS = process.env.IMAP_PASS;
const IMAP_PORT = parseInt(process.env.IMAP_PORT || '993', 10);

function once(emitter, ev){return new Promise(res=>emitter.once(ev,res));}
function wait(ms){return new Promise(res=>setTimeout(res,ms));}

async function smtpVerify(){
  if(!SMTP_HOST) return {ok:false, msg:'smtp missing host'};
  let socket;
  try{
    if(SMTP_PORT === 465){
      socket = tls.connect({host:SMTP_HOST, port:SMTP_PORT, servername:SMTP_HOST, rejectUnauthorized:false});
      await once(socket,'secureConnect');
    }else{
      socket = net.connect({host:SMTP_HOST, port:SMTP_PORT});
      await once(socket,'connect');
    }
    let data='';
    socket.on('data', c=>data+=c.toString('utf8'));
    // read banner
    await wait(600);
    socket.write('EHLO cg-alert.com\r\n');
    await wait(600);
    // try STARTTLS if offered on 587
    if(SMTP_PORT !== 465 && /STARTTLS/i.test(data)){
      socket.write('STARTTLS\r\n');
      await wait(600);
    }
    socket.write('QUIT\r\n'); socket.end();
    if(/\b220\b|\b250\b/i.test(data)) return {ok:true, msg:'smtp banner ok'};
    return {ok:false, msg:'smtp no banner'};
  }catch(e){
    try{ if(socket) socket.destroy(); }catch{}
    return {ok:false, msg:'smtp '+e.message};
  }
}

async function imapVerify(){
  if(!IMAP_HOST) return {ok:false, msg:'imap missing host'};
  try{
    const socket = tls.connect({host:IMAP_HOST, port:IMAP_PORT, servername:IMAP_HOST, rejectUnauthorized:false});
    await once(socket, 'secureConnect');
    socket.write('a1 CAPABILITY\r\n');
    let data='';
    socket.on('data', c=>data+=c.toString('utf8'));
    await wait(600);
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
  const ok = (smtp.ok && imap.ok);
  const reason = [smtp.msg, imap.msg].join(' | ');
  console.log('probe', {smtp:smtp.msg, imap:imap.msg, ok});

  if(process.env.GITHUB_OUTPUT){
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `ok=${ok}\nreason=${reason}\n`);
  }
  // soft exit; downstream gate decides
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(0); });
