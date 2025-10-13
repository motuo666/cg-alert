#!/usr/bin/env node
/**
 * promote-intakes.js — 每15分钟把 data/intakes.csv 去重追加到 data/customers.csv
 * 并发锁、幂等、表头智能、容错；仅 Node 内置模块
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, '.tmp');
const IN = path.join(ROOT, 'data', 'intakes.csv');
const OUT = path.join(ROOT, 'data', 'customers.csv');
const DRY = process.env.PROMOTE_DRY === '1';
const MAX = Number(process.env.PROMOTE_MAX || 0);
const STRICT = process.env.PROMOTE_STRICT_HEADER === '1';

function read(p){ return fs.existsSync(p) ? fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'') : ''; }
function sha1(s){ return crypto.createHash('sha1').update(s).digest('hex'); }
function splitCSV(t){ return t.split(/\r?\n/).filter(Boolean); }
function parseRow(line){ return line.split(',').map(s=>s.trim()); }
function detectHeader(lines){
  if(!lines.length) return { has:false, header:[], rows:[] };
  const first = parseRow(lines[0]);
  if (first.findIndex(c=>/email/i.test(c)) !== -1) return { has:true, header:first, rows: lines.slice(1).map(parseRow) };
  return { has:false, header:[], rows: lines.map(parseRow) };
}
function emailOf(row){ const i=row.findIndex(c=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)); return i===-1?'':row[i].toLowerCase(); }

function withLock(fn){
  fs.mkdirSync(TMP, { recursive:true });
  const lock = path.join(TMP, 'promote-intakes.lock');
  if (fs.existsSync(lock)) { console.log('promote: lock exists → skip'); process.exit(0); }
  fs.writeFileSync(lock, String(process.pid));
  try{ fn(); } finally { try{ fs.unlinkSync(lock); }catch(e){} }
}

withLock(function(){
  fs.mkdirSync(path.join(ROOT,'data'), { recursive:true });
  const inTxt = read(IN).trim(); if (!inTxt) { console.log('promote: no intakes'); return; }
  const outTxt = read(OUT).trim();
  const inParsed  = detectHeader(splitCSV(inTxt));
  const outParsed = detectHeader(splitCSV(outTxt));
  const outRows = []; let outHeader = [];
  if (outParsed.has){ outHeader = outParsed.header; outRows.push(...outParsed.rows); }
  else if (inParsed.has){ outHeader = inParsed.header; outRows.push(...outParsed.rows); }
  else { outHeader = []; outRows.push(...outParsed.rows); }

  const seenEmails = new Set(outRows.map(emailOf).filter(Boolean));
  const seenHashes = new Set(outRows.map(r => sha1(r.join(','))));

  let scanned=0, skipped=0; const toAppend=[];
  for (const row of inParsed.rows){
    scanned++;
    const em = emailOf(row);
    if (em && seenEmails.has(em)) { skipped++; continue; }
    const sig = sha1(row.join(','));
    if (seenHashes.has(sig)) { skipped++; continue; }
    if (outHeader.length && STRICT && row.length !== outHeader.length) { skipped++; continue; }
    toAppend.push(row);
    seenHashes.add(sig); if (em) seenEmails.add(em);
    if (MAX && toAppend.length >= MAX) break;
  }

  const outLines = [];
  if (outHeader.length) outLines.push(outHeader.join(','));
  outLines.push(...outRows.map(r=>r.join(',')));
  outLines.push(...toAppend.map(r=>r.join(',')));

  if (DRY) { console.log(`promote(dry): scanned=${scanned}, added=${toAppend.length}, skipped=${skipped}, customers_total=${outRows.length + toAppend.length}`); return; }
  fs.writeFileSync(OUT, outLines.join('\n')+'\n','utf8');
  console.log(`promote: scanned=${scanned}, added=${toAppend.length}, skipped=${skipped}, customers_total=${outRows.length + toAppend.length}`);
});
process.exit(0);
