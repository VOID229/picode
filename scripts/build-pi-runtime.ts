import { $ } from "bun";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const runtimeDir = path.join(root, "pi-runtime");
const binDir = path.join(root, "src-tauri", "bin");
const runtimePackageJson = path.join(runtimeDir, "package.json");

function targetTriple() {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "aarch64-apple-darwin";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "x86_64-apple-darwin";
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "aarch64-unknown-linux-gnu";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "x86_64-unknown-linux-gnu";
  }
  if (process.platform === "win32" && process.arch === "arm64") {
    return "aarch64-pc-windows-msvc";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "x86_64-pc-windows-msvc";
  }
  throw new Error(
    `Unsupported build host for pi-runtime: ${process.platform}/${process.arch}`,
  );
}

await $`bun run build`.cwd(runtimeDir);

const executable =
  process.platform === "win32" ? "pi-runtime.exe" : "pi-runtime";
const compiledPath = path.join(binDir, executable);
if (!existsSync(compiledPath)) {
  throw new Error(`Compiled pi-runtime not found at ${compiledPath}`);
}

const suffixedName =
  process.platform === "win32"
    ? `pi-runtime-${targetTriple()}.exe`
    : `pi-runtime-${targetTriple()}`;
copyFileSync(compiledPath, path.join(binDir, suffixedName));
copyFileSync(runtimePackageJson, path.join(binDir, "package.json"));
