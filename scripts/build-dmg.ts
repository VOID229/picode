import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const bundleRoot = path.join(root, "src-tauri", "target", "release", "bundle");
const dmgDir = path.join(bundleRoot, "dmg");
const appDir = path.join(bundleRoot, "macos");
const forwardedArgs = Bun.argv.slice(2);
const localDmgConfig = JSON.stringify({
  bundle: {
    createUpdaterArtifacts: false,
  },
});

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function latestFile(directory: string, extension: string) {
  if (!existsSync(directory)) {
    return null;
  }

  const matches = readdirSync(directory)
    .filter((name) => name.endsWith(extension))
    .map((name) => {
      const filePath = path.join(directory, name);
      return {
        filePath,
        mtimeMs: statSync(filePath).mtimeMs,
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return matches[0]?.filePath ?? null;
}

if (process.platform !== "darwin") {
  fail("DMG packaging is only supported when this script is run on macOS.");
}

console.log("Building macOS app bundle and DMG...");
const tauriBuild = Bun.spawn({
  cmd: [
    "bunx",
    "tauri",
    "build",
    "--bundles",
    "app,dmg",
    "--config",
    localDmgConfig,
    "--ci",
    ...forwardedArgs,
  ],
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});

if ((await tauriBuild.exited) !== 0) {
  fail("Tauri DMG build failed.");
}

const appPath = latestFile(appDir, ".app");
const dmgPath = latestFile(dmgDir, ".dmg");

if (!appPath) {
  fail(`Expected a macOS app bundle in ${appDir}, but none was found.`);
}

if (!dmgPath) {
  fail(`Expected a DMG in ${dmgDir}, but none was found.`);
}

console.log("");
console.log(`App bundle: ${appPath}`);
console.log(`DMG: ${dmgPath}`);
console.log("");
console.log(
  "Open the DMG and drag picode.app into Applications to install it.",
);
