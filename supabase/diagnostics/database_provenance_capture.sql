-- VEN-003 database provenance capture
-- READ-ONLY metadata only. Do not add application-table row reads or mutating statements.
-- Project identity is supplied outside SQL; this file is intentionally credential-free.

select
  current_setting('server_version') as server_version,
  to_regclass('supabase_migrations.schema_migrations')::text as migration_ledger_relation;

select nspname as schema_name
from pg_namespace
where nspname not like 'pg_%'
  and nspname <> 'information_schema'
order by 1;

select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p')
  and n.nspname = 'public'
order by c.relname;

select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

select
  rel.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_get_constraintdef(con.oid, true) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public'
order by rel.relname, con.conname;

select
  tablename as table_name,
  indexname as index_name,
  indexdef as definition
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

select
  p.oid::regprocedure::text as signature,
  p.proname as name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as return_type,
  p.prosecdef as security_definer,
  case p.provolatile when 'i' then 'IMMUTABLE' when 's' then 'STABLE' else 'VOLATILE' end as volatility,
  p.proconfig as config,
  pg_get_userbyid(p.proowner) as owner,
  p.proacl::text as acl,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
  md5(pg_get_functiondef(p.oid)) as definition_md5
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname, identity_arguments;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

select grantee, table_name, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon','authenticated','service_role')
order by table_name, grantee, privilege_type;

select
  event_object_table as table_name,
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
from information_schema.triggers
where trigger_schema = 'public'
order by event_object_table, trigger_name, event_manipulation;

select
  e.extname as extension_name,
  n.nspname as schema_name,
  e.extversion as installed_version
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
order by e.extname;
