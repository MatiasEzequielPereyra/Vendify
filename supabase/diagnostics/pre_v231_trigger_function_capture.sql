-- Vendify pre-v2.31 trigger-function capture
-- READ ONLY: returns the exact PostgreSQL functions invoked by non-internal
-- triggers on the six captured core relations. Run in an authorized Supabase
-- SQL editor and export the single JSON result.

with target_relations(name) as (
    values
        ('categorias'::text),
        ('productos'::text),
        ('producto_stock_sucursal'::text),
        ('movimientos'::text),
        ('ventas'::text),
        ('venta_items'::text)
),
trigger_functions as (
    select distinct
        p.oid,
        n.nspname as schema_name,
        p.proname as function_name,
        pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
        pg_catalog.pg_get_functiondef(p.oid) as definition
    from target_relations wanted
    join pg_catalog.pg_class c
      on c.relname = wanted.name
    join pg_catalog.pg_namespace table_namespace
      on table_namespace.oid = c.relnamespace
     and table_namespace.nspname = 'public'
    join pg_catalog.pg_trigger t
      on t.tgrelid = c.oid
     and not t.tgisinternal
    join pg_catalog.pg_proc p
      on p.oid = t.tgfoid
    join pg_catalog.pg_namespace n
      on n.oid = p.pronamespace
)
select jsonb_build_object(
    'capture_version', 1,
    'schema', 'public',
    'source', 'core_relation_triggers',
    'functions', coalesce((
        select jsonb_agg(
            jsonb_build_object(
                'schema', schema_name,
                'name', function_name,
                'identity_arguments', identity_arguments,
                'definition', definition
            ) order by schema_name, function_name, identity_arguments
        )
        from trigger_functions
    ), '[]'::jsonb)
) as vendify_pre_v231_trigger_function_capture;
