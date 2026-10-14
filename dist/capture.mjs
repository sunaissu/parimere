const scripts = new Map();
function script(path) {
  if (!scripts.has(path))
    scripts.set(
      path,
      new Promise((resolve, reject) => {
        const element = document.createElement("script");
        element.src = path;
        element.onload = resolve;
        element.onerror = () => {
          scripts.delete(path);
          reject(
            new Error(
              "The local capture library is unavailable. Reconnect to install its assets.",
            ),
          );
        };
        document.head.append(element);
      }),
    );
  return scripts.get(path);
}
export async function capturePhoto(file, mode) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 8 * 1048576
  )
    throw new Error("Choose a PNG, JPEG or WebP photo up to 8 MiB.");
  const bitmap = await createImageBitmap(file);
  if (bitmap.width * bitmap.height > 16000000) {
    bitmap.close();
    throw new Error("Use a photo with at most 16 million pixels.");
  }
  const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height)),
    canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  if (mode === "barcode") {
    await script("/vendor/zxing-browser.min.js");
    try {
      return new globalThis.ZXingBrowser.BrowserMultiFormatReader()
        .decodeFromCanvas(canvas)
        .getText();
    } catch {
      throw new Error(
        "No barcode was readable. Try a sharper photo or enter the printed barcode.",
      );
    }
  }
  await script("/vendor/tesseract.min.js");
  let worker,
    expired = false,
    timer;
  const job = (async () => {
    worker = await globalThis.Tesseract.createWorker("eng", 1, {
      workerPath: "/vendor/worker.min.js",
      workerBlobURL: false,
      corePath: "/vendor/core",
      langPath: "/vendor/lang",
      cacheMethod: "none",
      logger: () => {},
      errorHandler: () => {},
    });
    if (expired) {
      await worker.terminate();
      throw new Error("OCR timed out.");
    }
    const { data } = await worker.recognize(canvas);
    return { text: data.text, preview: canvas };
  })();
  try {
    return await Promise.race([
      job,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(
            new Error("OCR exceeded 45 seconds. Try a smaller, sharper photo."),
          );
        }, 45000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (worker) await worker.terminate();
  }
}
