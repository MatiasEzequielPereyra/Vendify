import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const RPC_RUNTIME_SOURCE_PATTERN = "app.js + src/**/*.ts";

function collectTypeScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectTypeScriptFiles(path);
      return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
    })
    .sort();
}

export function findRuntimeRpcNames(rootDirectory) {
  const root = resolve(rootDirectory);
  const sourcePaths = [resolve(root, "app.js"), ...collectTypeScriptFiles(resolve(root, "src"))];
  const names = sourcePaths.flatMap((sourcePath) => {
    const source = readFileSync(sourcePath, "utf8");
    return [...source.matchAll(/\.rpc\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
  });

  return [...new Set(names)].sort();
}

export function listRuntimeRpcSources(rootDirectory) {
  const root = resolve(rootDirectory);
  return [resolve(root, "app.js"), ...collectTypeScriptFiles(resolve(root, "src"))]
    .map((sourcePath) => relative(root, sourcePath).replaceAll("\\", "/"));
}
