import path from "node:path";
import {
  buildSignedMacosRelease,
  bundleRoot,
  commitIfDirty,
  fail,
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
  "Prepare stable release";
const version = packageVersion();
const tag = `v${version}`;
const manifestPath = path.join(bundleRoot, "latest.json");

requireMacosReleaseHost("Stable");
await requireBranch("main");
requireTauriSigningKey();
await requireGhAuth();

if (await succeeds(["gh", "release", "view", tag])) {
  fail(`Release ${tag} already exists. Bump the version before publishing.`);
}

if (
  await succeeds(["git", "rev-parse", "-q", "--verify", `refs/tags/${tag}`])
) {
  fail(`Local tag ${tag} already exists. Bump the version before publishing.`);
}

await commitIfDirty(commitMessage);
await pushCurrentBranch();

const { dmgPath, updaterPath, signaturePath } = await buildSignedMacosRelease();
writeUpdaterManifest(
  manifestPath,
  version,
  `picode ${version} stable release.`,
  tag,
  updaterPath,
  signaturePath,
);

await run(["git", "tag", tag]);
await run(["git", "push", "origin", tag]);
await run([
  "gh",
  "release",
  "create",
  tag,
  dmgPath,
  updaterPath,
  signaturePath,
  manifestPath,
  "--target",
  "main",
  "--title",
  `picode ${version}`,
  "--notes",
  `picode ${version} stable release.`,
  "--latest",
]);

console.log(`Published stable release ${tag}.`);
