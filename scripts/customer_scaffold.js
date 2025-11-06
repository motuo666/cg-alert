const { fs, path } = require('./utils.js');

(async function(){
  const fp = path.join(process.cwd(),'customers.csv');
  try{ await fs.access(fp); console.log('customers.csv exists'); }
  catch{ await fs.writeFile(fp, 'email,company,plan,rhythm,vendors\n', 'utf8'); console.log('customers.csv scaffolded'); }
})().catch(e=>{ console.error(e); process.exit(1); });
