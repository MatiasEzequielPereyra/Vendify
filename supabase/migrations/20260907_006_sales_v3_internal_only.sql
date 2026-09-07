-- ============================================================
-- Vendify — v3 es una dependencia interna de v4, no un endpoint
-- ============================================================
-- v3 ejecuta la venta sin p_request_id. Permitir llamadas del cliente a v3
-- permite saltear la idempotencia garantizada por registrar_venta_v4.

begin;

do $$
declare
  v_v3 regprocedure := to_regprocedure(
    'public.registrar_venta_v3(jsonb,jsonb,text,numeric,text,uuid,uuid)'
  );
  v_v4 regprocedure := to_regprocedure(
    'public.registrar_venta_v4(jsonb,jsonb,text,numeric,text,uuid,uuid,text)'
  );
  v_same_owner boolean;
begin
  if v_v3 is null or v_v4 is null then
    raise exception 'Falta registrar_venta_v3 o registrar_venta_v4 durante el cierre interno.';
  end if;

  select v3.proowner = v4.proowner
    into v_same_owner
    from pg_proc v3
    join pg_proc v4 on v4.oid = v_v4::oid
   where v3.oid = v_v3::oid;

  if not coalesce(v_same_owner, false) then
    raise exception 'v3 y v4 no tienen el mismo owner; no es seguro cerrar el acceso de v3 todavía.';
  end if;
end;
$$;

revoke all on function public.registrar_venta_v3(
  jsonb, jsonb, text, numeric, text, uuid, uuid
) from public;

revoke all on function public.registrar_venta_v3(
  jsonb, jsonb, text, numeric, text, uuid, uuid
) from anon;

revoke all on function public.registrar_venta_v3(
  jsonb, jsonb, text, numeric, text, uuid, uuid
) from authenticated;

do $$
declare
  v_v3 regprocedure := to_regprocedure(
    'public.registrar_venta_v3(jsonb,jsonb,text,numeric,text,uuid,uuid)'
  );
begin
  if has_function_privilege('anon', v_v3, 'execute')
     or has_function_privilege('authenticated', v_v3, 'execute') then
    raise exception 'registrar_venta_v3 sigue expuesta a clientes.';
  end if;
end;
$$;

commit;
