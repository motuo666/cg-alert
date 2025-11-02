#!/usr/bin/env node
// scripts/patch_pricing_ui.js
const fs = require('fs'), path = require('path');
const p = path.join(process.cwd(), 'index.html');
if (!fs.existsSync(p)) { console.error('index.html missing'); process.exit(1); }
let s = fs.readFileSync(p,'utf8');

// Remove Compliance & Vendor Risk card (rough, based on heading)
s = s.replace(/<section[^>]*id=["']pricing[^>]*>[\s\S]*?Compliance\s*&\s*Vendor\s*Risk[\s\S]*?<\/a>\s*<\/div>\s*<\/div>/i, m => {
  return m.replace(/<div class="plan[\s\S]*?Compliance[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/i, '');
});

// Replace "Need more" text → "Contact for Custom (Enterprise)"
s = s.replace(/Need\s*more/gi, 'Contact for Custom (Enterprise)');

// Ensure Enterprise contact goes to /intake
s = s.replace(/href="[^"]*#?contact[^"]*"/gi, 'href="/intake"');

fs.writeFileSync(p, s);
console.log('index.html pricing UI cleaned (removed compliance card, rewrote CTA)');
