import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeBusinessListInput, parseBusinessDetail, parseBusinessId, parseBusinessPage } from "../dist-ts/platform/business-read-model.js";

// This runner cannot accept a database URL or container supplied by its caller.
// It creates its own network-isolated, ephemeral PostgreSQL instance instead.
const root = resolve(import.meta.dirname, "..");
const task = "VEN-ADMIN-001B1";
const container = `vendify-admin-read-${randomUUID()}`;
const image = "postgres:17-alpine";
const docker = "docker";
function execute(args, options = {}) {
  try {
    return execFileSync(docker, args, {
      encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, ...options
    });
  } catch (error) {
    const diagnostic = error.stderr?.toString().trim().split("\n").slice(-18).join("\n") ?? error.message;
    throw new Error(`Disposable PostgreSQL command failed (${args[0]}): ${diagnostic}`, { cause: error.code });
  }
}
const sql = (content) => execute([
  "exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"
], { input: content });

const bootstrap = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_admin nologin;
create schema auth;
create schema extensions;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]);
create publication supabase_realtime;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role',true),'');
$$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid(),auth.role() to anon,authenticated,service_role;
`;

let created = false;
try {
  // Refuse implicit pulls and never inspect or reset an existing Supabase stack.
  execute(["image", "inspect", image, "--format", "{{.Id}}"]);
  execute([
    "run", "--detach", "--rm", "--pull=never", "--name", container,
    "--network", "none", "--label", `vendify.task=${task}`,
    "--tmpfs", "/var/lib/postgresql/data:rw", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", image,
    "-c", "wal_level=logical"
  ]);
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = spawnSync(docker, ["exec", container, "pg_isready", "-U", "postgres"], { encoding: "utf8" });
    if (probe.status === 0) { ready = true; break; }
    await new Promise((accept) => setTimeout(accept, 500));
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
  sql(bootstrap);
  sql(readFileSync(resolve(root, "supabase/baseline/vendify_pre_v231_baseline.sql"), "utf8"));
  const migrations = readdirSync(resolve(root, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql") && !name.endsWith(".local.sql")).sort();
  for (const name of migrations) {
    sql(readFileSync(resolve(root, "supabase/migrations", name), "utf8"));
    console.log(`APPLIED_LOCAL: ${name}`);
  }
  console.log(sql(readFileSync(resolve(root, "tests/integration/platform-business-read-model.sql"), "utf8")).trim());
  const responses = execute([
    "exec", "-i", container, "psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"
  ], { input: `begin read only;
    set local role authenticated;
    set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000007';
    select public.listar_negocios_plataforma_v2(p_limit=>1);
    select public.obtener_negocio_plataforma_v1('20000000-0000-4000-8000-000000000003');
    commit;` }).trim().split("\n").map((line) => JSON.parse(line));
  const page = parseBusinessPage(responses[0], normalizeBusinessListInput({ limit: 1 }));
  const missing = parseBusinessDetail(responses[1], parseBusinessId("20000000-0000-4000-8000-000000000003"));
  if (page.items.length !== 1 || page.next_cursor === null || missing?.suscripcion !== null) {
    throw new Error("PostgreSQL/TypeScript read contract mismatch");
  }
  console.log("PASS: actual SQL responses decoded by the strict TypeScript contract");
  console.log("PASS: full Vendify baseline/migration chain and platform business read SQL tests on disposable PostgreSQL 17");
  console.log("Evidence tier: SQL roles/claims with minimal local Auth/Storage primitives; no real Auth, PostgREST, staging or E2E claim.");
} finally {
  if (created) {
    const label = execute(["inspect", container, "--format", '{{index .Config.Labels "vendify.task"}}']).trim();
    if (label !== task) throw new Error("Refusing cleanup: container ownership label differs");
    execute(["stop", "--time", "3", container]);
  }
}
