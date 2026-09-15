-- Vendify pre-v2.31 baseline capture
-- READ ONLY: returns structural metadata for the six core relations whose
-- authoritative CREATE TABLE statements are absent from repository history.
-- Run in an authorized Supabase SQL editor and export the single JSON result.

with target_relations(name) as (
    values
        ('categorias'::text),
        ('productos'::text),
        ('producto_stock_sucursal'::text),
        ('movimientos'::text),
        ('ventas'::text),
        ('venta_items'::text)
),
relations as (
    select
        c.oid,
        c.relname as name,
        c.relrowsecurity as rls_enabled,
        c.relforcerowsecurity as rls_forced,
        obj_description(c.oid, 'pg_class') as comment
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join target_relations t on t.name = c.relname
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
),
columns_json as (
    select
        r.name,
        jsonb_agg(
            jsonb_build_object(
                'ordinal', a.attnum,
                'name', a.attname,
                'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
                'not_null', a.attnotnull,
                'identity', a.attidentity,
                'generated', a.attgenerated,
                'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid),
                'comment', col_description(r.oid, a.attnum)
            ) order by a.attnum
        ) as value
    from relations r
    join pg_catalog.pg_attribute a on a.attrelid = r.oid
    left join pg_catalog.pg_attrdef d on d.adrelid = r.oid and d.adnum = a.attnum
    where a.attnum > 0 and not a.attisdropped
    group by r.name
),
constraints_json as (
    select
        r.name,
        jsonb_agg(
            jsonb_build_object(
                'name', c.conname,
                'type', c.contype,
                'definition', pg_catalog.pg_get_constraintdef(c.oid, true)
            ) order by c.conname
        ) as value
    from relations r
    join pg_catalog.pg_constraint c on c.conrelid = r.oid
    group by r.name
),
indexes_json as (
    select
        r.name,
        jsonb_agg(
            jsonb_build_object('name', i.indexname, 'definition', i.indexdef)
            order by i.indexname
        ) as value
    from relations r
    join pg_catalog.pg_indexes i on i.schemaname = 'public' and i.tablename = r.name
    group by r.name
),
triggers_json as (
    select
        r.name,
        jsonb_agg(
            jsonb_build_object(
                'name', t.tgname,
                'definition', pg_catalog.pg_get_triggerdef(t.oid, true)
            ) order by t.tgname
        ) as value
    from relations r
    join pg_catalog.pg_trigger t on t.tgrelid = r.oid and not t.tgisinternal
    group by r.name
),
policies_json as (
    select
        r.name,
        jsonb_agg(
            jsonb_build_object(
                'name', p.policyname,
                'permissive', p.permissive,
                'roles', p.roles,
                'command', p.cmd,
                'using', p.qual,
                'check', p.with_check
            ) order by p.policyname
        ) as value
    from relations r
    join pg_catalog.pg_policies p on p.schemaname = 'public' and p.tablename = r.name
    group by r.name
),
grants_json as (
    select
        r.name,
        jsonb_agg(
            distinct jsonb_build_object(
                'grantee', g.grantee,
                'privilege', g.privilege_type,
                'grantable', g.is_grantable
            )
        ) as value
    from relations r
    join information_schema.role_table_grants g on g.table_schema = 'public' and g.table_name = r.name
    group by r.name
)
select jsonb_build_object(
    'capture_version', 1,
    'schema', 'public',
    'expected_relations', (select jsonb_agg(name order by name) from target_relations),
    'missing_relations', (
        select coalesce(jsonb_agg(t.name order by t.name), '[]'::jsonb)
        from target_relations t
        left join relations r on r.name = t.name
        where r.name is null
    ),
    'relations', coalesce((
        select jsonb_agg(
            jsonb_build_object(
                'name', r.name,
                'rls_enabled', r.rls_enabled,
                'rls_forced', r.rls_forced,
                'comment', r.comment,
                'columns', coalesce(c.value, '[]'::jsonb),
                'constraints', coalesce(k.value, '[]'::jsonb),
                'indexes', coalesce(i.value, '[]'::jsonb),
                'triggers', coalesce(t.value, '[]'::jsonb),
                'policies', coalesce(p.value, '[]'::jsonb),
                'grants', coalesce(g.value, '[]'::jsonb)
            ) order by r.name
        )
        from relations r
        left join columns_json c on c.name = r.name
        left join constraints_json k on k.name = r.name
        left join indexes_json i on i.name = r.name
        left join triggers_json t on t.name = r.name
        left join policies_json p on p.name = r.name
        left join grants_json g on g.name = r.name
    ), '[]'::jsonb)
) as vendify_pre_v231_baseline_capture;
