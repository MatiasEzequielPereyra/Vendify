-- ============================================================
-- Vendify — diagnóstico de funciones SECURITY DEFINER
-- ============================================================
-- Solo lectura. Ejecutar en Supabase SQL Editor y conservar el resultado.
-- Identifica exposición de API y funciones que no fijan search_path.

with funciones as (
  select
    p.oid,
    n.nspname as schema_name,
    p.proname as function_name,
    p.oid::regprocedure::text as signature,
    pg_get_userbyid(p.proowner) as owner_name,
    coalesce(array_to_string(p.proconfig, ','), '') as configuration,
    has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
    has_function_privilege('service_role', p.oid, 'execute') as service_role_can_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
)
select jsonb_build_object(
  'total_security_definer', count(*),
  'anon_exposed', count(*) filter (where anon_can_execute),
  'without_fixed_search_path', count(*) filter (
    where configuration !~ '(^|,)search_path='
  ),
  'functions', coalesce(
    jsonb_agg(
      jsonb_build_object(
        'signature', signature,
        'owner', owner_name,
        'configuration', configuration,
        'anon_can_execute', anon_can_execute,
        'authenticated_can_execute', authenticated_can_execute,
        'service_role_can_execute', service_role_can_execute,
        'search_path_fixed', configuration ~ '(^|,)search_path='
      )
      order by signature
    ),
    '[]'::jsonb
  )
) as security_definer_audit
from funciones;
