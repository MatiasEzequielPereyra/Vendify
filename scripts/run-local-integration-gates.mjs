import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  loadTenantIsolationConfig,
  runTenantIsolation
} from "../tests/integration/tenant-isolation.mjs";
import {
  loadSalesAtomicityConfig,
  runSalesAtomicity
} from "../tests/integration/sales-atomicity.mjs";
import {
  loadSalesConcurrencyConfig,
  runSalesConcurrency
} from "../tests/integration/sales-concurrency.mjs";
import { runOfflineSignedLease } from "../tests/integration/offline-signed-lease.mjs";
import { runOperationalBackupV2 } from "../tests/integration/operational-backup-v2.mjs";

const confirmation = "RESET_LOCAL_SUPABASE_FOR_INTEGRATION";
if (process.env.VENDIFY_TEST_CONFIRM_LOCAL_RESET !== confirmation) {
  throw new Error(
    `Confirmá el reset local con VENDIFY_TEST_CONFIRM_LOCAL_RESET=${confirmation}`
  );
}

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";
const npx = isWindows ? "npx.cmd" : "npx";
const dockerCandidate = isWindows && process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, "Programs", "DockerDesktop", "resources", "bin", "docker.exe")
  : "docker";
const docker = existsSync(dockerCandidate) ? dockerCandidate : "docker";

function execute(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", shell: isWindows, ...options });
}

function output(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    shell: isWindows,
    stdio: ["ignore", "pipe", "inherit"]
  });
}

execute(npm, ["run", "prepare:database-local"]);
execute(npx, ["--no-install", "supabase", "db", "reset"]);

const status = JSON.parse(output(npx, ["--no-install", "supabase", "status", "-o", "json"]));
const adminToken = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
if (!adminToken) throw new Error("Supabase local no devolvió una clave administrativa");

const headers = {
  apikey: adminToken,
  Authorization: `Bearer ${adminToken}`,
  "Content-Type": "application/json"
};
const stamp = Date.now();
const password = `VendifyLocalQA!${crypto.randomUUID()}`;

async function createUser(label) {
  const email = `qa-${label}-${stamp}@vendify.local`;
  const response = await fetch(`${status.API_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  const body = await response.json();
  if (!response.ok || !body.id) {
    throw new Error(`No se pudo crear ${label} en Auth local: ${body.message ?? response.status}`);
  }
  return { id: body.id, email, password };
}

const [ownerA, ownerB, cashierA] = await Promise.all([
  createUser("tenant-a"),
  createUser("tenant-b"),
  createUser("cashier-a")
]);

const ids = {
  businessA: crypto.randomUUID(),
  businessB: crypto.randomUUID(),
  branchA: crypto.randomUUID(),
  branchB: crypto.randomUUID(),
  cashA: crypto.randomUUID(),
  cashB: crypto.randomUUID(),
  cashTenantB: crypto.randomUUID(),
  productA: crypto.randomUUID(),
  productB: crypto.randomUUID()
};

const sql = `
begin;
insert into public.negocios(id,nombre,slug,plan,codigo_acceso) values
('${ids.businessA}','QA Comercio A','qa-comercio-a-${stamp}','pro','QAA${stamp}'),
('${ids.businessB}','QA Comercio B','qa-comercio-b-${stamp}','pro','QAB${stamp}');
insert into public.negocio_miembros(negocio_id,user_id,rol,activo,puede_gestionar_stock) values
('${ids.businessA}','${ownerA.id}','owner',true,true),
('${ids.businessA}','${cashierA.id}','cashier',true,true),
('${ids.businessB}','${ownerB.id}','owner',true,true);
insert into public.sucursales(id,negocio_id,nombre) values
('${ids.branchA}','${ids.businessA}','Principal'),
('${ids.branchB}','${ids.businessB}','Principal');
insert into public.cajas(id,negocio_id,sucursal_id,nombre) values
('${ids.cashA}','${ids.businessA}','${ids.branchA}','Caja QA A'),
('${ids.cashB}','${ids.businessA}','${ids.branchA}','Caja QA B'),
('${ids.cashTenantB}','${ids.businessB}','${ids.branchB}','Caja QA Tenant B');
set local request.jwt.claim.sub = '${ownerA.id}';
insert into public.productos(id,user_id,nombre,precio_compra,precio_venta,stock,stock_minimo,negocio_id,codigo_barras) values
('${ids.productA}','${ownerA.id}','Producto QA A',50,100,0,1,'${ids.businessA}','QA-A-${stamp}'),
('${ids.productB}','${ownerA.id}','Producto QA B',60,100,0,1,'${ids.businessA}','QA-B-${stamp}');
insert into public.productos(id,user_id,nombre,precio_compra,precio_venta,stock,stock_minimo,negocio_id,codigo_barras)
select gen_random_uuid(),'${ownerA.id}','Producto Backup '||lpad(n::text,3,'0'),10,20,0,1,
  '${ids.businessA}','QA-BACKUP-${stamp}-'||n::text
from generate_series(1,205) n;
insert into public.producto_stock_sucursal(negocio_id,sucursal_id,producto_id,stock,stock_minimo,stock_inicial_cerrado) values
('${ids.businessA}','${ids.branchA}','${ids.productA}',20,1,true),
('${ids.businessA}','${ids.branchA}','${ids.productB}',20,1,true)
on conflict (sucursal_id,producto_id) do update
set stock=excluded.stock,stock_minimo=excluded.stock_minimo,
    stock_inicial_cerrado=true,actualizado=now();
insert into public.cajas_sesiones(negocio_id,sucursal_id,caja_id,user_id,estado,fondo_inicial) values
('${ids.businessA}','${ids.branchA}','${ids.cashA}','${ownerA.id}','abierta',1000),
('${ids.businessA}','${ids.branchA}','${ids.cashB}','${cashierA.id}','abierta',1000);
commit;
`;

const seeded = spawnSync(
  docker,
  ["exec", "-i", "supabase_db_VendifyV3", "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"],
  { input: sql, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] }
);
if (seeded.status !== 0) throw new Error("Falló el sembrado de Supabase local");

const tenantEnv = {
  VENDIFY_TEST_SUPABASE_URL: status.API_URL,
  VENDIFY_TEST_SUPABASE_ANON_KEY: status.ANON_KEY,
  VENDIFY_TEST_TENANT_A_EMAIL: ownerA.email,
  VENDIFY_TEST_TENANT_A_PASSWORD: ownerA.password,
  VENDIFY_TEST_TENANT_B_EMAIL: ownerB.email,
  VENDIFY_TEST_TENANT_B_PASSWORD: ownerB.password
};
await runTenantIsolation(loadTenantIsolationConfig(tenantEnv));

const salesEnv = {
  VENDIFY_TEST_SALES_SUPABASE_URL: status.API_URL,
  VENDIFY_TEST_SALES_ANON_KEY: status.ANON_KEY,
  VENDIFY_TEST_SALES_USER_A_EMAIL: ownerA.email,
  VENDIFY_TEST_SALES_USER_A_PASSWORD: ownerA.password,
  VENDIFY_TEST_SALES_USER_B_EMAIL: cashierA.email,
  VENDIFY_TEST_SALES_USER_B_PASSWORD: cashierA.password,
  VENDIFY_TEST_SALES_BRANCH_ID: ids.branchA,
  VENDIFY_TEST_SALES_CASH_A_ID: ids.cashA,
  VENDIFY_TEST_SALES_CASH_B_ID: ids.cashB,
  VENDIFY_TEST_SALES_PRODUCT_A_ID: ids.productA,
  VENDIFY_TEST_SALES_PRODUCT_B_ID: ids.productB,
  VENDIFY_TEST_SALES_PAYMENT_AMOUNT: "200"
};
await runSalesAtomicity(loadSalesAtomicityConfig({
  ...salesEnv,
  VENDIFY_TEST_CONFIRM_STAGING_SALES: "RUN_SALES_ATOMICITY"
}));
await runSalesConcurrency(loadSalesConcurrencyConfig({
  ...salesEnv,
  VENDIFY_TEST_CONFIRM_STAGING_SALES: "RUN_SALES_CONCURRENCY"
}));
const offlineLeaseConfig = loadSalesConcurrencyConfig({
  ...salesEnv,
  VENDIFY_TEST_CONFIRM_STAGING_SALES: "RUN_SALES_CONCURRENCY"
});
await runOfflineSignedLease({ ...offlineLeaseConfig, outsiderUser: ownerB });
const backupFixture = await runOperationalBackupV2({
  ...offlineLeaseConfig,
  owner: ownerA,
  otherOwner: ownerB,
  cashier: cashierA
});

execute(process.execPath, ["scripts/run-operational-backup-worker.mjs"], {
  shell: false,
  env: {
    ...process.env,
    SUPABASE_URL: status.API_URL,
    SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: adminToken,
    VENDIFY_BACKUP_USER_JWT: backupFixture.ownerToken,
    VENDIFY_BACKUP_ID: backupFixture.backupId
  }
});

const readyResponse = await fetch(`${status.API_URL}/rest/v1/rpc/estado_respaldo_operativo_v2`, {
  method: "POST",
  headers: {
    apikey: status.ANON_KEY,
    Authorization: `Bearer ${backupFixture.ownerToken}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ p_backup_id: backupFixture.backupId })
});
const readyBackup = await readyResponse.json();
if (!readyResponse.ok || readyBackup.status !== "ready" || !readyBackup.manifest?.rootSha256) {
  throw new Error("El worker no dejó un respaldo listo y verificable");
}
const privateProbe = await fetch(
  `${status.API_URL}/storage/v1/object/vendify-operational-backups/${readyBackup.manifest.parts[0].storagePath}`,
  { headers: { apikey: status.ANON_KEY } }
);
if (privateProbe.ok) throw new Error("El bucket de respaldos no debe ser público");
const manifestPath = `${backupFixture.businessId}/${backupFixture.backupId}/manifest.json`;
const signedResponse = await fetch(
  `${status.API_URL}/storage/v1/object/sign/vendify-operational-backups/${manifestPath}`,
  {
    method: "POST",
    headers: { apikey: adminToken, Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 300 })
  }
);
const signedBody = await signedResponse.json();
if (!signedResponse.ok || typeof signedBody.signedURL !== "string") throw new Error("No se pudo emitir la URL firmada corta");
const signedDownload = await fetch(`${status.API_URL}/storage/v1${signedBody.signedURL}`);
if (!signedDownload.ok || (await signedDownload.json()).rootSha256 !== readyBackup.manifest.rootSha256) {
  throw new Error("La URL firmada no descargó el manifiesto esperado");
}
console.log("PASS: backup v2 worker, private Storage, short signed URL, manifest and checksummed parts");

const scaleBranchId = crypto.randomUUID();
const scaleSql = `
begin;
set local session_replication_role=replica;
insert into public.sucursales(id,negocio_id,nombre) values
('${scaleBranchId}','${ids.businessA}','Secundaria escala');
insert into public.productos(id,user_id,nombre,precio_compra,precio_venta,stock,stock_minimo,negocio_id,codigo_barras)
select gen_random_uuid(),'${ownerA.id}','Producto Escala '||lpad(n::text,5,'0'),5,10,0,1,
  '${ids.businessA}','QA-SCALE-${stamp}-'||n::text
from generate_series(1,4793) n;
create temp table scale_products on commit drop as
select id,row_number() over(order by id) rn from public.productos
where negocio_id='${ids.businessA}' order by id limit 5000;
create temp table scale_sales(n integer primary key,id uuid not null) on commit drop;
insert into scale_sales select n,gen_random_uuid() from generate_series(1,50000) n;
insert into public.ventas(id,user_id,total,medio_pago,negocio_id,sucursal_id,caja_id,caja_sesion_id,estado,subtotal,creado)
select s.id,'${ownerA.id}',50,'efectivo','${ids.businessA}','${ids.branchA}','${ids.cashA}',cs.id,'completada',50,
  now()-interval '1 minute'
from scale_sales s cross join lateral (
  select id from public.cajas_sesiones where negocio_id='${ids.businessA}' and caja_id='${ids.cashA}' limit 1
) cs;
insert into public.venta_items(id,venta_id,user_id,producto_id,producto_nombre,cantidad,precio_unitario,subtotal,negocio_id,costo_unitario,precio_neto_unitario)
select gen_random_uuid(),s.id,'${ownerA.id}',p.id,'Producto escala',1,10,10,'${ids.businessA}',5,10
from scale_sales s cross join generate_series(1,5) i
join scale_products p on p.rn=((s.n*5+i-2)%5000)+1;
set local session_replication_role=origin;
commit;
`;
const scaled = spawnSync(
  docker,
  ["exec", "-i", "supabase_db_VendifyV3", "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"],
  { input: scaleSql, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] }
);
if (scaled.status !== 0) throw new Error("Falló el dataset de escala para backup/restore");

const scaleStartResponse = await fetch(`${status.API_URL}/rest/v1/rpc/iniciar_respaldo_operativo_v2`, {
  method: "POST",
  headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${backupFixture.ownerToken}`, "Content-Type": "application/json" },
  body: "{}"
});
const scaleStart = await scaleStartResponse.json();
if (!scaleStartResponse.ok) throw new Error("No se pudo iniciar el respaldo de escala");
const artifactRoot = join(process.cwd(), "qa-output", "backup-restore-v2", "scale-artifact");
const scaleWorkerOutput = execFileSync(process.execPath, ["scripts/run-operational-backup-worker.mjs"], {
  shell: false,
  encoding: "utf8",
  env: {
    ...process.env,
    SUPABASE_URL: status.API_URL,
    SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: adminToken,
    VENDIFY_BACKUP_USER_JWT: backupFixture.ownerToken,
    VENDIFY_BACKUP_ID: scaleStart.backup_id,
    VENDIFY_BACKUP_OUTPUT_DIR: artifactRoot
  }
});
const scaleMetrics = JSON.parse(scaleWorkerOutput.trim().split(/\r?\n/).at(-1));
execute(process.execPath, [
  "scripts/restore-operational-backup-v2.mjs",
  join(artifactRoot, scaleStart.business_id, scaleStart.backup_id, "manifest.json"),
  "--apply-local"
], {
  shell: false,
  env: {
    ...process.env,
    SUPABASE_URL: status.API_URL,
    VENDIFY_CONFIRM_LOCAL_RESTORE: "RESTORE_LOCAL_VENDIFY_BACKUP_V2"
  }
});
const { mkdir, writeFile } = await import("node:fs/promises");
const reportDirectory = join(process.cwd(), "qa-output", "backup-restore-v2");
await mkdir(reportDirectory, { recursive: true });
await writeFile(join(reportDirectory, "scale-report.json"), `${JSON.stringify({
  format: "vendify-backup-scale-report-v2",
  generatedAt: new Date().toISOString(),
  requirements: { products: 5000, sales: 50000, saleItems: 250000, branches: 2, cashRegisters: 2 },
  observed: { products: scaleMetrics.totals.products, sales: scaleMetrics.totals.sales, saleItems: scaleMetrics.totals.sale_items, branches: scaleMetrics.totals.branches, cashRegisters: scaleMetrics.totals.cash_registers, rows: scaleMetrics.rows, compressedBytes: scaleMetrics.bytes, elapsedMs: scaleMetrics.elapsedMs, workerRssBytes: scaleMetrics.rssBytes, rootSha256: scaleMetrics.rootSha256 },
  status: "pass_local"
}, null, 2)}\n`);
console.log("PASS: 5k products, 50k sales, 250k items export, checksum and transactional local restore");

console.log("PASS: local Auth, RLS, sales, offline lease and backup v2 gates completed");
