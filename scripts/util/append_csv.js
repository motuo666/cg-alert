// scripts/util/append_csv.js
const fs=require('fs');const p=process.argv[2];const row=process.argv[3];
if(!p||!row){console.error("usage: node scripts/util/append_csv.js <file> <row>");process.exit(1);}
const dir=require('path').dirname(p); if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
let needsHeader=!fs.existsSync(p)||fs.readFileSync(p,'utf8').trim().length===0;
const out=fs.createWriteStream(p,{flags:'a'}); if(needsHeader) out.write("email,company,plan,cadence,vendors\\n");
out.write(row.trim().replace(/\\s+$/,"")+"\\n"); out.end();
