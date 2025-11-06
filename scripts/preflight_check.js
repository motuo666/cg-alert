#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
function fail(m){ console.error(`::error::${m}`); process.exitCode = 1; }
function ok(m){ console.log(`OK - ${m}`); }
const ev = path.join(process.cwd(),'evidence');
try { if (!fs.existsSync(ev)) { fs.mkdirSync(ev,{recursive:true}); ok('created evidence/'); }
      else if (!fs.statSync(ev).isDirectory()) { fail('`evidence` exists but is not a directory'); }
      else ok('evidence/ is a directory'); } catch(e){ fail(e.message); }
const req = ['SITE_ORIGIN','SMTP_HOST','SMTP_USER','SMTP_PASS','UNSUB_HMAC_SECRET'];
const miss = req.filter(k=>!process.env[k]);
if (miss.length) fail('Missing required env: '+miss.join(', '));
else ok('required env present');
console.log('Preflight passed.');
if (process.exitCode) process.exit(process.exitCode);
