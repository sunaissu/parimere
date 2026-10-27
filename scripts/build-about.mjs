import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../dist/', import.meta.url);
const origin = process.env.SITE_ORIGIN || '';
const mark = async (file, width, height) => (await readFile(new URL(file, root), 'utf8')).trim()
  .replaceAll('#172033', 'currentColor')
  .replace('<svg ', `<svg width="${width}" height="${height}" focusable="false" `);
const [sunaissu, signature] = await Promise.all([
  mark('sunaissu-logo.svg', 100, 32), mark('creator-mark.svg', 48, 24),
]);
await writeFile(new URL('about.html', root), `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>About Parimere | Sunaissu</title><meta name="description" content="Compare pack sizes and prices with Parimere, made by Sunaissu." />
<meta name="robots" content="${origin ? 'index,follow' : 'noindex,follow'}" />
${origin ? `<link rel="canonical" href="${origin}/about.html" />` : ''}
<link rel="icon" href="./icon.svg" type="image/svg+xml" />
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f7fc;color:#182236;font:17px/1.7 system-ui,sans-serif}
main{max-width:720px;margin:auto;padding:40px 24px}nav{display:flex;gap:24px;flex-wrap:wrap;font-size:14px}
a{color:#285dcf;text-underline-offset:4px}a:focus-visible{outline:2px solid currentColor;outline-offset:4px}
h1{font-size:clamp(32px,6vw,48px);line-height:1.1;letter-spacing:-.04em;margin:48px 0 24px}h2{font-size:21px;margin-top:32px}
footer{display:flex;align-items:center;gap:10px;margin-top:40px;padding-top:20px;border-top:1px solid #ccd5e2;font-size:12px}
.signature{margin-top:24px}svg{display:block}
@media(prefers-color-scheme:dark){body{background:#0a1020;color:#e2ecff}a{color:#79b4ff}footer{border-color:#253650}}
</style></head><body><main>
<nav aria-label="Product navigation"><a href="./">Back to comparison</a><a href="./guide.html">Comparison guide</a><a href="./privacy.html">Privacy</a></nav>
<h1>A clearer way to compare prices.</h1>
<p>Parimere helps you compare different pack sizes, discounts and purchase costs, so you can see what gives you better value.</p>
<h2>Start with the price and size</h2><p>Add the offers you are considering. Parimere calculates their unit prices on your device. When you need them, purchase planning, saved products and other tools are available from the comparison screen.</p>
<h2>Made by Sunaissu</h2><p>Sunaissu is the name behind Parimere. The bg_ mark below is the creator signature.</p>
<div class="signature">${signature}</div>
<h2>Your comparisons, on your device</h2><p>Save and export comparisons to keep a copy. Web exchange rates are daily reference rates; your bank or payment provider may charge a different amount.</p>
<footer><span>by</span>${sunaissu}</footer>
</main></body></html>\n`);
