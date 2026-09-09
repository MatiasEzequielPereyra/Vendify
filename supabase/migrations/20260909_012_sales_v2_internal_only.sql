-- ============================================================
-- Vendify — cierre de la ruta de venta v2 obsoleta
-- ============================================================
-- El POS y la sincronización offline usan registrar_venta_v4, que agrega
-- idempotencia e integridad del payload. v2 no debe quedar accesible por API.

begin;

do $$
declare
  v_v2 regprocedure := to_regprocedure('public.registrar_venta_v2(jsonb,text,uuid,uuid)');
  v_v4 regprocedure := to_regprocedure(
    'public.registrar_venta_v4(jsonb,jsonb,text,numeric,text,uuid,uuid,text)'
  );
begin
  if v_v4 is null then
    raise exception 'Falta registrar_venta_v4; no es seguro cerrar registrar_venta_v2.';
  end if;

  if v_v2 is null then
    return;
  end if;

  revoke all on function public.registrar_venta_v2(jsonb,text,uuid,uuid)
    from public, anon, authenticated;

  if has_function_privilege('anon', v_v2, 'execute')
     or has_function_privilege('authenticated', v_v2, 'execute') then
    raise exception 'registrar_venta_v2 sigue expuesta a clientes; bloquear publicación.';
  end if;

  if not has_function_privilege('authenticated', v_v4, 'execute') then
    raise exception 'authenticated perdió acceso a registrar_venta_v4.';
  end if;
end;
$$;

commit;
