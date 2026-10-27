import { registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

const Printer = registerPlugin("ParimerePrint");
const exportFolder = "parimere-exports";
const directory = Directory.Cache;

export async function initialize() {
  document.documentElement.classList.add("native-app");
  await App.addListener("backButton", async ({ canGoBack }) => {
    const dialog = [...document.querySelectorAll("dialog[open]")].at(-1);
    if (dialog) dialog.close();
    else if (canGoBack) history.back();
    else await App.minimizeApp();
  });
  // Other apps may still be reading recent exports; explicit erasure removes all.
  try {
    const { files } = await Filesystem.readdir({ path: exportFolder, directory });
    for (const file of files) {
      if (Date.now() - file.mtime > 86400000)
        await Filesystem.deleteFile({ path: `${exportFolder}/${file.name}`, directory });
    }
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

function missing(error) {
  return error?.code === "OS-PLUG-FILE-0008" || /does not exist|not exist|not found|ENOENT/i.test(error?.message || "");
}

export async function saveFile(text, name) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error("Invalid export filename.");
  const path = `${exportFolder}/${Date.now()}-${crypto.randomUUID()}-${name}`;
  const { uri } = await Filesystem.writeFile({
    path, directory, data: text, encoding: Encoding.UTF8, recursive: true,
  });
  await Share.share({ title: name, dialogTitle: "Share your Parimere file", files: [uri] });
}

export async function printReport() {
  await Printer.print();
}

export async function clearNativeFiles() {
  try {
    await Filesystem.rmdir({ path: exportFolder, directory, recursive: true });
  } catch (error) {
    if (!missing(error)) throw error;
  }
}
