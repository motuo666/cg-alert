
#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const file = path.join(process.cwd(),'index.html');
let s = fs.readFileSync(file,'utf8');
if(!/hotfix-pricing\.css/.test(s)){
  s = s.replace(/<head>/i, '<head>\n<link rel="stylesheet" href="/hotfix-pricing.css">');
  fs.writeFileSync(file, s, 'utf8');
  console.log('Injected hotfix-pricing.css into index.html');
} else {
  console.log('hotfix already linked');
}
