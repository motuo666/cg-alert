
import fs from 'fs/promises';
import path from 'path';

const evidenceDir = 'evidence';
await fs.mkdir(evidenceDir, { recursive: true });
const now = new Date().toISOString();

const samples = [
  {
    id: 'sample-1',
    vendor: 'Example SaaS',
    domain: 'example.com',
    url: 'https://example.com/pricing',
    area: 'Pricing',
    changed: 'Price for Pro increased from $49 → $59 / mo.',
    captured_at: '2025-11-07T09:46:06.032625Z',
    sha256: 'demo-hash-1'
  },
  {
    id: 'sample-2',
    vendor: 'Contoso CRM',
    domain: 'contoso.com',
    url: 'https://contoso.com/terms',
    area: 'Terms',
    changed: 'Indemnity cap changed from 6× fees → 3× fees.',
    captured_at: '2025-11-07T09:46:06.032636Z',
    sha256: 'demo-hash-2'
  },
  {
    id: 'sample-3',
    vendor: 'Fabrikam Analytics',
    domain: 'fabrikam.io',
    url: 'https://fabrikam.io/subprocessors',
    area: 'Subprocessors',
    changed: 'Added subprocessor: ACME Cloud EU region.',
    captured_at: '2025-11-07T09:46:06.032638Z',
    sha256: 'demo-hash-3'
  }
];

for (const s of samples) {
  const f = path.join(evidenceDir, `${s.captured_at.replace(/[:.]/g,'-')}_${s.domain}_${s.area}.json`);
  await fs.writeFile(f, JSON.stringify(s, null, 2));
  console.log('wrote', f);
}
