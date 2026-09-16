-- ============================================================
-- Vendify — cierre de permisos directos sobre tablas críticas
-- ============================================================
-- RLS ya está activo en las tablas auditadas. Esta migración elimina
-- la herencia de EXECUTE/SELECT desde PUBLIC para que anon no alcance
-- ninguna tabla comercial, aun cuando una policy fuera configurada mal.

begin;

do $$
declare
  v_critical_tables constant text[] := array[
    'negocios', 'negocio_miembros', 'sucursales', 'productos',
    'producto_stock_sucursal', 'movimientos', 'ventas', 'venta_items',
    'venta_pagos', 'venta_devoluciones', 'venta_devolucion_items', 'cajas',
    'cajas_sesiones', 'caja_movimientos', 'proveedores', 'compras',
    'compra_items', 'inventario_conteos', 'inventario_conteo_items', 'audit_log'
  ];
  v_frontend_read_tables constant text[] := array[
    'producto_stock_sucursal', 'ventas', 'venta_items', 'venta_pagos',
    'venta_devoluciones', 'venta_devolucion_items'
  ];
  v_missing text[];
  v_anon_exposed text[];
  v_missing_frontend_read text[];
  v_table text;
begin
  select array_agg(expected.table_name order by expected.table_name)
    into v_missing
    from unnest(v_critical_tables) as expected(table_name)
   where to_regclass(format('public.%I', expected.table_name)) is null;

  if v_missing is not null then
    raise exception 'Faltan tablas críticas: %', array_to_string(v_missing, ', ');
  end if;

  foreach v_table in array v_critical_tables loop
    execute format('revoke all on table public.%I from public, anon', v_table);
    execute format('grant all on table public.%I to service_role', v_table);
  end loop;

  foreach v_table in array v_frontend_read_tables loop
    execute format('grant select on table public.%I to authenticated', v_table);
  end loop;

  select array_agg(expected.table_name order by expected.table_name)
    into v_anon_exposed
    from unnest(v_critical_tables) as expected(table_name)
   where has_table_privilege('anon', format('public.%I', expected.table_name), 'select')
      or has_table_privilege('anon', format('public.%I', expected.table_name), 'insert')
      or has_table_privilege('anon', format('public.%I', expected.table_name), 'update')
      or has_table_privilege('anon', format('public.%I', expected.table_name), 'delete');

  if v_anon_exposed is not null then
    raise exception 'anon conserva acceso directo a: %', array_to_string(v_anon_exposed, ', ');
  end if;

  select array_agg(expected.table_name order by expected.table_name)
    into v_missing_frontend_read
    from unnest(v_frontend_read_tables) as expected(table_name)
   where not has_table_privilege('authenticated', format('public.%I', expected.table_name), 'select');

  if v_missing_frontend_read is not null then
    raise exception 'authenticated perdió lectura requerida por frontend: %', array_to_string(v_missing_frontend_read, ', ');
  end if;
end;
$$;

commit;
