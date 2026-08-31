import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = readFileSync(resolve(root, "app.js"), "utf8");
const rpcs = [...new Set(
  [...app.matchAll(/\.rpc\(\s*["']([^"']+)["']/g)].map((match) => match[1])
)].sort();

const criticalCandidates = new Set([
  "registrar_venta_v4",
  "registrar_venta_v3",
  "obtener_estado_caja_v1",
  "ajustar_stock_inventario_v2",
  "aplicar_conteo_fisico_v2",
  "transferir_stock_v2",
  "recibir_compra_v1",
  "devolver_venta_v1",
  "obtener_contexto_app",
  "obtener_permisos_personalizados_v1"
]);

const contract = {
  generatedFrom: "app.js",
  baselineVersion: "2.31.1",
  rpcCount: rpcs.length,
  critical: rpcs.filter((rpc) => criticalCandidates.has(rpc)),
  rpcs
};

writeFileSync(
  resolve(root, "contracts/rpc-contract.json"),
  `${JSON.stringify(contract, null, 2)}\n`
);

console.log(`Generated RPC contract with ${rpcs.length} RPCs.`);
