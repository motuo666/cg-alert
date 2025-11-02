// scripts/bounce_sweep.js (CommonJS)
const fs = require('fs');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');

const config = {
  imap: {
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASS,
    host: process.env.IMAP_HOST,
    port: 993,
    tls: true,
    authTimeout: 3000
  }
};

async function main(){
  const conn = await imaps.connect(config);
  await conn.openBox('INBOX');
  const searchCriteria = ['UNSEEN'];
  const fetchOptions = { bodies: [''], markSeen: true };
  const messages = await conn.search(searchCriteria, fetchOptions);
  const out = [];
  for(const m of messages){
    const all = m.parts.find(p=>p.which==='');
    const parsed = await simpleParser(all.body);
    const body = (parsed.text || '') + '\n' + (parsed.html || '');
    const emails = body.match(/[^\s<]+@[^\s>]+/g) || [];
    for(const e of emails){
      if(/mailer-daemon|postmaster/i.test(e)) continue;
      if(!out.includes(e)) out.push(e);
    }
  }
  conn.end();
  if(out.length){
    fs.mkdirSync('data', {recursive:true});
    const line = out.map(e=>`${e},bounce,${new Date().toISOString()}`).join('\n') + '\n';
    fs.appendFileSync('data/suppressions.csv', line);
    console.log('added suppressions:', out.length);
  }else{
    console.log('no bounces found');
  }
}
main().catch(e=>{ console.error(e); process.exit(1); });
