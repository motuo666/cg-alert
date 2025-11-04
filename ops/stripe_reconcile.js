#!/usr/bin/env node
const { execSync } = require('child_process'); const fs=require('fs'), path=require('path');
const SK = process.env.STRIPE_API_KEY || process.env.STRIPE_SECRET_KEY;
if(!SK){ console.log('no STRIPE_API_KEY'); process.exit(0); }
function curl(q){ return execSync(q, {stdio:['ignore','pipe','pipe']}).toString('utf8'); }
const since = Math.floor(Date.now()/1000) - 48*3600;
const url = `https://api.stripe.com/v1/checkout/sessions?limit=100&expand[]=data.line_items&created[gte]=${since}`;
const out = curl(`curl -s -u ${SK}: '${url}'`);
const json = JSON.parse(out); const sessions = json.data || [];
let csv = ''; try{ csv = fs.readFileSync('customers.csv','utf8'); }catch{ csv='email,company,plan,cadence,vendors\n'; }
const have = new Set(csv.split(/\r?\n/).slice(1).map(l=>l.split(',')[0].trim().toLowerCase()).filter(Boolean));
let added = 0;
for(const s of sessions){
  if(s.payment_status!=='paid') continue;
  const email = (s.customer_details && s.customer_details.email)|| (s.customer_email) || '';
  if(!email) continue;
  if(have.has(email.toLowerCase())) continue;
  let plan = 'portfolio', cadence='weekly';
  const li = (s.line_items && s.line_items.data && s.line_items.data[0]) || null;
  const desc = li ? (li.description||'') : '';
  if(/Business/i.test(desc)) plan='business';
  if(/Portfolio/i.test(desc)) plan='portfolio';
  const company = (s.customer_details && s.customer_details.name) || (email.split('@')[1]) || '';
  const vendors = '';
  csv += `${email},${company},${plan},${cadence},${vendors}\n`; have.add(email.toLowerCase()); added++;
}
if(added){
  fs.writeFileSync('customers.csv', csv);
  try{
    execSync("git -c user.email=bot@cg-alert.com -c user.name=cg-alert-bot add customers.csv && git commit -m 'stripe: reconcile customers (+"+added+")' && git push",{stdio:'inherit'});
  }catch(e){}
  try{
    const repo = process.env.GITHUB_REPOSITORY || ''; const token = process.env.GITHUB_TOKEN || '';
    if(repo && token){
      execSync(`curl -s -X POST -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" https://api.github.com/repos/${repo}/dispatches -d '{"event_type":"promote_intakes_kick"}'`, {stdio:'inherit'});
    }
  }catch(e){}
}
console.log('reconciled, added=', added);
