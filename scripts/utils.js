// Minimal hardened utils for Node 18+ / 20+
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

export async function readJSON(p, def = null) {
  try {
    const s = await fs.readFile(p, 'utf8');
    return JSON.parse(s);
  } catch (e) {
    if (def !== null) return def;
    throw e;
  }
}

export async function writeJSON(p, obj) {
  await ensureDir(path.dirname(p));
  const s = JSON.stringify(obj, null, 2);
  await fs.writeFile(p, s, 'utf8');
}

export function env(name, fallback = undefined) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing env ${name}`);
  }
  return v;
}

export async function sha256Hex(input) {
  const h = crypto.createHash('sha256');
  h.update(typeof input === 'string' ? input : Buffer.from(input));
  return h.digest('hex');
}

export async function hmacSha256Hex(key, msg) {
  const h = crypto.createHmac('sha256', key);
  h.update(msg);
  return h.digest('hex');
}

export function nowISO() {
  return new Date().toISOString();
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function safeJSON(obj) {
  try { return JSON.stringify(obj); } catch { return '"<unserializable>"'; }
}
