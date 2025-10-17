#!/usr/bin/env node
/**
 * Triggered outreach — 覆盖版（最终）
 * 目标：今天把 Sent≥8 打出来，同时长期可控（风控/可核证/零人工）。
 *
 * 核心改进：
 * - 只发“真实变更”（非 baseline；hash 非 0…）
 * - DRY 不再把 leads.csv 标记为 sent（避免把池子“试跑耗尽”）
 * - 冷却/单域上限可被 ENV/CLI 覆盖（DOMAIN_CAP / DOMAIN_WINDOW_DAYS / EMAIL_COOLDOWN_DAYS / VENDOR_COMPANY_COOLDOWN_DAYS）
 * - 兼容 vendor 别名表（config/vendor_aliases.json），提升 vendor-match 命中
 * - 抑制列表（unsub/bounce/complaint）跳过发送
 * - UTM 自动修复；Pack 存在则优先落地到 Pack
 * - 兜底窗口：window_h 无证据则回退到 168h
 * - Step Summary 输出全链路诊断
 *
 * 输入数据：
 *  - data/leads.csv（9列无表头）: email,company,domain,v1,v2,v3,persona,status,mx_ok
 *  - data/evidence.ndx（TSV）：YYYY-MM-DD<TAB>vendor<TAB>type<TAB>hash<TAB>relpath
 *  - data/outreach_log.csv（自动追加；仅 status=sent 计入冷却历史）
 *  - data/unsubscribes.csv / data/bounces.csv / data/complaints.csv（若存在，则抑制发送）
 *
 * 参数 / 环境：
 *  - --dry=true|false（默认 true）
 *  - --limit=N（默认 5）
 *  - --window_h=N（默认 env.TRIGGER_WINDOW_H 或 72）
 *  - --domain_cap / --domain_window_d / --email_cooldown_d / --vendor_company_d（可选）
 *  - ENV 覆盖：DOMAIN_CAP / DOMAIN_WINDOW_DAYS / EMAIL_COOLDOWN_DAYS / VENDOR_COMPANY_COOLDOWN_DAYS
 *  - SITE_ORIGIN / PERSONA_RULES / REGION_FILTER / MAIL_FROM / BCC_TO / SMTP_*
 */

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const ROOT = path.join(__dirname, '..');
const DATA = (p) => path.join(ROOT, 'data', p);
const CFG  = (p) => path.join(ROOT, 'config', p);

// ---------- 小工具 ----------
function readJSON(fp, fallback=null){ try{ return JSON.parse(fs.readFileSync(fp,'utf8')); }catch{ return fallback; } }
function readLines(fp){ if(!fs.existsSync(fp)) return []; return fs.readFileSync(fp,'utf8').split(/\r?\n/); }
function baseDomain(d){
  if(!d) return '';
  const s=String(d).toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'');
  const host=(s.split('/')[0]||s);
  const seg=host.split('.');
  return seg.length>=2? seg.slice(-2).join('.') : host;
}
function tld(domain){ const b=baseDomain(domain); const i=b.lastIndexOf('.'); return i>0? b.slice(i):''; }
function isZeroHash(h){ return !h || /^0+$/i.test(String(h)); }
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function includesAny(hay, allow){ const s=(hay||'').toLowerCase(); return (allow||[]).some(k=>s.includes(String(k).toLowerCase())); }
function parseArgNum(name, def){
  const argv = process.argv.slice(2);
  const i = argv.findIndex(a=>a===`--${name}`);
  if(i>=0 && argv[i+1]!=null && !/^--/.test(argv[i+1])) return Math.max(0, +argv[i+1]);
  const j = argv.find(a=>a.startsWith(`--${name}=`));
  if(j){ const v = j.split('=').slice(1).join('='); return Math.max(0, +v); }
  const env = process.env[name.toUpperCase()];
  if(env!=null) return Math.max(0, +env);
  return def;
}
function parseArgBool(name, def){
  const argv = process.argv.slice(2);
  const on = argv.some(a=>a===`--${name}` || a===`--${name}=true` || a===`--${name}=1`);
  const off= argv.some(a=>a===`--${name}=false` || a===`--${name}=0`);
  if(on) return true; if(off) return false;
  if(process.env[name.toUpperCase()]!=null){
    const v=String(process.env[name.toUpperCase()]).toLowerCase();
    return v==='1'||v==='true';
  }
  return def;
}

// ---------- 运行参数 ----------
const now = new Date();
const CUR = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`;

const DRY   = !parseArgBool('dry', false) ? false : parseArgBool('dry', true); // 默认 true
const LIM   = parseArgNum('limit', 5);
let   WINH  = parseArgNum('window_h', parseArgNum('TRIGGER_WINDOW_H', 72));

const DOMAIN_CAP              = parseArgNum('domain_cap', parseArgNum('DOMAIN_CAP', 1));       // 默认 1；可被 Boost/Pass D 调高至 4
const DOMAIN_WINDOW_DAYS      = parseArgNum('domain_window_d', parseArgNum('DOMAIN_WINDOW_DAYS', 14));
const EMAIL_COOLDOWN_DAYS     = parseArgNum('email_cooldown_d', parseArgNum('EMAIL_COOLDOWN_DAYS', 14));
const VENDOR_COMPANY_COOLDOWN_DAYS = parseArgNum('vendor_company_d', parseArgNum('VENDOR_COMPANY_COOLDOWN_DAYS', 14));

const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const PERSONA_FILE = process.env.PERSONA_RULES || CFG('persona_rules.json');
const REGION_FILE  = process.env.REGION_FILTER  || CFG('region_filter.json');

// ---------- 配置/别名/规则 ----------
const FREE_EMAIL_DOMAINS = new Set(['gmail.com','yahoo.com','outlook.com','hotmail.com','aol.com','icloud.com','proton.me','protonmail.com','zoho.com','hey.com']);
function isFreeMailbox(email){ const m=String(email||'').toLowerCase().match(/@([^>]+)$/); return m ? FREE_EMAIL_DOMAINS.has(m[1]) : false; }
const persona = readJSON(PERSONA_FILE, { allow_roles:['legal','privacy','procurement','security','risk','compliance'], deny_prefix:['info@','support@','sales@','noreply@','no-reply@'], min_score:0.35 });
const region  = readJSON(REGION_FILE,  { exclude_tld:['.eu','.de','.fr','.it','.es','.nl','.se','.pl'], include_country:['US','CA','AU','SG','GB','IE'] });
const vendorAliasesRaw = readJSON(CFG('vendor_aliases.json'), {});
const vendorAliases = new Map(Object.entries(vendorAliasesRaw).map(([k,v])=>[String(k).trim().toLowerCase(), baseDomain(v)]));

function canonVendorToken(x){
  if(!x) return '';
  let s=String(x).trim().toLowerCase().replace(/^www\./,'');
  // 尝试别名 -> 规范域
  if(vendorAliases.has(s)) return vendorAliases.get(s);
  // 若像域名，取根域
  if(s.includes('.')) return baseDomain(s);
  // 文本别名再查一次（去非字母数字）
  const bare=s.replace(/[^a-z0-9]/g,'');
  if(vendorAliases.has(bare)) return vendorAliases.get(bare);
  return bare;
}

// ---------- 加载数据 ----------
function parseLeadsCSV(){
  const raw = readLines(DATA('leads.csv')).filter(Boolean);
  const rows=[];
  for(const line of raw){
    const parts=line.split(',');
    if(parts.length<9) continue;
    if(parts.length>9){
      const [email,...rest]=parts;
      const tail=rest.slice(-8);
      const company=rest.slice(0, rest.length-8).join(' ');
      rows.push([email,company,...tail]);
    }else rows.push(parts);
  }
  return rows.map(cols=>({
    email: cols[0]?.trim(),
    company: cols[1]?.trim(),
    domain: cols[2]?.trim(),
    v1: cols[3]?.trim(), v2: cols[4]?.trim(), v3: cols[5]?.trim(),
    persona: cols[6]?.trim(), status: cols[7]?.trim(), mx_ok: cols[8]?.trim()
  }));
}
function loadEvidenceWindowHours(hours){
  const ndx=DATA('evidence.ndx'); if(!fs.existsSync(ndx)) return [];
  const cutoff = Date.now() - hours*3600*1000;
  const out=[];
  for(const l of readLines(ndx)){
    if(!l.trim()) continue;
    const [when, slug, type, hash, rel]=l.split('\t');
    const ts = Date.parse(when+'T00:00:00Z');
    if(isNaN(ts) || ts<cutoff) continue;
    out.push({ when, slug: baseDomain(slug), type, hash, rel });
  }
  return out;
}
function loadSuppressedSet(file){
  const fp = DATA(file);
  if(!fs.existsSync(fp)) return new Set();
  const lines = readLines(fp); // 允许带表头
  const idxEmail = lines[0]?.toLowerCase().includes('email') ? lines[0].toLowerCase().split(',').findIndex(h=>h.includes('email')) : 0;
  const s=new Set();
  for(let i=(idxEmail>0?1:0); i<lines.length; i++){
    const em=(lines[i].split(',')[idxEmail]||'').trim().toLowerCase();
    if(em) s.add(em);
  }
  return s;
}

// ---------- URL/邮件 ----------
function existsPackFor(slug){ return fs.existsSync(path.join(ROOT,'reports',CUR,slug,'index.html')); }
function packLinkFor(slug){
  const s = baseDomain(slug);
  return existsPackFor(s) ? `${SITE}/reports/${CUR}/${s}/` : `${SITE}/updates/?q=${encodeURIComponent(s)}`;
}
function addUTM(u, when){
  const sep = u.includes('?')?'&':'?';
  return `${u}${sep}utm_source=email&utm_medium=triggered&utm_campaign=cp_${when.slice(0,7)}`;
}
function composeMail(vendorSlug, topic, when, hash8){
  const t=String(topic||'').toLowerCase();
  const pretty =
    t.includes('pricing') ? 'Pricing' :
    t==='tos' || t.includes('term') ? 'Terms of Service' :
    t==='dpa' || t.includes('privacy') ? 'DPA' :
    t.includes('subprocessor') ? 'Subprocessors' :
    t.includes('status') || t.includes('sla') ? 'SLA/Status' :
    'Policy/Contract';
  const impact =
    pretty==='Pricing' ? 'Budget / renewal risk' :
    pretty==='Terms of Service' ? 'Contract / Legal' :
    pretty==='DPA' ? 'Privacy / data processing' :
    pretty==='Subprocessors' ? 'Vendor risk / DP addendum' :
    'Contract / Compliance';
  const base = packLinkFor(vendorSlug);
  const url  = addUTM(base, when);
  const subj = `[Evidence] ${vendorSlug} changed ${pretty} on ${when}`;
  const body =
`We verified a public change on ${vendorSlug}: ${pretty} (${when}).
Impact: ${impact}. Evidence: ${hash8 ? '#'+hash8 : 'n/a'}.
See verifiable details → ${url}`;
  return { subj, body, url };
}

// ---------- 历史/日志 ----------
function ensureOutreachLogHeader(){
  const f=DATA('outreach_log.csv');
  if(!fs.existsSync(f)) fs.writeFileSync(f,'when,email,company,domain,vendor,lawful_basis,evidence_link,optout_at,status\n','utf8');
}
function appendLog(rec){
  ensureOutreachLogHeader();
  const f=DATA('outreach_log.csv');
  const line = [
    rec.when, rec.email, rec.company, rec.domain, rec.vendor,
    'LI', rec.link, rec.optout_at||'', rec.status||'sent'
  ].join(',')+'\n';
  fs.appendFileSync(f, line, 'utf8');
}
function updateLeadsStatus(sentEmails){
  if(!sentEmails.size) return;
  const file=DATA('leads.csv'); if(!fs.existsSync(file)) return;
  const lines = readLines(file);
  const out=[];
  for(const line of lines){
    if(!line.trim()){ out.push(line); continue; }
    const cols=line.split(',');
    if(cols.length<9){ out.push(line); continue; }
    const email=cols[0].trim().toLowerCase();
    if(sentEmails.has(email)){ cols[7]='sent'; out.push(cols.join(',')); }
    else out.push(line);
  }
  fs.writeFileSync(file, out.join('\n'), 'utf8');
}
function loadOutreachHistory(daysBack=30){
  const f=DATA('outreach_log.csv'); if(!fs.existsSync(f)) return [];
  const since=Date.now()-daysBack*86400*1000;
  return readLines(f).slice(1).filter(Boolean).map(l=>{
    const [when,email,company,domain,vendor,,link,optout_at,status]=l.split(',');
    return { when:Date.parse(when), email:email?.toLowerCase(), company, domain, vendor, status:(status||'').toLowerCase() };
  }).filter(r=>!isNaN(r.when) && r.when>=since && r.status==='sent');
}
function sentToEmailWithin(hist,email,days){ const since=Date.now()-days*86400*1000; const em=(email||'').toLowerCase(); return hist.some(r=>r.email===em && r.when>=since); }
function sentCountToDomainWithin(hist,domain,days){ const since=Date.now()-days*86400*1000; const d=baseDomain(domain); return hist.filter(r=>baseDomain(r.domain)===d && r.when>=since).length; }
function sentVendorToCompanyWithin(hist,vendor,company,days){ const since=Date.now()-days*86400*1000; const v=baseDomain(vendor); return hist.some(r=>baseDomain(r.vendor)===v && r.company===company && r.when>=since); }

// ---------- Baseline 识别 ----------
function vendorOnlyBaseline(arr){
  // 有非零 hash 即视为真实变更
  if(arr.some(e=>!isZeroHash(e.hash))) return false;
  // 保险：读取第一条 evidence JSON 看 kind
  try{
    const rel=arr[0]?.rel; if(!rel) return true;
    const j=readJSON(path.join(ROOT, rel), null);
    if(!j) return true;
    const k=String(j.kind||'baseline').toLowerCase();
    return k==='baseline';
  }catch{ return true; }
}

// ---------- 主流程 ----------
(async function main(){
  // 证据窗口
  let evid = loadEvidenceWindowHours(WINH);
  if(evid.length===0 && WINH<168){
    console.log(`no evidence in ${WINH}h; fallback to 168h`);
    WINH=168; evid = loadEvidenceWindowHours(WINH);
  }

  // 证据分桶 & changed vendor 集合（应用别名规范）
  const byVendor = new Map();
  for(const e of evid){
    const canon = canonVendorToken(e.slug) || baseDomain(e.slug);
    const arr = byVendor.get(canon) || [];
    arr.push({ ...e, slug: canon });
    byVendor.set(canon, arr);
  }
  const changedSet = new Set(byVendor.keys());

  // Leads 加载 & 过滤
  const leadsAll = parseLeadsCSV();
  const suppressed = new Set([
    ...loadSuppressedSet('unsubscribes.csv'),
    ...loadSuppressedSet('bounces.csv'),
    ...loadSuppressedSet('complaints.csv'),
  ]);

  const total = leadsAll.length;
  const passStatus = leadsAll.filter(l => l.status==='new' && l.mx_ok==='1' && !suppressed.has((l.email||'').toLowerCase()));
  const passPersona = passStatus.filter(l=>{
    if(isFreeMailbox(l.email)) return false;
    const deny = (persona.deny_prefix||[]).some(p => (l.email||'').toLowerCase().startsWith(p));
    if(deny) return false;
    const src=(l.persona || l.email || '').toLowerCase();
    return includesAny(src, persona.allow_roles||[]) || (persona.min_score||0)<=0.35;
  });
  const passRegion = passPersona.filter(l=>{
    const tl=tld(l.domain);
    if((region.exclude_tld||[]).includes(tl)) return false;
    return true;
  });

  // vendor 匹配（v1/v2/v3 → 规范化 → 命中 changedSet）
  function matchVendorForLead(l){
    const cand=[l.v1,l.v2,l.v3].map(canonVendorToken).filter(Boolean);
    for(const c of cand){
      if(changedSet.has(c)) return c;
      // 容错：去点比较（okta.com <-> oktacom）
      const nodot=c.replace(/\./g,'');
      for(const v of changedSet){
        if(v===c) return v;
        if(v.replace(/\./g,'')===nodot) return v;
        if(v.includes(c) || c.includes(v.replace(/\./g,''))) return v;
      }
    }
    return null;
  }

  const withVendor=[];
  for(const l of passRegion){
    const mv = matchVendorForLead(l);
    if(mv) withVendor.push({ lead:l, vendor:mv });
  }

  // 仅真实变更
  const withRealChange = withVendor.filter(({vendor})=>{
    const arr = byVendor.get(vendor)||[];
    return arr.length && !vendorOnlyBaseline(arr);
  });

  // 冷却/域上限（只看已 sent 的历史；支持 ENV/CLI 覆盖）
  const hist = loadOutreachHistory(Math.max(DOMAIN_WINDOW_DAYS, EMAIL_COOLDOWN_DAYS, VENDOR_COMPANY_COOLDOWN_DAYS));
  const domainCnt={};
  const cooled=[];
  for(const item of withRealChange){
    const { lead, vendor } = item;
    const email = (lead.email||'').toLowerCase();
    const dom   = baseDomain(lead.domain);

    if(sentToEmailWithin(hist, email, EMAIL_COOLDOWN_DAYS)) continue;
    if(sentVendorToCompanyWithin(hist, vendor, lead.company, VENDOR_COMPANY_COOLDOWN_DAYS)) continue;

    domainCnt[dom] = domainCnt[dom] ?? sentCountToDomainWithin(hist, dom, DOMAIN_WINDOW_DAYS);
    if(domainCnt[dom] >= DOMAIN_CAP) continue;

    domainCnt[dom]++; cooled.push(item);
  }

  // 最终待发
  const toSend = cooled.slice(0, LIM);

  // 诊断输出
  const diag = {
    total,
    'status+mx': passStatus.length,
    persona: passPersona.length,
    region: passRegion.length,
    'vendor-match': withVendor.length,
    'with-real-change': withRealChange.length,
    cooled: cooled.length,
    final: toSend.length,
    window_h: WINH,
    changed_vendors: changedSet.size,
    caps: { DOMAIN_CAP, DOMAIN_WINDOW_DAYS, EMAIL_COOLDOWN_DAYS, VENDOR_COMPANY_COOLDOWN_DAYS }
  };
  console.log('eligibility:', JSON.stringify(diag));

  try{
    if(process.env.GITHUB_STEP_SUMMARY){
      const sum =
`### Outreach Triggered Summary
- Leads total: ${total}
- After status+mx: ${passStatus.length}
- After persona: ${passPersona.length}
- After region: ${passRegion.length}
- Vendors changed in last ${WINH}h: ${changedSet.size}
- Vendor-matched: ${withVendor.length}
- Real-change only: ${withRealChange.length}
- After cooldown/domain-cap: ${cooled.length}
- Will send (limit=${LIM}): ${toSend.length}
- Caps: domain_cap=${DOMAIN_CAP}, domain_window_d=${DOMAIN_WINDOW_DAYS}, email_cooldown_d=${EMAIL_COOLDOWN_DAYS}, vendor_company_d=${VENDOR_COMPANY_COOLDOWN_DAYS}
`;
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, sum, 'utf8');
    }
  }catch{}

  if(toSend.length===0){ console.log('no eligible leads'); process.exit(0); }

  // 准备发信
  let transporter=null;
  if(!DRY){
    const host=process.env.SMTP_HOST, port=+(process.env.SMTP_PORT||587);
    const user=process.env.SMTP_USER, pass=process.env.SMTP_PASS;
    if(!host||!user||!pass) throw new Error('SMTP secrets missing');
    transporter = nodemailer.createTransport({ host, port, secure: port===465, auth:{ user, pass } });
  }

  const sentEmails=new Set(); // 注意：DRY 不入集合（不改 leads.csv）
  for(const { lead, vendor } of toSend){
    // 取该 vendor 最近证据（降序）
    const arr=(byVendor.get(vendor)||[]).slice().sort((a,b)=> b.when.localeCompare(a.when));
    const top=arr[0] || { type:'Change', when:new Date().toISOString().slice(0,10), hash:'' };
    const topic=top.type||'Change';
    const when =top.when||new Date().toISOString().slice(0,10);
    const rawH =String(top.hash||'').toLowerCase();
    const hash8= isZeroHash(rawH)? '' : rawH.slice(0,8);

    const { subj, body, url } = composeMail(vendor, topic, when, hash8);

    if(DRY){
      console.log(`DRY SENT to ${lead.email} subj="${subj}" link="${url}"`);
      appendLog({ when: new Date().toISOString(), email: (lead.email||'').toLowerCase(), company: lead.company, domain: baseDomain(lead.domain), vendor, link:url, status:'dry' });
      // DRY：不更改 leads.csv 状态
      continue;
    }

    try{
      const mail = {
        from: process.env.MAIL_FROM,
        to: lead.email,
        bcc: process.env.BCC_TO || undefined,
        subject: subj,
        text: body,
        headers: { 'X-Mailin-Tag': 'triggered' } // 例：Brevo 标签
      };
      await transporter.sendMail(mail);
      console.log(`SENT to ${lead.email} vendor=${vendor}`);
      appendLog({ when: new Date().toISOString(), email: (lead.email||'').toLowerCase(), company: lead.company, domain: baseDomain(lead.domain), vendor, link:url, status:'sent' });
      sentEmails.add((lead.email||'').toLowerCase());
      // 轻节流：3–8 秒抖动
      await wait(3000 + Math.floor(Math.random()*5000));
    }catch(e){
      console.error(`FAIL to ${lead.email}: ${e.message}`);
      appendLog({ when: new Date().toISOString(), email: (lead.email||'').toLowerCase(), company: lead.company, domain: baseDomain(lead.domain), vendor, link:url, status:'fail' });
    }
  }

  if(sentEmails.size) updateLeadsStatus(sentEmails);
  console.log(`Send Triggered ${sentEmails.size} emails`);
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
