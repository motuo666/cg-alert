// scripts/patch_enterprise_cta.js
const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'index.html');
if (!fs.existsSync(file)) { console.error('index.html not found'); process.exit(1); }
let html = fs.readFileSync(file, 'utf8');
const intake = (process.env.INTAKE_FORM_URL && String(process.env.INTAKE_FORM_URL).trim()) || '/intake/';
const re = /<a([^>]*?)href=("|\')(.*?)\2([^>]*?)>([\s\S]*?Request\s+Enterprise[\s\S]*?)<\/a>/i;
if (re.test(html)) {
  html = html.replace(re, (m, p1, q, old, p3, inner) => `<a${p1}href=${q}${intake}${q}${p3}>${inner}</a>`);
  fs.writeFileSync(file, html);
  console.log(`Enterprise CTA updated to: ${intake}`);
} else {
  const reCard = /<h3>\s*Enterprise\s*<\/h3>[\s\S]*?<a([^>]*?)href=("|\')(.*?)\2([^>]*?)>([\s\S]*?)<\/a>/i;
  if (reCard.test(html)) {
    html = html.replace(reCard, (m) => m.replace(/href=("|\')(.*?)\1/i, `href="${intake}"`));
    fs.writeFileSync(file, html);
    console.log(`Enterprise CTA updated (card mode) to: ${intake}`);
  } else {
    console.error('Enterprise CTA anchor not found. No change made.');
    process.exit(1);
  }
}
