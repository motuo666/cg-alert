
// Seeds 3 demo evidence items for acceptance. Safe to delete after.
import { promises as fs } from 'fs';
import path from 'path';
const dir = 'evidence/demo';
await fs.mkdir(dir, {recursive:true});
const now = new Date();
const items = [
  {vendor:'Acme CRM', url:'https://acme.example.com/pricing', title:'Pricing change: Enterprise tier updated', snippet:'Enterprise plan now includes SSO; price +$100/mo', ts:new Date(now.getTime()-3600e3).toISOString()},
  {vendor:'Northwind Analytics', url:'https://northwind.example.com/terms', title:'Terms: Liability cap changed', snippet:'Liability changed from 12x to 6x MRR', ts:new Date(now.getTime()-7200e3).toISOString()},
  {vendor:'Globex Cloud', url:'https://globex.example.com/subprocessors', title:'Sub‑processors list updated', snippet:'Added AWS Frankfurt region; removed GCP Taiwan', ts:new Date(now.getTime()-10800e3).toISOString()},
];
for (const [i, it] of items.entries()){
  await fs.writeFile(path.join(dir, `demo${i+1}.json`), JSON.stringify(it, null, 2), 'utf-8');
}
console.log('Seeded demo evidence (3 files).');
