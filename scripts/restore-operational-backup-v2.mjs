import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const TABLES = {
  business: "negocios",
  config: "vendify_config_operativa",
  branches: "sucursales",
  cash_registers: "cajas",
  members: "negocio_miembros",
  categories: "categorias",
  products: "productos",
  branch_stock: "producto_stock_sucursal",
  suppliers: "proveedores",
  purchases: "compras",
  purchase_items: "compra_items",
  cash_sessions: "cajas_sesiones",
  sales: "ventas",
  sale_items: "venta_items",
  sale_payments: "venta_pagos",
  sale_returns: "venta_devoluciones",
  cash_movements: "caja_movimientos",
  inventory_movements: "movimientos",
};
const RESTORE_ORDER = Object.keys(TABLES);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalRoot(parts) {
  const value = parts.map(({ section, partNumber, sha256: hash, rowCount }) => ({ section, partNumber, sha256: hash, rowCount }));
  return sha256(Buffer.from(JSON.stringify(value)));
}

export async function verifyArtifact(manifestFile) {
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  if (manifest.format !== "vendify-operational-backup-v2" || manifest.schemaVersion !== 2) throw new Error("Formato de respaldo no soportado");
  const root = path.dirname(manifestFile);
  const rows = Object.fromEntries(RESTORE_ORDER.map((section) => [section, []]));
  for (const part of manifest.parts) {
    const relative = part.storagePath.split(`${manifest.backupId}/`)[1];
    if (!relative) throw new Error(`Ruta fuera del respaldo: ${part.storagePath}`);
    const bytes = await readFile(path.join(root, relative));
    if (sha256(bytes) !== part.sha256) throw new Error(`Checksum inválido: ${part.storagePath}`);
    const decoded = part.storagePath.endsWith(".gz") ? gunzipSync(bytes) : bytes;
    const values = decoded.toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    if (values.length !== part.rowCount) throw new Error(`Conteo inválido: ${part.storagePath}`);
    rows[part.section].push(...values);
  }
  if (canonicalRoot(manifest.parts) !== manifest.rootSha256) throw new Error("Hash raíz inválido");
  for (const section of RESTORE_ORDER) {
    if (rows[section].length !== manifest.totals[section]) throw new Error(`Total inválido: ${section}`);
  }
  return { manifest, rows };
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertBatchSql(table, rows) {
  const encoded = Buffer.from(JSON.stringify(rows)).toString("base64");
  if (table === "venta_items") {
    const columns = "id,venta_id,user_id,producto_id,producto_nombre,cantidad,precio_unitario,subtotal,negocio_id,costo_unitario,precio_neto_unitario,cantidad_devuelta";
    return `insert into public.venta_items(${columns}) select ${columns} from jsonb_populate_recordset(null::public.venta_items,convert_from(decode('${encoded}','base64'),'UTF8')::jsonb);`;
  }
  return `insert into public.${table} select (jsonb_populate_record(null::public.${table},item)).* from jsonb_array_elements(convert_from(decode('${encoded}','base64'),'UTF8')::jsonb) item;`;
}

async function main() {
  const manifestFile = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (!manifestFile) throw new Error("Uso: node scripts/restore-operational-backup-v2.mjs <manifest.json> [--apply-local]");
  const { manifest, rows } = await verifyArtifact(manifestFile);
  const apply = process.argv.includes("--apply-local");
  if (!apply) {
    process.stdout.write(`${JSON.stringify({ ok: true, verified: true, rootSha256: manifest.rootSha256, totals: manifest.totals }, null, 2)}\n`);
    return;
  }
  if (process.env.VENDIFY_CONFIRM_LOCAL_RESTORE !== "RESTORE_LOCAL_VENDIFY_BACKUP_V2") throw new Error("Falta la confirmación VENDIFY_CONFIRM_LOCAL_RESTORE=RESTORE_LOCAL_VENDIFY_BACKUP_V2");
  const targetUrl = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(targetUrl)) throw new Error("La restauración v2 solo acepta Supabase local");
  const ownerId = rows.members.find((row) => row.rol === "owner")?.user_id;
  if (!ownerId) throw new Error("El artefacto no contiene un owner restaurable");
  for (const row of [...rows.categories, ...rows.products]) if (!row.user_id) row.user_id = ownerId;
  for (const row of rows.sale_items) delete row.ganancia;
  if (rows.business[0] && !rows.business[0].codigo_acceso) rows.business[0].codigo_acceso = `RESTORE-${manifest.backupId.slice(0, 12)}`;

  const statements = [
    "begin;",
    `delete from public.offline_sale_lease_usage where negocio_id=${sqlLiteral(manifest.businessId)}::uuid;`,
    `delete from public.offline_sale_leases where negocio_id=${sqlLiteral(manifest.businessId)}::uuid;`,
    `delete from public.negocios where id=${sqlLiteral(manifest.businessId)}::uuid;`,
    "set local session_replication_role=replica;",
  ];
  for (const section of RESTORE_ORDER) {
    for (let offset = 0; offset < rows[section].length; offset += 1_000) {
      statements.push(insertBatchSql(TABLES[section], rows[section].slice(offset, offset + 1_000)));
    }
  }
  statements.push(
    "set local session_replication_role=origin;",
    `do $$ begin if exists(select 1 from public.productos p where p.negocio_id=${sqlLiteral(manifest.businessId)}::uuid and not exists(select 1 from public.negocios n where n.id=p.negocio_id)) then raise exception 'FK lógica inválida en productos'; end if; end $$;`,
    `do $$ begin if exists(select 1 from public.venta_items i where i.negocio_id=${sqlLiteral(manifest.businessId)}::uuid and not exists(select 1 from public.ventas v where v.id=i.venta_id)) then raise exception 'FK lógica inválida en venta_items'; end if; end $$;`,
  );
  for (const section of RESTORE_ORDER) {
    const where = section === "business" ? `id=${sqlLiteral(manifest.businessId)}::uuid` : `negocio_id=${sqlLiteral(manifest.businessId)}::uuid`;
    statements.push(`do $$ begin if (select count(*) from public.${TABLES[section]} where ${where})<>${rows[section].length} then raise exception 'Conteo restaurado inválido: ${section}'; end if; end $$;`);
  }
  statements.push("commit;");
  const docker = process.platform === "win32" && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Programs", "DockerDesktop", "resources", "bin", "docker.exe")
    : "docker";
  const result = spawnSync(docker, ["exec", "-i", "supabase_db_VendifyV3", "psql", "-q", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"], {
    input: statements.join("\n"), encoding: "utf8", stdio: ["pipe", "inherit", "inherit"], maxBuffer: 1024 * 1024 * 512,
  });
  if (result.status !== 0) throw new Error("La restauración transaccional falló");
  const report = { format: "vendify-restore-report-v2", restoredAt: new Date().toISOString(), backupId: manifest.backupId, businessId: manifest.businessId, rootSha256: manifest.rootSha256, totals: manifest.totals, status: "pass_local" };
  const reportDir = path.resolve("qa-output", "backup-restore-v2");
  await mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${manifest.backupId}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, reportPath, rootSha256: manifest.rootSha256 })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(.:)/, "$1"))) {
  await main();
}
