import { promises as fs } from 'node:fs';
import path from 'node:path';
const root = process.cwd();
async function ensure() {
  const src = path.join(root, 'public', 'sitemap.xml');
  const dst = path.join(root, 'public', 'seo', 'sitemap.xml');
  try {
    await fs.mkdir(path.dirname(dst), { recursive: true });
    const buf = await fs.readFile(src);
    await fs.writeFile(dst, buf);
    console.log('sitemap_sync: ensured public/seo/sitemap.xml exists');
  } catch (e) {
    console.warn('sitemap_sync: warning: cannot ensure public/seo/sitemap.xml -', e.message);
  }
}
await ensure();
