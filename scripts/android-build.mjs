import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const release = process.argv[2] === "release";
if (release && !["PARIMERE_KEYSTORE", "PARIMERE_STORE_PASSWORD", "PARIMERE_KEY_ALIAS", "PARIMERE_KEY_PASSWORD"].every((key) => process.env[key])) {
  console.error("Release signing is missing. Set the four PARIMERE_* signing variables described in ANDROID_BUILD.txt, or use Android Studio's Generate Signed Bundle wizard.");
  process.exit(1);
}
const cwd = fileURLToPath(new URL("../android/", import.meta.url));
const windows = process.platform === "win32";
const command = windows ? "cmd.exe" : "sh";
const tasks = release ? ["bundleRelease", "lintRelease"] : ["assembleDebug", "lintDebug"];
const args = windows ? ["/d", "/c", "gradlew.bat", ...tasks, "--no-daemon"] : ["./gradlew", ...tasks, "--no-daemon"];
const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
