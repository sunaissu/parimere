import { readFile, access } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const read = async (path) => readFile(new URL(path, root), "utf8");
const config = JSON.parse(await read("release-config.json"));
const cap = JSON.parse(await read("capacitor.config.json"));
const blockers = [];
const check = (condition, message) => { if (!condition) blockers.push(message); };
check(!!config.publisherName.trim(), "Choose the publisher/legal identity.");
check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.supportEmail), "Provide a public support/privacy email.");
check(/^https:\/\//.test(config.privacyPolicyUrl), "Publish the final privacy policy at a public HTTPS URL.");
check(config.applicationIdApproved === true, `Confirm the permanent application ID (${cap.appId}).`);
check(config.privacyPolicyFinalized === true, "Finish and review privacy.html for the actual release.");
check(config.brandReviewCompleted === true, "Complete name and final-logo screening for the launch countries; indexed web searches alone are incomplete.");
check(config.assetRightsConfirmed === true, "Confirm rights and source records for the app icon and creator branding.");
check(!/Draft for release review/.test(await read("dist/privacy.html")), "Privacy page still contains draft release copy.");
check(config.distributionCountries.length > 0 && !!config.targetAudience.trim(), "Choose launch countries and the actual intended audience.");
check(!cap.server?.url, "Remove any remote live-reload server URL from Capacitor config.");
const variables = await read("android/variables.gradle");
check(/targetSdkVersion\s*=\s*(36|[4-9]\d)/.test(variables), "Target at least Android API 36; recheck current Play requirements before upload.");
const manifest = await read("android/app/src/main/AndroidManifest.xml");
check(manifest.includes('android:allowBackup="false"'), "Review Android backup behavior.");
check(!/android.permission.(READ_MEDIA|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|CAMERA|ACCESS_FINE_LOCATION)/.test(manifest), "Review requested sensitive permissions against the actual features.");
try { await access(new URL("android/app/build/outputs/bundle/release/app-release.aab", root)); }
catch { blockers.push("Build a signed release AAB; none exists in the expected output location."); }
console.log("Parimere release preparation check (not Play approval)");
if (blockers.length) {
  blockers.forEach((item) => console.log("BLOCKED: " + item));
  process.exitCode = 1;
} else console.log("Local preparation checks passed. This script does not verify signing, public URLs or Console status.");
console.log("Still verify on actual devices: installation/upgrades, storage, offline use, import/export/share, print, scanning, Back, keyboard and accessibility. Inspect merged permissions, network traffic and final libraries; complete Play Console declarations/testing.");
