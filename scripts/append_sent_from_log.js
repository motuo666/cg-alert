import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logPath = process.argv[2];
if (!logPath) { console.error('Usage: node scripts/append_sent_from_log.js <LOG_PATH>'); process.exit(1); }

const csvPath = path.join(__dirname, '..', 'data', 'sent_log.csv');
fs.mkdirSync(path.dirname(csvPath), { recursive: true });

function ensureHeader(p){
  if (!fs.existsSync(p) || fs.statSync(p).size === 0) fs.writeFileSync(p, 'ts,email,subject,link\n');
}
ensureHeader(csvPath);

const raw = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
const lines = raw.split(/\r?\n/);
let appended = 0;

for (const line of lines) {
  // 仅匹配真实发送（忽略 DRY）
  const m = line.match(/^SENT\s+to\s+(\S+)\s+subj="([^"]*)"(?:\s+link="([^"]*)")?/);
  if (!m) continue;
  const [ , email, subj = '', link = '' ] = m;
  const ts = new Date().toISOString(); // UTC
  const esc = (s) => `"${String(s).replace(/"/g,'""')}"`;
  fs.appendFileSync(csvPath, `${ts},${esc(email)},${esc(subj)},${esc(link)}\n`);
  appended++;
}
console.log(`append_sent_from_log: appended=${appended}, file=${csvPath}`);
