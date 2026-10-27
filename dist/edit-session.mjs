import { setStorageWritable } from "./storage.mjs";

let release;
export async function startEditSession() {
  setStorageWritable(false);
  if (!navigator.locks?.request) return "unsupported";
  const state = await new Promise((resolve) => {
    navigator.locks.request("parimere-editor", { ifAvailable: true }, async (lock) => {
      if (!lock) return resolve("occupied");
      setStorageWritable(true);
      resolve("writable");
      await new Promise((done) => { release = done; });
    }).catch(() => resolve("unsupported"));
  });
  window.addEventListener("pagehide", () => {
    setStorageWritable(false);
    release?.();
  }, { once: true });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
  return state;
}
