import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const bundleRoot = path.join(root, "src-tauri", "target", "release", "bundle");
const dmgDir = path.join(bundleRoot, "dmg");

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

async function succeeds(cmd: string[]) {
  const child = Bun.spawn({
    cmd,
    cwd: root,
    stdout: "ignore",
    stderr: "ignore",
  });

  return (await child.exited) === 0;
}

if (process.platform !== "darwin") {
  fail("Nightly DMG releases must be created on macOS.");
}

await run(["bun", "run", "dmg"]);

const dmgPath = latestFile(dmgDir, ".dmg");
if (!dmgPath) {
  fail(`Expected a DMG in ${dmgDir}, but none was found.`);
}

await run(["git", "tag", "-f", "nightly"]);
await run(["git", "push", "origin", "nightly", "--force"]);
if (await succeeds(["gh", "release", "view", "nightly"])) {
  await run(["gh", "release", "delete", "nightly", "--yes", "--cleanup-tag"]);
}
await run(["git", "tag", "-f", "nightly"]);
await run(["git", "push", "origin", "nightly", "--force"]);
await run([
  "gh",
  "release",
  "create",
  "nightly",
  dmgPath,
  "--title",
  "picode nightly",
  "--notes",
  "Automated nightly DMG build.",
  "--prerelease",
  "--latest=false",
]);
