// scripts/lib/slack_notify.js -- minimal, dependency-free Slack notifier (incoming webhook)
const https = require('https');
function post(webhookURL, text) {
  return new Promise((resolve, reject) => {
    if (!webhookURL) return resolve({ ok: false, err: 'No SLACK_WEBHOOK provided' });
    try {
      const data = JSON.stringify({ text });
      const url = new URL(webhookURL);
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + (url.search || ''),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      }, res => { res.on('data', ()=>{}); res.on('end', ()=> resolve({ ok: true, status: res.statusCode })); });
      req.on('error', reject);
      req.write(data); req.end();
    } catch (e) { reject(e); }
  });
}
module.exports = { post };