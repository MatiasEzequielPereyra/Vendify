-- ============================================================
-- Vendify — diagnóstico de solo lectura para registrar_venta_v3
-- ============================================================
-- Es la capa que ejecuta la venta, pagos, stock y caja para v4.
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
  'function_definition', pg_get_functiondef(p.oid)
) as registrar_venta_v3_audit
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'public'
  and p.oid = to_regprocedure(
    'public.registrar_venta_v3(jsonb,jsonb,text,numeric,text,uuid,uuid)'
  );
