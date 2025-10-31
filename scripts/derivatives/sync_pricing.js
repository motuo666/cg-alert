#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const PORTFOLIO = process.env.STRIPE_LINK_PORTFOLIO || '#';
const COMPLIANCE= process.env.STRIPE_LINK_COMPLIANCE || process.env.STRIPE_LINK_BUSINESS || '#';
const ENTERPRISE= process.env.STRIPE_LINK_ENTERPRISE || '#';
const INTAKE    = process.env.INTAKE_FORM_URL || '#';
const WORKER    = process.env.WORKER_URL || '#';
function* allHtml(){
  function walk(p){
    for(const name of fs.readdirSync(p)){
      const fp = path.join(p,name);
      if(name.startsWith('.') || name==='node_modules' || name==='.git' || name==='assets') continue;
      const st = fs.statSync(fp);
      if(st.isDirectory()) walk(fp);
      else if(/\.html$/i.test(name)) yield fp;
    }
  }
  walk('.');
}
for(const fp of allHtml()){
  let html = fs.readFileSync(fp,'utf8');
  html = html.replace(/\{\{STRIPE_LINK_PORTFOLIO\}\}/g, PORTFOLIO)
             .replace(/\{\{STRIPE_LINK_COMPLIANCE\}\}/g, COMPLIANCE)
             .replace(/\{\{STRIPE_LINK_ENTERPRISE\}\}/g, ENTERPRISE)
             .replace(/\{\{INTAKE_FORM_URL\}\}/g, INTAKE)
             .replace(/\{\{WORKER_URL\}\}/g, WORKER);
  html = html.replace(/\$ ?2,?988/gi, '$2,988')
             .replace(/\$ ?6,?000/gi, '$6,000')
             .replace(/\$ ?12,?000\+?/gi, '$12,000');
  fs.writeFileSync(fp, html, 'utf8');
}
console.log('sync_pricing: enforced 2,988 / 6,000 / 12,000 & injected CTAs/WORKER_URL');
