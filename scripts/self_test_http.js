// scripts/self_test_http.js
// 目的：对生产域名做 GET，确保 200 且包含关键文案
// 运行：node scripts/self_test_http.js  或 在工作流里跑
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';

async function check(url, mustContains){
  const res = await fetch(url, { redirect: 'follow' });
  const text = await res.text();
  const ok = res.status === 200 && mustContains.every(s=>text.includes(s));
  console.log(`${ok?'✅':'❌'} ${url} → ${res.status}`);
  if (!ok) {
    console.log(`   need: ${mustContains.join(' | ')}`);
  }
  return ok;
}

(async function(){
  let pass = true;
  pass &= await check(`${SITE}/`,              ['CG Alert','Pricing','Portfolio']);
  pass &= await check(`${SITE}/updates/`,      ['Top Public Changes','Items']);
  pass &= await check(`${SITE}/updates/rss.xml`,['<rss','<channel>']);
  pass &= await check(`${SITE}/vendors/`,      ['Vendors']);
  pass &= await check(`${SITE}/categories/`,   ['Categories']);
  console.log('\n====================');
  if (pass) console.log('✅ HTTP TEST PASSED'); else { console.log('❌ HTTP TEST FAILED'); process.exit(1); }
})();
