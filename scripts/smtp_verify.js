#!/usr/bin/env node
/**
 * smtp_verify.js —— 发信前自检（支持 Brevo/SES）
 * - 自动去掉环境变量两端空白
 * - 先试 465(SSL)，失败则回退到 587(STARTTLS)
 * - 输出最小化诊断信息（不泄漏 secrets）
 */
const nodemailer = require('nodemailer');

function clean(s){ return (s||'').toString().trim(); }

const host = clean(process.env.SMTP_HOST);
const user = clean(process.env.SMTP_USER);
const pass = clean(process.env.SMTP_PASS);
let   port = Number(process.env.SMTP_PORT || 465);

if(!host || !user || !pass){
  console.error('❌ SMTP env missing (SMTP_HOST/SMTP_USER/SMTP_PASS)');
  process.exit(1);
}

async function tryVerify(p, secure){
  const tx = nodemailer.createTransport({
    host, port: p, secure,
    auth: { user, pass },
    // 对 587：强制 STARTTLS，弱网更稳
    ...(secure ? {} : { requireTLS: true})
  });
  await tx.verify(); // 只握手与 AUTH，不发送
}

(async ()=>{
  try{
    // 先用你配置的端口
    await tryVerify(port, port === 465);
    console.log(`✅ SMTP verify ok (${host}:${port}, user="${user}")`);
    process.exit(0);
  }catch(e1){
    // 若不是 465，则先试 465
    if(port !== 465){
      try{
        await tryVerify(465, true);
        console.log(`✅ SMTP verify ok (${host}:465, user="${user}")`);
        process.exit(0);
      }catch(_){}
    }
    // 再试 587 STARTTLS
    try{
      await tryVerify(587, false);
      console.log(`✅ SMTP verify ok (${host}:587, user="${user}")`);
      process.exit(0);
    }catch(e2){
      const msg = (e2 && (e2.response || e2.message)) || (e1 && (e1.response || e1.message)) || e2 || e1;
      console.error('❌ SMTP verify failed:', msg);
      // 典型：535 5.7.8 Authentication failed => user/pass/权限错误
      process.exit(1);
    }
  }
})();
