-- Vendify pre-v2.31 stock helper capture
-- READ ONLY: returns the exact helper invoked by the captured stock trigger.
-- Run in an authorized Supabase SQL editor and export the single JSON result.

with requested_functions(identity) as (
    values ('public.recalcular_stock_total_producto_v1(uuid)'::text)
),
resolved_functions as (
    select
        requested.identity,
        pg_catalog.to_regprocedure(requested.identity) as oid
    from requested_functions requested
)
select jsonb_build_object(
    'capture_version', 1,
    'schema', 'public',
    'source', 'captured_trigger_function_dependencies',
    'missing_functions', (
        select coalesce(jsonb_agg(identity order by identity), '[]'::jsonb)
        from resolved_functions
        where oid is null
    ),
    'functions', (
        select coalesce(jsonb_agg(
            jsonb_build_object(
                'identity', identity,
                'definition', pg_catalog.pg_get_functiondef(oid)
            ) order by identity
        ), '[]'::jsonb)
        from resolved_functions
        where oid is not null
    )
) as vendify_pre_v231_stock_helper_capture;
