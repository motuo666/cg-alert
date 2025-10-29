// Minimal repair: ensure canonical tag and create/update _redirects entries for new SKU routes.
const fs = require('fs');
const path = require('path');

const redirectsPath = path.resolve('_redirects');
const redirectsNeeded = [
  '/buy/renewal-desk  /buy/renewal-desk/  200',
  '/buy/compliance    /buy/compliance/    200'
];

if (fs.existsSync(redirectsPath)) {
  let txt = fs.readFileSync(redirectsPath, 'utf8');
  let changed = false;
  for (const line of redirectsNeeded) {
    if (!txt.includes(line)) {
      txt += (txt.endsWith('\n') ? '' : '\n') + line + '\n';
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(redirectsPath, txt, 'utf8');
  console.log('Updated _redirects');
} else {
  const txt = redirectsNeeded.join('\n') + '\n';
  fs.writeFileSync(redirectsPath, txt, 'utf8');
  console.log('Created _redirects');
}
