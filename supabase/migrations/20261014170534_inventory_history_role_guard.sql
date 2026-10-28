-- VEN008-P1: cost-bearing history requires active owner/admin/manager membership.
-- Preserve the historical payload, tenant/branch filters and bounded limit.
begin;

create or replace function public.listar_movimientos_inventario_v1(
    p_sucursal_id uuid,
    p_limit integer default 100
)
returns table (
    id uuid,
    producto_id uuid,
    producto_nombre text,
    tipo text,
    delta integer,
    stock_resultante integer,
    motivo text,
    detalle jsonb,
    usuario_id uuid,
    usuario_nombre text,
    creado timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.es_miembro_negocio(v_negocio_id) then
        raise exception 'Usuario sin acceso al negocio';
    end if;

    if not public.tiene_rol_negocio(v_negocio_id, array['owner','admin','manager']) then
        raise exception 'Rol sin permiso para consultar movimientos de inventario';
    end if;

    return query
    select
        m.id,
        m.producto_id,
        m.producto_nombre,
        m.tipo,
        m.delta,
        m.stock_resultante,
        coalesce(m.motivo,'')::text,
        coalesce(m.detalle,'{}'::jsonb),
        m.user_id,
        coalesce(
            e.nombre,
            split_part(u.email,'@',1),
            'Usuario'
        )::text,
        m.creado
    from public.movimientos m
    left join auth.users u
      on u.id = m.user_id
    left join public.empleados e
      on e.user_id = m.user_id
     and e.negocio_id = m.negocio_id
    where m.negocio_id = v_negocio_id
      and m.sucursal_id = p_sucursal_id
    order by m.creado desc
    limit greatest(1, least(coalesce(p_limit,100),500));
end;
$$;

revoke all on function public.listar_movimientos_inventario_v1(uuid,integer) from public, anon;
grant execute on function public.listar_movimientos_inventario_v1(uuid,integer) to authenticated;

commit;
