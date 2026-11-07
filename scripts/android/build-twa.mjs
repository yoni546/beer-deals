#!/usr/bin/env node
/**
 * Builds the Google Play app (an Android App Bundle) from the live web app: a Trusted Web Activity, which
 * is Chrome showing https://beer-deals.vercel.app full-screen under our own package name. Nothing about the
 * app is duplicated here — screens, prices and notifications are the website's, so every release of the site
 * is a release of the app. What this adds is the Android shell: icon, splash, name, and the delegation that
 * turns web push into Android notifications.
 *
 *   node scripts/android/build-twa.mjs --version-code <n>
 *
 * Needs JDK 17 (JAVA_HOME) and the Android SDK (ANDROID_HOME); the GitHub workflow android.yml provides both.
 * Signs with the upload key from the environment, never from a file in the repository:
 *   ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_PASSWORD (alias from android/app.json).
 * Google re-signs with its own Play App Signing key; both fingerprints go in android/app.json, which is what
 * /.well-known/assetlinks.json publishes so Android trusts the site to open without a browser bar.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AndroidSdkTools, Config, ConsoleLog, GradleWrapper, JarSigner, JdkHelper, TwaGenerator, TwaManifest } from "@bubblewrap/core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? "" : (args[i + 1] ?? "");
};
const versionCode = Number(flag("version-code"));
if (!Number.isInteger(versionCode) || versionCode < 1) throw new Error("pass --version-code <positive integer> (Google Play needs it to grow with every upload)");
for (const name of ["JAVA_HOME", "ANDROID_HOME", "ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_PASSWORD"]) {
  if (!process.env[name]) throw new Error(`${name} is not set`);
}

const app = JSON.parse(readFileSync(join(ROOT, "android", "app.json"), "utf8"));
const out = join(ROOT, "android", "build");
const project = join(out, "project");
rmSync(out, { recursive: true, force: true });
mkdirSync(project, { recursive: true });

// The shell is generated from the site's own manifest (name, colours, icons, shortcuts), then given our
// fixed identity. The live manifest is read, so the icon on the phone is the icon the site serves.
const manifestUrl = `https://${app.host}/manifest.webmanifest`;
const twa = await TwaManifest.fromWebManifest(manifestUrl);
Object.assign(twa, {
  packageId: app.packageId,
  host: app.host,
  name: app.name,
  launcherName: app.launcherName,
  appVersionCode: versionCode,
  appVersionName: app.versionName,
  // Web push from the site arrives as Android notifications, under the app's own name and permission.
  enableNotifications: true,
  // If the phone has no browser that supports TWAs, a WebView still opens the app rather than failing.
  fallbackType: "webview",
  signingKey: { path: process.env.ANDROID_KEYSTORE_PATH, alias: app.signingKeyAlias },
});
const problem = twa.validate();
if (problem) throw new Error(`twa manifest: ${problem}`);

const log = new ConsoleLog("build-twa");
await new TwaGenerator().createTwaProject(project, twa, log);

const config = new Config(process.env.JAVA_HOME, process.env.ANDROID_HOME);
const jdk = new JdkHelper(process, config);
const sdk = await AndroidSdkTools.create(process, config, jdk, log);
await new GradleWrapper(process, sdk, project).bundleRelease();

const unsigned = join(project, "app", "build", "outputs", "bundle", "release", "app-release.aab");
const signed = join(out, `beer-deals-${app.versionName}-${versionCode}.aab`);
await new JarSigner(jdk).sign(twa.signingKey, process.env.ANDROID_KEYSTORE_PASSWORD, process.env.ANDROID_KEY_PASSWORD, unsigned, signed);
copyFileSync(signed, join(out, "app-release-signed.aab"));
console.log(`built ${signed}`);
