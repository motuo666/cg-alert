#!/usr/bin/env node
const fs = require('fs'), path = require('path');

const domFile = 'data/domains.csv';
const epFile  = 'data/endpoints.csv';

function ensureDir(p){ fs.mkdirSync(path.dirname(p), {recursive:true}); }
function normHost(s){
  if(!s) return '';
  s = String(s).trim().replace(/^"|"$/g,'');      // 去引号
  s = s.split(',')[0].trim();                     // 逗号前
  s = s.replace(/^https?:\/\//,'');               // 去协议
  s = s.replace(/\/.*$/,'');                      // 去路径
  s = s.replace(/^www\./,'').toLowerCase();
  // 仅保留域名允许字符
  s = s.replace(/[^a-z0-9\.\-\_]/g,'');
  return s;
}
const isBad = h => /^(_seed|acme|example)\./i.test(h) || h === 'example.com';

function uniq(a){ return [...new Set(a)]; }

function writeSeedsIfEmpty(){
  const seeds = [
    'stripe.com','cloudflare.com','twilio.com','slack.com','zoom.us','box.com','dropbox.com','atlassian.com',
    'datadoghq.com','pagerduty.com','okta.com','auth0.com','github.com','gitlab.com','vercel.com','netlify.com',
    'algolia.com','airtable.com','monday.com','sentry.io','notion.so','intercom.com','zendesk.com','freshworks.com',
    'segment.com','linear.app','supabase.com','render.com','hashicorp.com','snowflake.com','mongodb.com',
    'elastic.co','newrelic.com','confluent.io','openai.com','anthropic.com','huggingface.co','digitalocean.com',
    'heroku.com','salesforce.com','mailchimp.com','sendgrid.com','postmarkapp.com','fastly.com','amplitude.com',
    'miro.com','figma.com','datadog.com','statuspage.io'
  ];
  ensureDir(domFile);
  fs.writeFileSync(domFile, seeds.join('\n')+'\n','utf8');
  console.log(`[sanitize] domains.csv seeded=${seeds.length}`);
}

(function main(){
  let domains=[];
  if(fs.existsSync(domFile)){
    domains = fs.readFileSync(domFile,'utf8').split(/\r?\n/).map(normHost)
      .filter(Boolean).filter(h=>!isBad(h));
    domains = uniq(domains);
    if(domains.length) fs.writeFileSync(domFile, domains.join('\n')+'\n','utf8');
  }
  if(!domains.length) writeSeedsIfEmpty();

  if(fs.existsSync(epFile)){
    const cleaned = fs.readFileSync(epFile,'utf8').split(/\r?\n/)
      .filter(Boolean).filter(l=> (l.match(/,/g)||[]).length >= 2) // 必须三列 host,url,type
      .filter(l=> !/https?:\/\/[^,\s]+,/.test(l)); // 删除“URL里带逗号”的垃圾
    if(cleaned.length){
      fs.writeFileSync(epFile, cleaned.join('\n')+'\n','utf8');
      console.log(`[sanitize] endpoints.csv cleaned=${cleaned.length}`);
    }
  }
})();
