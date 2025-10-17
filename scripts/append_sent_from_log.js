// scripts/append_sent_from_log.js
// Node 20，无第三方依赖
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logPath = process.argv[2];
if (!logPath) {
  console.error('Usage: node scripts/append_sent_from_log.js <LOG_PATH>');
  process.exit(1);
}
const csvPath = path.join(__dirname, '..', 'data', 'sent_log.csv');
fs.mkdirSync(path.dirname(csvPath), { recursive: true });

function ensureHeader(p){
  if (!fs.existsSync(p) || fs.statSync(p).size === 0) {
    fs.writeFileSync(p, 'ts,email,subject,link\n');
  }
}
ensureHeader(csvPath);

const raw = fs.readFileSync(logPath, 'utf8');
const lines = raw.split(/\r?\n/);
let appended = 0;

for (const line of lines) {
  // 只认真实发送的 SENT 行，忽略 DRY
  // 例：SENT to user@x.com subj="..." link="https://..."
  const m = line.match(/^SENT\s+to\s+(\S+)\s+subj="([^"]*)"(?:\s+link="([^"]*)")?/);
  if (!m) continue;
  const email = m[1];
  const subj  = m[2] ?? '';
  const link  = m[3] ?? '';
  const ts = new Date().toISOString(); // UTC
  const esc = (s) => `"${String(s).replace(/"/g,'""')}"`;
  fs.appendFileSync(csvPath, `${ts},${esc(email)},${esc(subj)},${esc(link)}\n`);
  appended++;
}

console.log(`append_sent_from_log: appended=${appended}, file=${csvPath}`);
