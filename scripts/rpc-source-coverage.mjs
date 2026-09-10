import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const root = resolve(import.meta.dirname, "..");
const contract = JSON.parse(
  readFileSync(resolve(root, "contracts/rpc-contract.json"), "utf8")
);

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walk(path));
    else if (name.endsWith(".sql")) files.push(path);
  }
  return files;
}

const sqlFiles = walk(resolve(root, "supabase"));
const definitions = new Map();
const regex = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-zA-Z0-9_]+)/gi;

for (const file of sqlFiles) {
  const sql = readFileSync(file, "utf8");
  for (const match of sql.matchAll(regex)) {
    const name = match[1];
    if (!definitions.has(name)) definitions.set(name, []);
    definitions.get(name).push(relative(root, file));
  }
}

const rows = contract.rpcs.map((rpc) => ({
  rpc,
  sourceFound: definitions.has(rpc),
  files: definitions.get(rpc) ?? []
}));
const missing = rows.filter((row) => !row.sourceFound).map((row) => row.rpc);

const output = {
  baselineVersion: contract.baselineVersion,
  rpcCount: contract.rpcCount,
  definitionsFound: rows.length - missing.length,
  missingCount: missing.length,
  missing,
  rows
};

writeFileSync(
  resolve(root, "contracts/rpc-source-coverage.json"),
  `${JSON.stringify(output, null, 2)}\n`
);

console.log(
  `RPC SQL source coverage: ${output.definitionsFound}/${output.rpcCount}; missing ${output.missingCount}`
);
if (missing.length) {
  console.log(`Missing historical source definitions: ${missing.join(", ")}`);
  process.exitCode = 1;
}
