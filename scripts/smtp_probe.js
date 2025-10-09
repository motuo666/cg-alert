// 强化版探针：IPv4 优先 + 465/587 兜底 + 10s 超时
const nodemailer = require('nodemailer');
const dns = require('dns').promises;

const HOST = process.env.SMTP_HOST;
const PORT_ENV = Number(process.env.SMTP_PORT || 0);
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const FROM = process.env.FROM_ADDR || USER;
const TO   = process.env.PROBE_TO || '';

if (!HOST || !USER || !PASS) {
  console.error('❌ 缺少 SMTP_HOST/USER/PASS');
  process.exit(1);
}

async function ipv4(host) {
  try {
    const a = await dns.lookup(host, { family: 4 });
    return a.address;
  } catch {
    return host; // 解析失败就继续用原主机名
  }
}

async function tryProbe({host, port, secure, requireTLS}) {
  const tr = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !!requireTLS,
    auth: { user: USER, pass: PASS },
    tls: { minVersion: 'TLSv1.2', servername: HOST }, // SNI 用原主机名
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    logger: true,
    debug: true,
  });

  console.log(`[probe] connect to ${host}:${port} secure=${secure} requireTLS=${!!requireTLS}`);
  await tr.verify();
  if (TO) {
    await tr.sendMail({
      from: FROM, to: TO, subject: `SMTP Probe (${HOST}:${port})`,
      text: `Probe OK via ${host}:${port} secure=${secure} requireTLS=${!!requireTLS}`,
      headers: { 'Auto-Submitted': 'auto-generated' },
    });
    console.log('[probe] send ok');
  }
  console.log('[probe] verify ok');
}

(async () => {
  const ip4 = await ipv4(HOST); // 避免 IPv6 导致的超时
  const candidates = [];

  // 优先用你配置的端口；否则依次试 465→587
  if (PORT_ENV) {
    candidates.push({ host: ip4, port: PORT_ENV, secure: PORT_ENV === 465, requireTLS: PORT_ENV === 587 });
  } else {
    candidates.push({ host: ip4, port: 465, secure: true });
    candidates.push({ host: ip4, port: 587, secure: false, requireTLS: true });
  }

  let lastErr;
  for (const c of candidates) {
    try { await tryProbe(c); console.log('✅ PROBE OK'); return; }
    catch (e) { console.error('[probe] try fail:', e && (e.response || e.message)); lastErr = e; }
  }
  console.error('❌ 所有候选端口均失败（465/587）。最后错误：', lastErr && lastErr.message);
  process.exit(1);
})().catch(e => { console.error('❌ probe fatal:', e.message); process.exit(1); });
