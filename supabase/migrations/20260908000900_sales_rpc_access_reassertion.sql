-- ============================================================
-- Vendify — cierre verificable de acceso a RPC de ventas
-- ============================================================
-- v3 no contiene request_id y sólo puede ser llamado internamente por v4.
-- Reafirmamos los permisos porque un diagnóstico previo detectó ejecución
-- anónima en una instalación activa.

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
    raise exception 'Falta registrar_venta_v3 o registrar_venta_v4; no es seguro reconfigurar permisos.';
  end if;

  select v3.proowner = v4.proowner
    into v_same_owner
    from pg_proc v3
    join pg_proc v4 on v4.oid = v_v4::oid
   where v3.oid = v_v3::oid;

  if not coalesce(v_same_owner, false) then
    raise exception 'v3 y v4 no tienen el mismo owner; no es seguro cerrar v3.';
  end if;
end;
$$;

revoke all on function public.registrar_venta_v3(
  jsonb, jsonb, text, numeric, text, uuid, uuid
) from public, anon, authenticated, service_role;

revoke all on function public.registrar_venta_v4(
  jsonb, jsonb, text, numeric, text, uuid, uuid, text
) from public, anon;

grant execute on function public.registrar_venta_v4(
  jsonb, jsonb, text, numeric, text, uuid, uuid, text
) to authenticated, service_role;

do $$
declare
  v_v3 regprocedure := to_regprocedure(
    'public.registrar_venta_v3(jsonb,jsonb,text,numeric,text,uuid,uuid)'
  );
  v_v4 regprocedure := to_regprocedure(
    'public.registrar_venta_v4(jsonb,jsonb,text,numeric,text,uuid,uuid,text)'
  );
begin
  if has_function_privilege('anon', v_v3, 'execute')
     or has_function_privilege('authenticated', v_v3, 'execute')
     or has_function_privilege('service_role', v_v3, 'execute') then
    raise exception 'registrar_venta_v3 sigue expuesta; bloquear publicación y sincronización.';
  end if;

  if has_function_privilege('anon', v_v4, 'execute')
     or not has_function_privilege('authenticated', v_v4, 'execute')
     or not has_function_privilege('service_role', v_v4, 'execute') then
    raise exception 'Permisos inesperados en registrar_venta_v4.';
  end if;
end;
$$;

commit;
