import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const root = path.resolve(import.meta.dir, "..");
export const bundleRoot = path.join(
  root,
  "src-tauri",
  "target",
  "release",
  "bundle",
);
export const dmgDir = path.join(bundleRoot, "dmg");
export const macosDir = path.join(bundleRoot, "macos");

export function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

export async function run(cmd: string[], options: { quiet?: boolean } = {}) {
  const child = Bun.spawn({
    cmd,
    cwd: root,
    env: process.env,
    stdout: options.quiet ? "pipe" : "inherit",
    stderr: options.quiet ? "pipe" : "inherit",
  });

  const exitCode = await child.exited;
  if (exitCode !== 0) {
    fail(`Command failed: ${cmd.join(" ")}`);
  }
}

export async function output(cmd: string[]) {
  const child = Bun.spawn({
    cmd,
    cwd: root,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    fail(`${cmd.join(" ")} failed:\n${stderr || stdout}`);
  }

  return stdout.trim();
}

export async function succeeds(cmd: string[]) {
  const child = Bun.spawn({
    cmd,
    cwd: root,
    env: process.env,
    stdout: "ignore",
    stderr: "ignore",
  });

  return (await child.exited) === 0;
}

export function latestFile(directory: string, extension: string) {
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

export function packageVersion() {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
    .version as string;
}

function writeJsonFile(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function withReleaseVersion<T>(
  version: string,
  callback: () => Promise<T>,
) {
  const packageJsonPath = path.join(root, "package.json");
  const tauriConfigPath = path.join(root, "src-tauri", "tauri.conf.json");
  const cargoTomlPath = path.join(root, "src-tauri", "Cargo.toml");
  const cargoLockPath = path.join(root, "src-tauri", "Cargo.lock");
  const originalPackageJson = readFileSync(packageJsonPath, "utf8");
  const originalTauriConfig = readFileSync(tauriConfigPath, "utf8");
  const originalCargoToml = readFileSync(cargoTomlPath, "utf8");
  const originalCargoLock = readFileSync(cargoLockPath, "utf8");

  try {
    const packageJson = JSON.parse(originalPackageJson);
    packageJson.version = version;
    writeJsonFile(packageJsonPath, packageJson);

    const tauriConfig = JSON.parse(originalTauriConfig);
    tauriConfig.version = version;
    writeJsonFile(tauriConfigPath, tauriConfig);

    writeFileSync(
      cargoTomlPath,
      originalCargoToml.replace(/^version = ".*"$/m, `version = "${version}"`),
    );

    return await callback();
  } finally {
    writeFileSync(packageJsonPath, originalPackageJson);
    writeFileSync(tauriConfigPath, originalTauriConfig);
    writeFileSync(cargoTomlPath, originalCargoToml);
    writeFileSync(cargoLockPath, originalCargoLock);
  }
}

export function requireMacosReleaseHost(channel: string) {
  if (process.platform !== "darwin") {
    fail(`${channel} DMG releases must be created on macOS.`);
  }
}

export function requireTauriSigningKey() {
  const defaultKeyPath = path.join(homedir(), ".tauri", "picode-updater.key");
  if (
    !process.env.TAURI_SIGNING_PRIVATE_KEY &&
    !process.env.TAURI_SIGNING_PRIVATE_KEY_PATH &&
    existsSync(defaultKeyPath)
  ) {
    process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(
      defaultKeyPath,
      "utf8",
    );
  }

  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";

  if (
    !process.env.TAURI_SIGNING_PRIVATE_KEY &&
    !process.env.TAURI_SIGNING_PRIVATE_KEY_PATH
  ) {
    fail(
      [
        "Tauri updater signing is not configured.",
        "Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH before publishing a release.",
        "This is separate from Apple Developer ID signing; it signs Tauri updater archives and manifests.",
      ].join("\n"),
    );
  }
}

export async function requireGhAuth() {
  await run(["gh", "auth", "status"], { quiet: true });
}

export async function currentBranch() {
  return output(["git", "branch", "--show-current"]);
}

export async function requireBranch(branch: string) {
  const actual = await currentBranch();
  if (actual !== branch) {
    fail(
      `Expected to be on branch ${branch}, but current branch is ${actual}.`,
    );
  }
}

export async function commitIfDirty(message: string) {
  const status = await output(["git", "status", "--porcelain"]);
  if (!status) {
    console.log("No local changes to commit.");
    return;
  }

  await run(["git", "add", "-A"]);
  await run(["git", "commit", "-m", message]);
}

export async function pushCurrentBranch() {
  const branch = await currentBranch();
  await run(["git", "push", "-u", "origin", `HEAD:refs/heads/${branch}`]);
}

export async function buildSignedMacosRelease() {
  console.log("Building macOS app bundle, DMG, and updater artifacts...");
  await run(["bunx", "tauri", "build", "--bundles", "app,dmg", "--ci"]);

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
    fail(`Expected Tauri updater signature at ${signaturePath}.`);
  }

  return { dmgPath, updaterPath, signaturePath };
}

export function writeUpdaterManifest(
  manifestPath: string,
  version: string,
  notes: string,
  releaseTag: string,
  updaterPath: string,
  signaturePath: string,
) {
  const updaterFileName = path.basename(updaterPath);
  const signature = readFileSync(signaturePath, "utf8").trim();
  const platform = {
    signature,
    url: `https://github.com/VOID229/picode/releases/download/${releaseTag}/${updaterFileName}`,
  };
  const manifest = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      "darwin-aarch64": platform,
      "darwin-aarch64-app": platform,
      "darwin-x86_64": platform,
      "darwin-x86_64-app": platform,
    },
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
