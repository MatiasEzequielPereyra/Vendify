-- ============================================================
-- Vendify — aislamiento multiempresa para límites de planes
-- ============================================================

begin;

create or replace function public.validar_limite_plan_v1(
    p_negocio_id uuid,
    p_recurso text,
    p_incremento integer default 1
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_plan public.vendify_planes;
    v_sub public.vendify_suscripciones;
    v_actual integer;
    v_limite integer;
    v_backend_confiable boolean;
begin
    -- Los triggers también se ejecutan durante altas realizadas por las
    -- Edge Functions con service_role y durante migraciones administrativas.
    -- Todo otro contexto debe ser miembro activo antes de consultar datos del
    -- plan, para no filtrar información de otro negocio mediante errores.
    v_backend_confiable :=
      coalesce(auth.role(),'') = 'service_role'
      or session_user in ('postgres','supabase_admin');

    if not v_backend_confiable
       and public.es_miembro_negocio(p_negocio_id) is not true then
        raise exception 'Acceso denegado';
    end if;

    if p_recurso not in ('sucursales','usuarios','productos') then
        raise exception 'Recurso de plan inválido';
    end if;

    select *
      into v_sub
      from public.vendify_suscripciones
     where negocio_id = p_negocio_id;

    if v_sub.negocio_id is null
       or v_sub.plan_codigo = 'legacy' then
        return true;
    end if;

    if v_sub.estado = 'trial'
       and v_sub.trial_hasta is not null
       and v_sub.trial_hasta < now() then
        raise exception 'La prueba de Vendify venció. Elegí un plan para continuar.';
    end if;

    select *
      into v_plan
      from public.vendify_planes
     where codigo = v_sub.plan_codigo;

    if p_recurso = 'sucursales' then
        v_limite := v_plan.max_sucursales;
        select count(*) into v_actual
          from public.sucursales s
         where s.negocio_id = p_negocio_id
           and s.activa = true;
    elsif p_recurso = 'usuarios' then
        v_limite := v_plan.max_usuarios;
        select count(*) into v_actual
          from public.negocio_miembros nm
         where nm.negocio_id = p_negocio_id
           and nm.activo = true;
    else
        v_limite := v_plan.max_productos;
        select count(*) into v_actual
          from public.productos p
         where p.negocio_id = p_negocio_id;
    end if;

    if v_limite is null then
        return true;
    end if;

    if v_actual + greatest(0,coalesce(p_incremento,1)) > v_limite then
        raise exception
          'Límite del plan alcanzado para % (% de %)',
          p_recurso,v_actual,v_limite;
    end if;

    return true;
end;
$$;

-- Es una primitiva interna usada por funciones y triggers SECURITY DEFINER.
-- No forma parte de la API RPC pública del cliente.
revoke all on function public.validar_limite_plan_v1(
    uuid,text,integer
) from public, anon, authenticated;

comment on function public.validar_limite_plan_v1(uuid,text,integer) is
  'Valida límites comerciales dentro del tenant. Uso interno: no exponer como RPC al cliente.';

-- Falla la migración si una concesión heredada vuelve a publicar la función.
do $$
begin
    if has_function_privilege(
        'anon',
        'public.validar_limite_plan_v1(uuid,text,integer)',
        'execute'
    ) or has_function_privilege(
        'authenticated',
        'public.validar_limite_plan_v1(uuid,text,integer)',
        'execute'
    ) then
        raise exception 'validar_limite_plan_v1 continúa expuesta a clientes';
    end if;
end;
$$;

commit;
