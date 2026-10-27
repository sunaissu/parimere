// Self-contained public documentation builder. Each deployable repository owns a copy.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(resolve(directory, 'content.json'), 'utf8'));
const output = resolve(directory, '..', config.output);
const origin = process.env[config.originEnv || 'SITE_ORIGIN'] || '';
if (origin) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || !/^[a-z0-9.-]+$/i.test(url.hostname)) {
    throw new Error('Public site origin must be HTTPS without credentials, path or trailing slash.');
  }
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const metadata = (title, path) => `<title>${escape(title)}</title><meta name="description" content="${escape(config.description)}"><meta name="robots" content="${origin ? 'index,follow' : 'noindex,follow'}"><meta property="og:type" content="website"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(config.description)}"><meta name="twitter:card" content="summary">${origin ? `<link rel="canonical" href="${origin}${path}"><meta property="og:url" content="${origin}${path}">` : ''}`;
const links = config.links.map(link => {
  if (!/^https:\/\//.test(link.url)) throw new Error('Documentation links must use HTTPS.');
  return `<li><a href="${escape(link.url)}">${escape(link.label)}</a></li>`;
}).join('');
const sections = config.sections.map(section => `<section><h2>${escape(section.heading)}</h2>${section.paragraphs.map(p => `<p>${escape(p)}</p>`).join('')}${section.code ? `<pre><code>${escape(section.code)}</code></pre>` : ''}</section>`).join('');
const schema = config.packageName ? { '@context': 'https://schema.org', '@type': 'SoftwareSourceCode', name: config.packageName, description: config.description, codeRepository: config.links.find(l => l.label === 'Source repository')?.url, programmingLanguage: ['TypeScript', 'JavaScript'], runtimePlatform: 'React', license: 'https://opensource.org/license/mit' } : { '@context': 'https://schema.org', '@type': 'WebApplication', name: config.name, description: config.description, applicationCategory: config.category, operatingSystem: 'Web browser' };
if (origin) schema.url = `${origin}/guide.html`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${metadata(config.title, '/guide.html')}<style>body{font:18px/1.65 system-ui,sans-serif;margin:0;color:#172033;background:#f8fafc}main{max-width:780px;margin:auto;padding:32px 20px}nav{display:flex;gap:24px;flex-wrap:wrap}a{color:#174bc4}h1{line-height:1.2;font-size:2rem}h2{line-height:1.3;margin-top:2rem}pre{overflow:auto;background:#e8edf5;padding:16px;border-radius:8px}section{overflow-wrap:anywhere}footer{border-top:1px solid #ccd5e2;margin-top:32px;padding-top:16px}</style>${config.packageName ? `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>` : ''}</head><body><main><nav aria-label="Product navigation"><a href="/">Open ${escape(config.name)}</a><a href="/product.txt">Plain-text reference</a></nav><h1>${escape(config.title)}</h1><p>${escape(config.description)}</p>${sections}<section><h2>Links</h2><ul>${links || '<li>Use the app link above to open the workspace.</li>'}</ul></section><footer>BG · Product and integration reference. Features describe this source version, not a guarantee that a public release has been published.</footer></main></body></html>`;
mkdirSync(output, {recursive:true});
writeFileSync(resolve(output,'guide.html'),html);
writeFileSync(resolve(output,'product.txt'),[config.title,config.description,...config.sections.flatMap(s=>[s.heading,...s.paragraphs,s.code||'']),...config.links.map(l=>`${l.label}: ${l.url}`)].join('\n\n')+'\n');
if (config.mainMetadata) {
  const filename=resolve(output,'index.html');
  let page=readFileSync(filename,'utf8');
  page=page.replace(/<title>[\s\S]*?<\/title>/gi,'').replace(/<meta\b[^>]*(?:name=["'](?:description|robots|twitter:card)["']|property=["']og:(?:type|title|description|url)["'])[^>]*>/gi,'').replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi,'');
  writeFileSync(filename,page.replace('</head>',()=>metadata(config.title,'/')+'</head>'));
}
const sitemapPath=resolve(output,'sitemap.xml');
// Rebuild our two public routes so a domain change cannot retain the old host.
const sitemap='<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+(origin ? ['/', '/guide.html'].map(path=>`<url><loc>${origin}${path}</loc></url>`).join('') : '')+'</urlset>';
writeFileSync(sitemapPath,sitemap);
const robotsPath=resolve(output,'robots.txt');
let robots=existsSync(robotsPath)?readFileSync(robotsPath,'utf8'):'User-agent: *\nAllow: /\n';
robots=robots.replace(/^Sitemap:.*$/gm,'').trim()+'\n';
if(origin)robots+=`Sitemap: ${origin}/sitemap.xml\n`;
writeFileSync(robotsPath,robots);
console.log(`${config.name}: built public guide, plain-text reference and sitemap (${origin ? 'public' : 'preview/noindex'}).`);
