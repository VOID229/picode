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
  withReleaseVersion,
  writeUpdaterManifest,
} from "./release-utils";

const commitMessage =
  Bun.argv.find((arg) => arg.startsWith("--message="))?.slice(10) ??
  "Prepare nightly build";
const baseVersion = packageVersion().split(/[+-]/, 1)[0];
const buildId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const nightlyVersion = `${baseVersion}-nightly.${buildId}`;
const releaseTag = `nightly-${buildId}`;
const manifestPath = path.join(bundleRoot, "nightly.json");
const notes = `Automated nightly build ${buildId}.`;

requireMacosReleaseHost("Nightly");
await requireBranch("nightly");
requireTauriSigningKey();
await requireGhAuth();

await commitIfDirty(commitMessage);
await pushCurrentBranch();

const { dmgPath, updaterPath, signaturePath } = await withReleaseVersion(
  nightlyVersion,
  () => buildSignedMacosRelease(),
);
writeUpdaterManifest(
  manifestPath,
  nightlyVersion,
  notes,
  releaseTag,
  updaterPath,
  signaturePath,
);

await run(["git", "tag", releaseTag]);
await run(["git", "push", "origin", `refs/tags/${releaseTag}`]);

await run([
  "gh",
  "release",
  "create",
  releaseTag,
  dmgPath,
  updaterPath,
  signaturePath,
  manifestPath,
  "--target",
  "nightly",
  "--title",
  `picode nightly ${buildId}`,
  "--notes",
  notes,
  "--prerelease",
  "--latest=false",
]);

writeUpdaterManifest(
  manifestPath,
  nightlyVersion,
  notes,
  "nightly",
  updaterPath,
  signaturePath,
);

await run(["git", "tag", "-f", "nightly"]);
await run(["git", "push", "origin", "refs/tags/nightly", "--force"]);

if (await succeeds(["gh", "release", "view", "nightly"])) {
  await run(["gh", "release", "delete", "nightly", "--yes", "--cleanup-tag"]);
  await run(["git", "tag", "-f", "nightly"]);
  await run(["git", "push", "origin", "refs/tags/nightly", "--force"]);
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
  `${notes}\n\nMoving release used by the app updater. Historical release: ${releaseTag}.`,
  "--prerelease",
  "--latest=false",
]);

console.log(`Published nightly pre-release ${releaseTag}.`);
console.log("Updated moving nightly release for updater compatibility.");
