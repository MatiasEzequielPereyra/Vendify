-- ============================================================
-- Vendify — permiso de ejecución para guardas de RLS
-- ============================================================
-- Las policies de tablas comerciales llaman a tiene_rol_negocio().
-- Mantener EXECUTE para authenticated no concede datos por sí solo:
-- la función sólo responde según auth.uid() y las policies continúan
-- siendo el límite de lectura/escritura.

begin;

do $$
begin
  if to_regprocedure('public.tiene_rol_negocio(uuid,text[])') is null then
    raise exception 'Falta public.tiene_rol_negocio(uuid,text[])';
  end if;
end;
$$;

revoke all on function public.tiene_rol_negocio(uuid, text[]) from public, anon;
grant execute on function public.tiene_rol_negocio(uuid, text[]) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.tiene_rol_negocio(uuid,text[])', 'execute') then
    raise exception 'anon no debe ejecutar tiene_rol_negocio';
  end if;

  if not has_function_privilege('authenticated', 'public.tiene_rol_negocio(uuid,text[])', 'execute') then
    raise exception 'authenticated debe ejecutar tiene_rol_negocio para evaluar RLS';
  end if;
end;
$$;

commit;
