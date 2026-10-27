import { readFile, writeFile } from 'node:fs/promises';

const origin = process.env.SITE_ORIGIN || '';
if (origin) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || !/^[a-z0-9.-]+$/i.test(url.hostname)) {
    throw new Error('SITE_ORIGIN must be an HTTPS origin without a path or trailing slash.');
  }
}
const destination = new URL('../dist/', import.meta.url);
const index = new URL('index.html', destination);
let html = await readFile(index, 'utf8');
html = html.replace(/\s*<!-- search:start -->[\s\S]*?<!-- search:end -->/g, '');
const metadata = `\n    <!-- search:start -->
    <meta name="robots" content="${origin ? 'index,follow' : 'noindex,follow'}" />
    ${origin ? `<link rel="canonical" href="${origin}/" /><meta property="og:url" content="${origin}/" /><meta property="og:image" content="${origin}/icon-512.png" />` : ''}
    <!-- search:end -->\n`;
await writeFile(index, html.replace('</head>', `${metadata}</head>`));
await writeFile(new URL('robots.txt', destination), `User-agent: *\nAllow: /\nDisallow: /api/\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ''}`);
await writeFile(new URL('sitemap.xml', destination), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${origin ? `<url><loc>${origin}/</loc></url>` : ''}</urlset>`);
