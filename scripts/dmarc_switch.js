// scripts/dmarc_switch.js
// 目标：根据 .ops/dmarc_plan.json 自动把 _dmarc TXT 从 none → quarantine;pct=50 → quarantine;pct=100
// 依赖：GitHub Secrets CF_API_TOKEN / CF_ZONE_ID；计划文件 .ops/dmarc_plan.json
// 幂等：重复运行安全；不需要时不更新

const fs = require('fs');
const path = require('path');

const API = 'https://api.cloudflare.com/client/v4';
const TOKEN = process.env.CF_API_TOKEN;
const ZONE  = process.env.CF_ZONE_ID;

if (!TOKEN || !ZONE) {
  console.error('CF_API_TOKEN/CF_ZONE_ID missing');
  process.exit(1);
}

const planPath = path.join(__dirname, '..', '.ops', 'dmarc_plan.json');
if (!fs.existsSync(planPath)) {
  console.error('.ops/dmarc_plan.json not found');
  process.exit(1);
}

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const start = new Date(plan.start_date);
const now   = new Date();
const days  = Math.floor((now - start) / (24*3600*1000));
const domain = plan.domain || 'cg-alert.com';
const name = `_dmarc.${domain}.`;

const target50 = `v=DMARC1; p=quarantine; pct=50; rua=${plan.rua}; fo=1; sp=${plan.sp||'quarantine'}`;
const target100= `v=DMARC1; p=quarantine; pct=100; rua=${plan.rua}; fo=1; sp=${plan.sp||'quarantine'}`;

let desired = null;
if (days >= 21) desired = target100;
else if (days >= 14) desired = target50;
// <14 天不动

async function cf(path, init={}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers||{})
    }
  });
  const j = await res.json();
  if (!j.success) throw new Error(`Cloudflare API error: ${JSON.stringify(j.errors)}`);
  return j.result;
}

async function main() {
  console.log(`DMARC auto | domain=${domain} days_since_start=${days} desired=${desired?desired:'no-change'}`);

  // 查找 _dmarc 记录
  const list = await cf(`/zones/${ZONE}/dns_records?type=TXT&name=_dmarc.${domain}`);
  let rec = list[0];

  if (!rec) {
    // 不存在就创建（p=none 起步）；但如果还没到 T+14，也只是建 none
    const base = desired ? target50 : `v=DMARC1; p=none; rua=${plan.rua}; fo=1; sp=${plan.sp||'quarantine'}`;
    rec = await cf(`/zones/${ZONE}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({ type:'TXT', name:`_dmarc`, content: base, ttl: 3600 })
    });
    console.log(`created _dmarc TXT: ${rec.id} = ${base}`);
  }

  const current = rec.content.replace(/\s+/g, ' ').trim();
  console.log(`current: ${current}`);

  if (!desired) {
    console.log('window <14d, no change');
    return;
  }

  // 已经是 pct=100 → 不动；pct=50 但 >=21 天 → 升到 100
  if (current === desired) {
    console.log('already desired, noop');
    return;
  }

  // 同一策略（quarantine）但 pct 需要提升
  const isQuarantine = /v=DMARC1;?\s*p=quarantine/i.test(current);
  if (isQuarantine && /pct=50/i.test(current) && days >= 21) {
    await cf(`/zones/${ZONE}/dns_records/${rec.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ type:'TXT', name:`_dmarc`, content: target100, ttl: rec.ttl || 3600 })
    });
    console.log(`updated pct 50→100`);
    return;
  }

  // 从 none 或其它策略切到目标
  await cf(`/zones/${ZONE}/dns_records/${rec.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ type:'TXT', name:`_dmarc`, content: desired, ttl: rec.ttl || 3600 })
  });
  console.log(`updated _dmarc → ${desired}`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
