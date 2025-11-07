
// Build vendors index (safe if empty). Optional; kept for parity.
import { promises as fs } from 'fs';
import path from 'path';
const PUBLISH_DIR = process.env.PUBLISH_DIR || '.';
async function main(){
  await fs.mkdir(PUBLISH_DIR, {recursive:true});
  // no-op stub to avoid failing pipelines
  console.log('vendors index size 0 (stub ok)');
}
await main();
