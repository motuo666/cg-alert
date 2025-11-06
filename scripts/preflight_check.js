// scripts/preflight_check.js
// Quick preflight: ensures 'evidence/' is a directory and lists required env keys
const fs = require('fs');
const path = require('path');

function ensureEvidenceDir(){
  try{
    const st = fs.statSync('evidence');
    if(!st.isDirectory()){
      throw new Error("'evidence' exists but is not a directory");
    }
  }catch(e){
    if (e.code === 'ENOENT'){
      fs.mkdirSync('evidence', { recursive: true });
    } else {
      throw e;
    }
  }
  console.log('ok: evidence dir');
}

const REQUIRED = ['SITE_ORIGIN','SMTP_HOST','SMTP_USER','SMTP_PASS','UNSUB_HMAC_SECRET'];
const OPTIONAL = ['INTAKE_FORM_URL','STRIPE_LINK_PORTFOLIO','STRIPE_LINK_BUSINESS','SLACK_WEBHOOK_URL','IMAP_HOST','IMAP_USER','IMAP_PASS'];

function checkEnv(){
  let miss=0;
  for(const k of REQUIRED){
    if(!process.env[k]){ console.error('MISS', k); miss++; } else { console.log('OK', k); }
  }
  for(const k of OPTIONAL){
    if(!process.env[k]){ console.log('OPT?', k); } else { console.log('OK', k); }
  }
  if(miss>0) process.exit(1);
}

(function main(){
  ensureEvidenceDir();
  checkEnv();
})();
