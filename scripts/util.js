import fs from 'fs';
import fse from 'fs-extra';
import path from 'path';
import dayjs from 'dayjs';

export function loadJSON(p, fallback=null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fallback; }
}
export function ensureDir(p) { fse.ensureDirSync(p); }
export function writeText(p, s) { ensureDir(path.dirname(p)); fs.writeFileSync(p, s, 'utf-8'); }
export function fmtDate(d) { return (dayjs().utc ? dayjs().utc(d) : dayjs(d)).format('YYYY-MM-DD'); }
export function yyyymm(d=dayjs()) { return (dayjs().utc ? dayjs().utc(d) : dayjs(d)).format('YYYY-MM'); }
