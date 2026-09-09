-- ============================================================
-- Vendify — diagnóstico read-only de RLS y aislamiento multiempresa
-- ============================================================
-- Ejecutar con una cuenta administrativa en Supabase SQL Editor.
-- No modifica tablas, políticas, permisos ni datos.

with critical_tables(table_name) as (
  values
    ('negocios'),
    ('negocio_miembros'),
    ('sucursales'),
    ('productos'),
    ('producto_stock_sucursal'),
    ('movimientos'),
    ('ventas'),
    ('venta_items'),
    ('venta_pagos'),
    ('venta_devoluciones'),
    ('venta_devolucion_items'),
    ('cajas'),
    ('cajas_sesiones'),
    ('caja_movimientos'),
    ('proveedores'),
    ('compras'),
    ('compra_items'),
    ('inventario_conteos'),
    ('inventario_conteo_items'),
    ('audit_log')
),
table_audit as (
  select
    ct.table_name,
    c.oid,
    coalesce(c.relrowsecurity, false) as rls_enabled,
    coalesce(c.relforcerowsecurity, false) as rls_forced,
    coalesce((
      select count(*)
      from pg_policy p
      where p.polrelid = c.oid
    ), 0) as policy_count,
    coalesce(has_table_privilege('anon', c.oid, 'select'), false) as anon_select,
    coalesce(has_table_privilege('anon', c.oid, 'insert'), false) as anon_insert,
    coalesce(has_table_privilege('anon', c.oid, 'update'), false) as anon_update,
    coalesce(has_table_privilege('anon', c.oid, 'delete'), false) as anon_delete,
    coalesce(has_table_privilege('authenticated', c.oid, 'select'), false) as authenticated_select,
    coalesce(has_table_privilege('authenticated', c.oid, 'insert'), false) as authenticated_insert,
    coalesce(has_table_privilege('authenticated', c.oid, 'update'), false) as authenticated_update,
    coalesce(has_table_privilege('authenticated', c.oid, 'delete'), false) as authenticated_delete
  from critical_tables ct
  left join pg_class c
    on c.relname = ct.table_name
   and c.relnamespace = 'public'::regnamespace
   and c.relkind in ('r', 'p')
)
select jsonb_build_object(
  'summary', jsonb_build_object(
    'critical_tables_expected', (select count(*) from critical_tables),
    'critical_tables_missing', (select count(*) from table_audit where oid is null),
    'critical_tables_without_rls', (select count(*) from table_audit where oid is not null and not rls_enabled),
    'critical_tables_without_policies', (select count(*) from table_audit where oid is not null and rls_enabled and policy_count = 0),
    'critical_tables_with_anon_direct_access', (
      select count(*) from table_audit
      where oid is not null and (anon_select or anon_insert or anon_update or anon_delete)
    )
  ),
  'tables', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'table', table_name,
        'exists', oid is not null,
        'rls_enabled', rls_enabled,
        'rls_forced', rls_forced,
        'policy_count', policy_count,
        'anon_direct_access', jsonb_build_object(
          'select', anon_select, 'insert', anon_insert, 'update', anon_update, 'delete', anon_delete
        ),
        'authenticated_direct_access', jsonb_build_object(
          'select', authenticated_select, 'insert', authenticated_insert,
          'update', authenticated_update, 'delete', authenticated_delete
        ),
        'policies', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', p.polname,
            'command', p.polcmd,
            'roles', p.polroles::regrole[]::text[],
            'using', pg_get_expr(p.polqual, p.polrelid),
            'with_check', pg_get_expr(p.polwithcheck, p.polrelid)
          ) order by p.polname)
          from pg_policy p
          where p.polrelid = table_audit.oid
        ), '[]'::jsonb)
      ) order by table_name
    ) from table_audit
  ), '[]'::jsonb)
) as tenant_rls_audit;
