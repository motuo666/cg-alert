// scripts/bounce_sweep.js (graceful IMAP handling)
const fs = require('fs');
let imaps, simpleParser;
(async () => {
  try {
    imaps = (await import('imap-simple')).default;
    simpleParser = (await import('mailparser')).simpleParser;
  } catch (e) {
    console.error('Deps not ready', e.message);
    process.exit(2);
  }
})();

async function run(){
  const IMAP_HOST = process.env.IMAP_HOST;
  const IMAP_USER = process.env.IMAP_USER;
  const IMAP_PASS = process.env.IMAP_PASS;
  if(!IMAP_HOST || !IMAP_USER || !IMAP_PASS){
    console.warn('IMAP_* not set; skipping sweep (non-fatal)');
    return 3;
  }
  const config = { imap: { user: IMAP_USER, password: IMAP_PASS, host: IMAP_HOST, port: 993, tls: true, authTimeout: 5000 } };
  try{
    const conn = await imaps.connect(config);
    await conn.openBox('INBOX');
    const messages = await conn.search(['UNSEEN'], { bodies: [''], markSeen: true });
    const emails = new Set();
    for(const m of messages){
      const all = m.parts.find(p=>p.which==='');
      const parsed = await simpleParser(all.body);
      const body = (parsed.text || '') + '\n' + (parsed.html || '');
      for(const e of (body.match(/[^\s<]+@[^\s>]+/g) || [])){
        if(/mailer-daemon|postmaster/i.test(e)) continue;
        emails.add(e.toLowerCase());
      }
    }
    conn.end();
    if(emails.size){
      fs.mkdirSync('data', {recursive:true});
      const line = [...emails].map(e=>`${e},bounce,${new Date().toISOString()}`).join('\n') + '\n';
      fs.appendFileSync('data/suppressions.csv', line);
      console.log('added suppressions:', emails.size);
    }else{
      console.log('no bounces found');
    }
    return 0;
  }catch(e){
    // Non-fatal: auth or connectivity errors
    console.warn('Bounce sweep non-fatal error:', e && (e.textCode || e.message));
    return 4;
  }
}

run().then(code => process.exit(code));