import {
  mkdir,
  copyFile,
  writeFile,
  readdir,
  readFile,
} from "node:fs/promises";
const root = new URL("../", import.meta.url),
  target = new URL("dist/vendor/", root);
await mkdir(new URL("core/", target), { recursive: true });
await mkdir(new URL("lang/", target), { recursive: true });
const files = [
  ["tesseract.js/dist/tesseract.min.js", "tesseract.min.js"],
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
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
const licenses = [];
for (const name of [
  "tesseract.js",
  "tesseract.js-core",
  "@zxing/browser",
  "@zxing/library",
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
  try {
    await copyFile(
      new URL("node_modules/" + name + "/LICENSE", root),
      new URL(name.replaceAll("/", "-") + "-LICENSE.txt", target),
    );
  } catch {}
}
await writeFile(
  new URL("THIRD_PARTY_NOTICES.txt", root),
  licenses.join("\n") +
    "\nEnglish data package declares MIT; upstream Tesseract language data attribution: https://github.com/tesseract-ocr/tessdata (Apache-2.0).\n",
);
console.log(
  "Prepared local OCR and barcode assets; no photos or application data were sent.",
);
