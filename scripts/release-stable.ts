import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const bundleRoot = path.join(root, "src-tauri", "target", "release", "bundle");
const dmgDir = path.join(bundleRoot, "dmg");
const macosDir = path.join(bundleRoot, "macos");
const manifestPath = path.join(bundleRoot, "latest.json");

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

async function run(cmd: string[]) {
  const child = Bun.spawn({
    cmd,
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });

  if ((await child.exited) !== 0) {
    fail(`Command failed: ${cmd.join(" ")}`);
  }
}

if (process.platform !== "darwin") {
  fail("Stable DMG releases must be created on macOS.");
}

console.log("Building macOS app bundle with updater artifacts...");
await run([
  "bunx",
  "tauri",
  "build",
  "--bundles",
  "app,dmg",
  "--ci",
]);

const dmgPath = latestFile(dmgDir, ".dmg");
if (!dmgPath) {
  fail(`Expected a DMG in ${dmgDir}, but none was found.`);
}

const updaterPath = latestFile(macosDir, ".app.tar.gz");
if (!updaterPath) {
  fail(`Expected an updater archive in ${macosDir}, but none was found.`);
}

const signaturePath = `${updaterPath}.sig`;
if (!existsSync(signaturePath)) {
  fail(
    `Expected ${signaturePath}. Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH before building.`,
  );
}

const version = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
).version;
const updaterFileName = path.basename(updaterPath);
const manifest = {
  version,
  notes: `picode ${version} stable release.`,
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": {
      signature: readFileSync(signaturePath, "utf8").trim(),
      url: `https://github.com/VOID229/picode/releases/download/v${version}/${updaterFileName}`,
    },
    "darwin-aarch64-app": {
      signature: readFileSync(signaturePath, "utf8").trim(),
      url: `https://github.com/VOID229/picode/releases/download/v${version}/${updaterFileName}`,
    },
    "darwin-x86_64": {
      signature: readFileSync(signaturePath, "utf8").trim(),
      url: `https://github.com/VOID229/picode/releases/download/v${version}/${updaterFileName}`,
    },
    "darwin-x86_64-app": {
      signature: readFileSync(signaturePath, "utf8").trim(),
      url: `https://github.com/VOID229/picode/releases/download/v${version}/${updaterFileName}`,
    },
  },
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

await run([
  "gh",
  "release",
  "create",
  `v${version}`,
  dmgPath,
  updaterPath,
  signaturePath,
  manifestPath,
  "--title",
  `picode ${version}`,
  "--notes",
  `picode ${version} stable release.`,
]);
