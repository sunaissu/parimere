import { cp, mkdir, readFile, writeFile, readdir, rm, realpath } from "node:fs/promises";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { resolve, dirname, basename } from "node:path";

const root = new URL("../", import.meta.url);
const output = new URL("mobile-dist/", root);
const projectPath = await realpath(fileURLToPath(root));
const outputPath = resolve(projectPath, "mobile-dist");
if (dirname(outputPath) !== projectPath || basename(outputPath) !== "mobile-dist")
  throw new Error("Refusing to clean an output directory outside this project.");
await rm(outputPath, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of await readdir(new URL("dist/", root), { withFileTypes: true })) {
  if (entry.name === "sw.js") continue;
  await cp(new URL(`dist/${entry.name}`, root), new URL(entry.name, output), { recursive: true });
}
await build({
  entryPoints: [fileURLToPath(new URL("mobile/native.mjs", root))],
  outfile: fileURLToPath(new URL("native.bundle.mjs", output)),
  bundle: true, format: "esm", platform: "browser", target: "chrome120",
  legalComments: "eof",
});
const policy = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'";
for (const page of ["index.html", "privacy.html", "about.html"]) {
  let html = await readFile(new URL(page, output), "utf8");
  html = html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
  if (!html.includes("viewport-fit=cover"))
    html = html.replace('width=device-width, initial-scale=1', 'width=device-width, initial-scale=1, viewport-fit=cover');
  await writeFile(new URL(page, output), html);
}
let notices = await readFile(new URL("THIRD_PARTY_NOTICES.txt", output), "utf8");
for (const name of ["@capacitor/core", "@capacitor/android", "@capacitor/app", "@capacitor/filesystem", "@capacitor/share"]) {
  const pkg = new URL(`node_modules/${name}/`, root);
  const metadata = JSON.parse(await readFile(new URL("package.json", pkg), "utf8"));
  const names = await readdir(pkg);
  const license = names.find((name) => /^license(?:\.md|\.txt)?$/i.test(name));
  if (!license) throw new Error(`Missing distribution license for ${name}`);
  notices += `\n\n${name} ${metadata.version}\n\n` + await readFile(new URL(license, pkg), "utf8");
}
await writeFile(new URL("THIRD_PARTY_NOTICES.txt", output), notices);
await cp(new URL("mobile/webview-update.html", root), new URL("webview-update.html", output));
console.log("Prepared bundled Android assets in mobile-dist. Web files remain in dist.");
