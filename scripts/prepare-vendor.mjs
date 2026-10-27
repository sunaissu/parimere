import {
  mkdir,
  copyFile,
  writeFile,
  readdir,
  readFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url),
  target = new URL("dist/vendor/", root);
const bundled = JSON.parse(await readFile(new URL("licenses/bundled-assets.json", root), "utf8"));
for (const asset of bundled.assets) {
  const bytes = await readFile(new URL("node_modules/" + asset.path, root));
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
    throw new Error("Bundled asset changed; verify its dependency notices: " + asset.path);
}
await mkdir(new URL("core/", target), { recursive: true });
await mkdir(new URL("lang/", target), { recursive: true });
const files = [
  ["tesseract.js/dist/tesseract.min.js", "tesseract.min.js"],
  ["tesseract.js/dist/tesseract.min.js.LICENSE.txt", "tesseract.min.js.LICENSE.txt"],
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["tesseract.js/dist/worker.min.js.LICENSE.txt", "worker.min.js.LICENSE.txt"],
  ["@zxing/browser/umd/zxing-browser.min.js", "zxing-browser.min.js"],
  [
    "@tesseract.js-data/eng/4.0.0/eng.traineddata.gz",
    "lang/eng.traineddata.gz",
  ],
];
for (const name of await readdir(
  new URL("node_modules/tesseract.js-core/", root),
))
  if (name.endsWith(".wasm.js") && name.includes("lstm"))
    files.push(["tesseract.js-core/" + name, "core/" + name]);
for (const [source, name] of files)
  await copyFile(
    new URL("node_modules/" + source, root),
    new URL(name, target),
  );
await writeFile(
  new URL("assets.json", target),
  JSON.stringify(files.map(([, name]) => "/vendor/" + name)),
);
const licenses = [], licenseTexts = [];
for (const name of [
  "tesseract.js",
  "tesseract.js-core",
  "@zxing/browser",
  "@tesseract.js-data/eng",
]) {
  const p = JSON.parse(
    await readFile(
      new URL("node_modules/" + name + "/package.json", root),
      "utf8",
    ),
  );
  licenses.push(
    name +
      " " +
      p.version +
      " — " +
      p.license +
      " — " +
      (typeof p.repository === "string"
        ? p.repository
        : p.repository?.url || ""),
  );
  const packageFiles = await readdir(new URL("node_modules/" + name + "/", root));
  const licenseFile = packageFiles.find((candidate) => /^licen[cs]e(?:[.-](?:md|txt|mit))?$/i.test(candidate));
  if (name === bundled.languageData.package) continue;
  if (!licenseFile)
    console.warn("No license file bundled for " + name + "; review upstream terms before distribution.");
  if (licenseFile) {
    const licenseSource = new URL(
      "node_modules/" + name + "/" + licenseFile,
      root,
    );
    await copyFile(
      licenseSource,
      new URL(name.replaceAll("/", "-") + "-LICENSE.txt", target),
    );
    licenseTexts.push(name + " " + p.version + "\n\n" + await readFile(licenseSource, "utf8"));
  }
}
for (const [source, name] of files.filter(([, name]) => name.endsWith(".LICENSE.txt")))
  licenseTexts.push(name + "\n\n" + await readFile(new URL("node_modules/" + source, root), "utf8"));
for (const entry of bundled.notices) {
  licenses.push(entry.name + " " + entry.version + " (embedded) — " + entry.license + " — " + entry.source);
  const source = new URL("licenses/" + entry.licenseFile, root);
  await copyFile(source, new URL(entry.licenseFile, target));
  licenseTexts.push(entry.name + " " + entry.version + " (embedded)\n\n" + await readFile(source, "utf8"));
}
for (const entry of bundled.nativeNotices) {
  licenses.push(entry.name + " (native revision " + entry.revision + ") — " + entry.license + " — " + entry.source);
  const source = new URL("licenses/" + entry.licenseFile, root);
  await copyFile(source, new URL(entry.licenseFile, target));
  licenseTexts.push(entry.name + " (native revision " + entry.revision + ")\n\n" + await readFile(source, "utf8"));
}
const language = bundled.languageData;
const languageNotice = "English traineddata: " + language.package + " " + language.version +
  " declares " + language.metadataLicense + " in package metadata but ships no license file. " +
  "The distributed 4.0.0/eng.traineddata.gz is byte-identical to " + language.source +
  " (Git blob " + language.gitBlob + "). The source repository's " + language.license +
  " license is reproduced below. License source: " + language.licenseSource + ".";
const languageLicense = new URL("licenses/" + language.licenseFile, root);
await copyFile(languageLicense, new URL(language.licenseFile, target));
licenseTexts.push("English traineddata\n" + languageNotice + "\n\n" + await readFile(languageLicense, "utf8"));
const notices = licenses.join("\n") +
  "\n\nEmbedded JavaScript dependency versions were verified against the distributed bundle source maps.\n" +
  bundled.nativeBuild.method + " Source: " + bundled.nativeBuild.source + ".\n" +
  "This software is based in part on the work of the Independent JPEG Group.\n" +
  languageNotice + "\n\n" +
  licenseTexts.join("\n\n" + "=".repeat(72) + "\n\n").trimEnd() + "\n";
await writeFile(new URL("THIRD_PARTY_NOTICES.txt", root), notices);
await writeFile(new URL("dist/THIRD_PARTY_NOTICES.txt", root), notices);
console.log(
  "Prepared local OCR and barcode assets; no photos or application data were sent.",
);
