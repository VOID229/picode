import path from "node:path";
import {
  buildSignedMacosRelease,
  bundleRoot,
  commitIfDirty,
  packageVersion,
  pushCurrentBranch,
  requireBranch,
  requireGhAuth,
  requireMacosReleaseHost,
  requireTauriSigningKey,
  run,
  succeeds,
  writeUpdaterManifest,
} from "./release-utils";

const commitMessage =
  Bun.argv.find((arg) => arg.startsWith("--message="))?.slice(10) ??
  "Prepare nightly build";
const baseVersion = packageVersion();
const buildId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const nightlyVersion = `${baseVersion}+nightly.${buildId}`;
const manifestPath = path.join(bundleRoot, "nightly.json");

requireMacosReleaseHost("Nightly");
await requireBranch("nightly");
requireTauriSigningKey();
await requireGhAuth();

await commitIfDirty(commitMessage);
await pushCurrentBranch();

const { dmgPath, updaterPath, signaturePath } = await buildSignedMacosRelease();
writeUpdaterManifest(
  manifestPath,
  nightlyVersion,
  "Automated nightly build.",
  "nightly",
  updaterPath,
  signaturePath,
);

await run(["git", "tag", "-f", "nightly"]);
await run(["git", "push", "origin", "nightly", "--force"]);

if (await succeeds(["gh", "release", "view", "nightly"])) {
  await run(["gh", "release", "delete", "nightly", "--yes", "--cleanup-tag"]);
  await run(["git", "tag", "-f", "nightly"]);
  await run(["git", "push", "origin", "nightly", "--force"]);
}

await run([
  "gh",
  "release",
  "create",
  "nightly",
  dmgPath,
  updaterPath,
  signaturePath,
  manifestPath,
  "--target",
  "nightly",
  "--title",
  "picode nightly",
  "--notes",
  "Automated nightly build.",
  "--prerelease",
  "--latest=false",
]);

console.log("Published nightly pre-release.");
