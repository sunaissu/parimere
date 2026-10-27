export const isNative = !!globalThis.Capacitor?.isNativePlatform?.();
let native;
const nativeAPI = () => native ??= import("./native.bundle.mjs");

export async function initPlatform() {
  if (isNative) await (await nativeAPI()).initialize();
}

export async function saveFile(text, name, type) {
  if (isNative) return (await nativeAPI()).saveFile(text, name, type);
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function printReport() {
  if (isNative) return (await nativeAPI()).printReport();
  window.print();
}

export async function clearNativeFiles() {
  if (isNative) await (await nativeAPI()).clearNativeFiles();
}
