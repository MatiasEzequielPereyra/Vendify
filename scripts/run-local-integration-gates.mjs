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

console.log("PASS: local Auth, RLS, atomicity and sales concurrency gates completed");
