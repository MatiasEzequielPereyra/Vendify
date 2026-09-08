-- ============================================================
-- Vendify — diagnóstico de solo lectura para registrar_venta_v4
-- ============================================================
-- Ejecutar en Supabase SQL Editor y conservar el resultado.
-- No inserta, actualiza ni elimina datos; tampoco cambia permisos.

select jsonb_build_object(
  'signature', p.oid::regprocedure::text,
  'arguments', pg_get_function_arguments(p.oid),
  'result', pg_get_function_result(p.oid),
  'language', l.lanname,
  'security_definer', p.prosecdef,
  'volatility', case p.provolatile
    when 'i' then 'immutable'
    when 's' then 'stable'
    else 'volatile'
  end,
  'configuration', coalesce(to_jsonb(p.proconfig), '[]'::jsonb),
  'authenticated_can_execute', has_function_privilege('authenticated', p.oid, 'execute'),
  'anon_can_execute', has_function_privilege('anon', p.oid, 'execute'),
  'idempotency_payload_integrity', jsonb_build_object(
    'table_exists', to_regclass('public.venta_idempotencia_v23011') is not null,
    'payload_hash_column_exists', exists (
      select 1
        from pg_attribute a
       where a.attrelid = 'public.venta_idempotencia_v23011'::regclass
         and a.attname = 'payload_hash'
         and a.attnum > 0
         and not a.attisdropped
    ),
    'sha256_constraint_exists', exists (
      select 1
        from pg_constraint c
       where c.conrelid = 'public.venta_idempotencia_v23011'::regclass
         and c.conname = 'venta_idempotencia_v23011_payload_hash_sha256'
    ),
    'function_binds_payload_hash', position(
      'v_payload_hash_existente <> v_payload_hash'
      in pg_get_functiondef(p.oid)
    ) > 0
  ),
  'function_definition', pg_get_functiondef(p.oid)
) as registrar_venta_v4_audit
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'public'
  and p.proname = 'registrar_venta_v4';
