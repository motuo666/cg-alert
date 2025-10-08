// 从 evidence/<vendor>/*.json 的 URL 与 snippet 中挖掘第三方域名，补到 data/domain_pool.csv
// 仅提取常见 TLD，过滤 CDN/短链/社交等噪音域；每次最多追加 100 条
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const EVID = path.join(ROOT, 'evidence');
const POOL = path.join(ROOT, 'data', 'domain_pool.csv');

const ALLOWED_TLD = ['com','io','co','app','ai','net','org','dev','cloud','software'];
const DENY = new Set([
  't.co','bit.ly','goo.gl','tinyurl.com',
  'google.com','www.google.com','docs.google.com','drive.google.com','googleusercontent.com','gstatic.com',
  'facebook.com','twitter.com','x.com','linkedin.com','instagram.com','youtube.com','youtu.be',
  'w3.org','schema.org','example.com',
  'gravatar.com','cloudfront.net','akamaihd.net'
]);

function readPool(){
  if (!fs.existsSync(POOL)) return [];
  const raw = fs.readFileSync(POOL,'utf8').trim();
  if (!raw) return [];
  const [h, ...rows] = raw.split(/\r?\n/).filter(Boolean);
  const hi = h.split(',').map(s=>s.trim());
  return rows.map(l=>{
    const v=l.split(',');
    const o={}; hi.forEach((k,i)=>o[k]=String(v[i]||'').trim());
    return o;
  });
}

function writePool(rows){
  const header = 'domain,company\n';
  const body = rows.map(r=>`${r.domain},${r.company||''}`).join('\n');
  fs.mkdirSync(path.dirname(POOL), {recursive:true});
  fs.writeFileSync(POOL, header + body + '\n', 'utf8');
}

function upsertPool(additions){
  const cur = readPool();
  const have = new Set(cur.map(r=>r.domain.toLowerCase()));
  const fresh = [];
  for (const r of additions){
    const d = r.domain.toLowerCase();
    if (!have.has(d)) { fresh.push({domain:r.domain, company:r.company||''}); have.add(d); }
  }
  if (fresh.length === 0) return 0;
  const next = [...cur, ...fresh];
  writePool(next);
  return fresh.length;
}

function extractDomains(text){
  if (!text) return [];
  // 粗暴域名匹配（不含协议），排除邮件地址与尾部标点
  const found = new Set();
  const re = /(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,})(?!@)/ig;
  let m;
  while ((m=re.exec(text)) !== null) {
    let host = m[0].toLowerCase();
    // 去掉结尾逗号/句号/括号
    host = host.replace(/[),.;:'"]+$/,'');
    // 顶级域过滤
    const tld = host.split('.').pop();
    if (!ALLOWED_TLD.includes(tld)) continue;
    if (DENY.has(host)) continue;
    found.add(host);
  }
  return [...found];
}

function guessCompany(domain){
  const root = domain.replace(/^www\./,'').split('.')[0];
  if (!root) return '';
  // 简单首字母大写
  return root.charAt(0).toUpperCase() + root.slice(1);
}

function* evidenceJSONFiles(){
  if (!fs.existsSync(EVID)) return;
  const vendors = fs.readdirSync(EVID,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
  for (const v of vendors){
    const dir = path.join(EVID, v);
    const files = fs.readdirSync(dir).filter(f=>f.endsWith('.json'));
    for (const f of files) yield path.join(dir, f);
  }
}

function main(){
  const picks = [];
  for (const fp of evidenceJSONFiles()){
    try{
      const raw = fs.readFileSync(fp,'utf8').trim();
      if (!raw) continue;
      const arr = JSON.parse(raw);
      const rows = Array.isArray(arr) ? arr : [arr];
      for (const it of rows){
        const url = String(it.url || it.URL || it.link || '');
        const snippet = String(it.snippet || it.fragment || it.text || '');
        const hay = (url + '\n' + snippet).slice(0, 20000);
        const domains = extractDomains(hay);
        for (const d of domains) {
          picks.push({ domain: d, company: guessCompany(d) });
        }
      }
    }catch { /* ignore parse errors */ }
  }
  // 去重 & 限流（最多追加 100）
  const uniq = Array.from(new Map(picks.map(x=>[x.domain, x])).values()).slice(0,100);
  const n = upsertPool(uniq);
  console.log(`autofill: candidates=${picks.length}, unique=${uniq.length}, appended=${n}`);
}

main();
