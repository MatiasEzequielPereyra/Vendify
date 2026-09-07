-- ============================================================
-- Vendify — cierre de ejecución anónima del RPC de ventas
-- ============================================================
-- registrar_venta_v4 ya exige auth.uid(), pero es una operación crítica
-- SECURITY DEFINER: el rol anon no debe poder ni siquiera invocarla.

begin;

revoke execute on function public.registrar_venta_v4(
  jsonb, jsonb, text, numeric, text, uuid, uuid, text
) from public;

revoke execute on function public.registrar_venta_v4(
  jsonb, jsonb, text, numeric, text, uuid, uuid, text
) from anon;

grant execute on function public.registrar_venta_v4(
  jsonb, jsonb, text, numeric, text, uuid, uuid, text
) to authenticated, service_role;

do $$
declare
  v_registrar_venta regprocedure := to_regprocedure(
    'public.registrar_venta_v4(jsonb,jsonb,text,numeric,text,uuid,uuid,text)'
  );
begin
  if v_registrar_venta is null then
    raise exception 'Falta registrar_venta_v4 durante el cierre de permisos.';
  end if;

  if has_function_privilege('anon', v_registrar_venta, 'execute') then
    raise exception 'anon todavía puede ejecutar registrar_venta_v4.';
  end if;

  if not has_function_privilege('authenticated', v_registrar_venta, 'execute') then
    raise exception 'authenticated perdió ejecución sobre registrar_venta_v4.';
  end if;
end;
$$;

commit;
