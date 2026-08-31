import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = readFileSync(resolve(root, "app.js"), "utf8");
const contract = JSON.parse(
  readFileSync(resolve(root, "contracts/rpc-contract.json"), "utf8")
);

const found = [...new Set(
  [...app.matchAll(/\.rpc\(\s*["']([^"']+)["']/g)].map((match) => match[1])
)].sort();
const expected = [...contract.rpcs].sort();

const missing = expected.filter((rpc) => !found.includes(rpc));
const added = found.filter((rpc) => !expected.includes(rpc));

if (missing.length || added.length) {
  console.error("RPC contract drift detected.");
  if (missing.length) console.error("Removed from app.js:", missing.join(", "));
  if (added.length) console.error("New in app.js:", added.join(", "));
  console.error("Update contracts/rpc-contract.json intentionally after backend/preflight review.");
  process.exit(1);
}

const requiredCritical = [
  "registrar_venta_v4",
  "obtener_estado_caja_v1",
  "transferir_stock_v2"
];
for (const rpc of requiredCritical) {
  if (!found.includes(rpc)) {
    console.error(`Critical RPC missing from frontend: ${rpc}`);
    process.exit(1);
  }
}

console.log(`PASS: RPC contract stable (${found.length} RPCs)`);
