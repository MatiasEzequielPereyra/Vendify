import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Dedicated, networkless disposable database. Never connects to Supabase remotely
// or resets the developer's running Supabase project.
const root = resolve(import.meta.dirname, "../..");
const image = "postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24";
const container = `ven008-p1-inventory-${randomUUID().slice(0, 8)}`;
let created = false;
const migrationPath = "supabase/migrations/20261014170534_inventory_history_role_guard.sql";
const read = (path) => readFileSync(resolve(root, path), "utf8");
function definition(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `Missing definition ${name}`);
  const end = sql.indexOf("$$;", start);
  assert.ok(end > start, `Unterminated definition ${name}`);
  return sql.slice(start, end + 3);
}
function sql(text) {
  return spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres",
    "-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", "-"], {
    input: text, encoding: "utf8", maxBuffer: 2 * 1024 * 1024
  });
}
function mustRun(text) {
  const result = sql(text);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}
const helpers = read("supabase/legacy/001_multiempresa_roles_sucursales_FIX.sql");
const original = definition(read("supabase/legacy/modules/inventario_profesional.sql"),
  "listar_movimientos_inventario_v1");
const fixture = `
create role authenticated nologin;
create role anon nologin;
create schema auth;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
grant usage on schema auth to authenticated,anon;
create table public.negocio_miembros(
 negocio_id uuid,user_id uuid,rol text,activo boolean,creado timestamptz default now(),
 puede_gestionar_stock boolean default false);
create table public.empleados(user_id uuid,negocio_id uuid,nombre text);
create table public.movimientos(
 id uuid default gen_random_uuid(),producto_id uuid,producto_nombre text,tipo text,
 delta integer,stock_resultante integer,motivo text,detalle jsonb,user_id uuid,
 creado timestamptz,negocio_id uuid,sucursal_id uuid);
insert into auth.users
 select ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 'synthetic-'||n||'@example.invalid' from generate_series(1,7) n;
insert into public.negocio_miembros(negocio_id,user_id,rol,activo,puede_gestionar_stock)
 select '30000000-0000-0000-0000-000000000001',
 ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 (array['owner','admin','manager','cashier'])[n],true,n=4 from generate_series(1,4)n;
insert into public.negocio_miembros(negocio_id,user_id,rol,activo) values
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005','owner',true),
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','owner',false);
insert into public.empleados values
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Synthetic Owner');
insert into public.movimientos(producto_id,producto_nombre,tipo,delta,stock_resultante,
 detalle,user_id,creado,negocio_id,sucursal_id)
 select gen_random_uuid(),'Synthetic product','compra',1,n,
 '{"costo_anterior":17,"costo_unitario":23}',
 '10000000-0000-0000-0000-000000000001',
 '2026-01-01'::timestamptz+n*interval '1 second',
 '30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'
 from generate_series(1,600)n;
insert into public.movimientos(id,negocio_id,sucursal_id,user_id,creado,detalle)
 values
 (gen_random_uuid(),'30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',
 '10000000-0000-0000-0000-000000000001',now(),'{}'),
 (gen_random_uuid(),'30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003',
 '10000000-0000-0000-0000-000000000005',now(),'{}');
`;
try {
  execFileSync("docker", ["run", "--rm", "--detach", "--network", "none",
    "--name", container, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", image],
  { stdio: "pipe" });
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const check = spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres"]);
    if (check.status === 0) { ready = true; break; }
    await new Promise((done) => setTimeout(done, 500));
  }
  assert.ok(ready, "Dedicated PostgreSQL did not become ready");
  mustRun(fixture);
  mustRun(["es_miembro_negocio", "tiene_rol_negocio", "negocio_actual_id"]
    .map((name) => definition(helpers, name)).join("\n"));
  mustRun(`
    alter table public.movimientos enable row level security;
    grant select on public.movimientos to authenticated;
    create policy security_movimientos_select on public.movimientos
      for select to authenticated using (
        public.tiene_rol_negocio(negocio_id,array['owner','admin','manager']));
  `);
  mustRun(original);
  const suite = read("tests/integration/sql/inventory-history-role-guard.sql");
  const red = sql(suite);
  assert.notEqual(red.status, 0, "Regression oracle did not reject vulnerable RPC");
  assert.match(red.stderr, /Expected denial: Rol sin permiso/);
  console.log("RED_CONFIRMED: existing RPC fails cashier denial");
  mustRun("drop schema fixture_test cascade;");
  mustRun(read(migrationPath));
  console.log(mustRun(suite).trim());
  // Apply the same forward migration a second time to verify replacement safety.
  mustRun("drop schema fixture_test cascade;");
  mustRun(read(migrationPath));
  console.log(mustRun(suite).trim());
  console.log("LOCAL_POSTGRES_REAPPLY_PASS; Supabase Auth/staging sessions NOT_RUN");
} finally {
  // The exact random name is owned solely by this run; no filesystem/other project deletion.
  if (created) spawnSync("docker", ["rm", "--force", container], { stdio: "pipe" });
}
