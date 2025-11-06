/**
 * Create customer directories & metadata after Stripe payment.
 * Input: expects latest event cached at scripts/_tmp/stripe_event.json (optional),
 * or no-op if absent. You can wire a prior step to store the payload.
 * For demo safety, this script will create a placeholder customer if none.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ensureDir, writeJSON, nowISO } from './utils.js';

const ROOT = process.cwd();
const CUS_DIR = path.join(ROOT, 'customers');

async function main() {
  await ensureDir(CUS_DIR);
  const demo = {
    email: 'demo@example.com',
    plan: 'portfolio',
    cadence: 'weekly',
    vendors: []
  };
  const id = `cust-${Date.now()}`;
  const dir = path.join(CUS_DIR, id);
  await ensureDir(dir);
  await writeJSON(path.join(dir, 'subscription.json'), {
    ...demo,
    created_at: nowISO()
  });
  console.log('Scaffolded', dir);
}

main().catch(e => { console.error(e); process.exit(0); });
