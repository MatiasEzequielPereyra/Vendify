-- Vendify pre-v2.31 baseline validation
-- READ ONLY. Run after the generated baseline in the same disposable project.

with expected_relations(identity) as (
    values
        ('public.negocios'::text),
        ('public.negocio_miembros'::text),
        ('public.sucursales'::text),
        ('public.cajas'::text),
        ('public.cajas_sesiones'::text),
        ('public.categorias'::text),
        ('public.productos'::text),
        ('public.producto_stock_sucursal'::text),
        ('public.movimientos'::text),
        ('public.ventas'::text),
        ('public.venta_items'::text),
        ('public.venta_pagos'::text),
        ('public.proveedores'::text),
        ('public.compras'::text),
        ('public.compra_items'::text),
        ('public.audit_log'::text)
),
expected_functions(identity) as (
    values
        ('public.negocio_actual_id()'::text),
        ('public.es_miembro_negocio(uuid)'::text),
        ('public.tiene_rol_negocio(uuid,text[])'::text),
        ('public.recalcular_stock_total_producto_v1(uuid)'::text),
        ('public.obtener_stock_inteligente_sucursal(uuid)'::text),
        ('public.establecer_stock_inicial_v1(uuid,uuid,integer,integer)'::text),
        ('public.puede_modificar_stock_manual_v1(uuid)'::text),
        ('public.obtener_permisos_personalizados_v1()'::text)
),
missing_relations as (
    select identity from expected_relations where pg_catalog.to_regclass(identity) is null
),
missing_functions as (
    select identity from expected_functions where pg_catalog.to_regprocedure(identity) is null
),
required_columns(relation_name, column_name) as (
    values
        ('productos'::text, 'negocio_id'::text),
        ('productos', 'codigo_barras'),
        ('producto_stock_sucursal', 'stock_inicial_cerrado'),
        ('movimientos', 'sucursal_id'),
        ('movimientos', 'detalle'),
        ('ventas', 'caja_sesion_id'),
        ('ventas', 'descuento_total'),
        ('venta_items', 'costo_unitario'),
        ('venta_items', 'cantidad_devuelta')
),
missing_columns as (
    select relation_name || '.' || column_name as identity
      from required_columns requested
     where not exists (
        select 1
          from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = requested.relation_name
           and c.column_name = requested.column_name
     )
),
required_triggers(relation_name, trigger_name) as (
    values
        ('productos'::text, 'productos_crear_stock_sucursales_v1'::text),
        ('producto_stock_sucursal', 'stock_sucursal_recalcular_total_v1'),
        ('movimientos', 'trg_cerrar_stock_inicial_por_movimiento'),
        ('venta_items', 'trg_cerrar_stock_inicial_por_venta_item')
),
missing_triggers as (
    select relation_name || '.' || trigger_name as identity
      from required_triggers requested
     where not exists (
        select 1
          from pg_catalog.pg_trigger t
          join pg_catalog.pg_class c on c.oid = t.tgrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname = requested.relation_name
           and t.tgname = requested.trigger_name
           and not t.tgisinternal
     )
)
select jsonb_build_object(
    'validation_version', 1,
    'target', 'pre_v231_baseline',
    'ok', not exists (select 1 from missing_relations)
          and not exists (select 1 from missing_functions)
          and not exists (select 1 from missing_columns)
          and not exists (select 1 from missing_triggers),
    'missing_relations', (select coalesce(jsonb_agg(identity order by identity), '[]'::jsonb) from missing_relations),
    'missing_functions', (select coalesce(jsonb_agg(identity order by identity), '[]'::jsonb) from missing_functions),
    'missing_columns', (select coalesce(jsonb_agg(identity order by identity), '[]'::jsonb) from missing_columns),
    'missing_triggers', (select coalesce(jsonb_agg(identity order by identity), '[]'::jsonb) from missing_triggers)
) as vendify_pre_v231_baseline_validation;
