-- Synthetic local fixture assertions. This is NOT an authenticated staging test.
-- The runner installs the real authorization helpers and actual RPC definition.
create schema fixture_test;
create function fixture_test.expect_denied(expected_message text, branch_id uuid)
returns void language plpgsql as $$
declare denied boolean := false;
begin
    begin
        perform * from public.listar_movimientos_inventario_v1(branch_id, 100);
    exception when raise_exception then
        if sqlerrm <> expected_message then raise; end if;
        denied := true;
    end;
    if not denied then raise exception 'Expected denial: %', expected_message; end if;
end;
$$;
grant usage on schema fixture_test to authenticated;

-- A: active cashier cannot recover costs even with manual stock permission.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
select fixture_test.expect_denied('Rol sin permiso para consultar movimientos de inventario',
    '20000000-0000-0000-0000-000000000001');
do $$
declare denied boolean; requested_limit integer;
begin
    foreach requested_limit in array array[null,0,-5,500,9999] loop
        denied := false;
        begin
            perform * from public.listar_movimientos_inventario_v1(
                '20000000-0000-0000-0000-000000000001',requested_limit);
        exception when raise_exception then
            if sqlerrm <> 'Rol sin permiso para consultar movimientos de inventario' then raise; end if;
            denied := true;
        end;
        if not denied then raise exception 'Limit argument bypassed cost guard'; end if;
    end loop;
    if exists(select 1 from public.movimientos) then
        raise exception 'Direct movement RLS route exposed costs to cashier';
    end if;
end;
$$;
rollback;

-- B/C/D/H: all supervisory roles preserve rows, JSON cost details and column shape.
do $$
declare actor uuid; row_json jsonb; expected_keys text[] := array[
    'creado','delta','detalle','id','motivo','producto_id','producto_nombre',
    'stock_resultante','tipo','usuario_id','usuario_nombre'];
begin
    foreach actor in array array[
        '10000000-0000-0000-0000-000000000001'::uuid,
        '10000000-0000-0000-0000-000000000002'::uuid,
        '10000000-0000-0000-0000-000000000003'::uuid] loop
        perform set_config('request.jwt.claim.sub',actor::text,true);
        execute 'set local role authenticated';
        select to_jsonb(m) into row_json
        from public.listar_movimientos_inventario_v1(
            '20000000-0000-0000-0000-000000000001',1) m;
        if row_json->'detalle' <> '{"costo_anterior":17,"costo_unitario":23}'::jsonb then
            raise exception 'Supervisor detail contract changed';
        end if;
        if (select array_agg(k order by k) from jsonb_object_keys(row_json) k) <> expected_keys then
            raise exception 'Return columns changed';
        end if;
        if row_json->>'usuario_nombre' <> 'Synthetic Owner' or row_json->>'motivo' <> '' then
            raise exception 'Name/motive fallback changed';
        end if;
        execute 'reset role';
    end loop;
end;
$$;

-- E: missing identity denied even through authenticated execution.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select fixture_test.expect_denied('Sesión requerida','20000000-0000-0000-0000-000000000001');
rollback;

-- The anon role cannot call the RPC at all, independently of authentication guards.
begin;
set local role anon;
do $$ begin
    begin
        perform * from public.listar_movimientos_inventario_v1(
            '20000000-0000-0000-0000-000000000001',100);
        raise exception 'Anonymous RPC execution unexpectedly succeeded';
    exception when insufficient_privilege then null;
    end;
end $$;
rollback;

-- Inactive membership and authenticated user without membership denied.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000006',true);
select fixture_test.expect_denied('El usuario no pertenece a ningún negocio','20000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000007',true);
select fixture_test.expect_denied('El usuario no pertenece a ningún negocio','20000000-0000-0000-0000-000000000001');
rollback;

-- F/G: legitimate owner of another tenant cannot read this tenant's branch.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
do $$ begin
    if exists(select 1 from public.listar_movimientos_inventario_v1(
        '20000000-0000-0000-0000-000000000001',100)) then
        raise exception 'Foreign tenant data exposed';
    end if;
end $$;
rollback;

-- Correct tenant cannot retrieve a foreign branch; distinct local branch stays distinct.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$ begin
    if exists(select 1 from public.listar_movimientos_inventario_v1(
        '20000000-0000-0000-0000-000000000003',100)) then
        raise exception 'Foreign branch data exposed';
    end if;
    if (select count(*) from public.listar_movimientos_inventario_v1(
        '20000000-0000-0000-0000-000000000002',100)) <> 1 then
        raise exception 'Branch context mixed';
    end if;
    if (select count(*) from public.listar_movimientos_inventario_v1(
        '20000000-0000-0000-0000-000000000001')) <> 100 or
       (select count(*) from public.listar_movimientos_inventario_v1(
        '20000000-0000-0000-0000-000000000001',null)) <> 100 or
       (select count(*) from public.listar_movimientos_inventario_v1(
        '20000000-0000-0000-0000-000000000001',0)) <> 1 or
       (select count(*) from public.listar_movimientos_inventario_v1(
        '20000000-0000-0000-0000-000000000001',-5)) <> 1 or
       (select count(*) from public.listar_movimientos_inventario_v1(
        '20000000-0000-0000-0000-000000000001',9999)) <> 500 then
        raise exception 'Bounded limit contract changed';
    end if;
end $$;
rollback;

-- Function properties and anonymous grants are unchanged/hardened, no RLS weakening.
do $$ begin
    if has_function_privilege('anon','public.listar_movimientos_inventario_v1(uuid,integer)','EXECUTE') then
        raise exception 'Anonymous execution granted';
    end if;
    if not has_function_privilege('authenticated','public.listar_movimientos_inventario_v1(uuid,integer)','EXECUTE') then
        raise exception 'Authenticated execution lost';
    end if;
    if not exists(select 1 from pg_proc where oid=
        'public.listar_movimientos_inventario_v1(uuid,integer)'::regprocedure
        and prosecdef and provolatile='s' and 'search_path=public'=any(proconfig)) then
        raise exception 'Function security properties changed';
    end if;
end $$;
select 'LOCAL_POSTGRES_SYNTHETIC_ROLE_MATRIX_PASS';
