-- ============================================================
-- Vendify — margen histórico del dashboard
-- ============================================================
-- La versión anterior calculaba el margen con productos.precio_compra actual.
-- Se preserva temporalmente como implementación interna para no duplicar el
-- dashboard completo y la API pública pasa a reemplazar solo ese KPI.

begin;

alter function public.dashboard_propietario_v1(uuid, integer)
    rename to dashboard_propietario_v1_legacy_v231;

revoke all on function public.dashboard_propietario_v1_legacy_v231(
    uuid,integer
) from public, anon, authenticated;

comment on function public.dashboard_propietario_v1_legacy_v231(uuid,integer) is
  'Implementación interna temporal. No exponer por RPC; usar dashboard_propietario_v1.';

create function public.dashboard_propietario_v1(
    p_sucursal_id uuid default null,
    p_dias integer default 7
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_dashboard jsonb;
    v_negocio_id uuid;
    v_sucursal_id uuid;
    v_desde timestamptz;
    v_margin numeric := 0;
    v_ventas_evaluables numeric := 0;
    v_ventas_con_costo numeric := 0;
    v_cobertura numeric := 0;
begin
    -- Conserva autenticación, rol, sucursal y el resto de los KPI validados
    -- por la implementación existente.
    v_dashboard := public.dashboard_propietario_v1_legacy_v231(
        p_sucursal_id,
        p_dias
    );

    v_negocio_id := public.negocio_actual_id();
    v_sucursal_id := nullif(v_dashboard->>'sucursal_id','')::uuid;
    v_desde := date_trunc('day', now())
      - ((greatest(1, least(coalesce(p_dias, 7), 365)) - 1) || ' days')::interval;

    select
      coalesce(sum(
        case
          when vi.costo_unitario > 0 then
            greatest(
              0,
              coalesce(vi.precio_neto_unitario, vi.precio_unitario, 0)
              - vi.costo_unitario
            )
            * greatest(0, coalesce(vi.cantidad, 0) - coalesce(vi.cantidad_devuelta, 0))
          else 0
        end
      ), 0),
      coalesce(sum(
        greatest(0, coalesce(vi.precio_neto_unitario, vi.precio_unitario, 0))
        * greatest(0, coalesce(vi.cantidad, 0) - coalesce(vi.cantidad_devuelta, 0))
      ), 0),
      coalesce(sum(
        case
          when vi.costo_unitario > 0 then
            greatest(0, coalesce(vi.precio_neto_unitario, vi.precio_unitario, 0))
            * greatest(0, coalesce(vi.cantidad, 0) - coalesce(vi.cantidad_devuelta, 0))
          else 0
        end
      ), 0)
    into v_margin, v_ventas_evaluables, v_ventas_con_costo
    from public.venta_items vi
    join public.ventas v
      on v.id = vi.venta_id
     and v.negocio_id = v_negocio_id
    where v.sucursal_id = v_sucursal_id
      and v.creado >= v_desde
      and v.estado <> 'anulada';

    v_cobertura := case
      when v_ventas_evaluables <= 0 then 0
      else round((v_ventas_con_costo / v_ventas_evaluables) * 100, 1)
    end;

    return v_dashboard || jsonb_build_object(
      'margen_estimado', round(v_margin, 2),
      'margen_calidad', case
        when v_ventas_evaluables <= 0 then 'sin_ventas'
        when v_cobertura >= 100 then 'completo'
        else 'parcial'
      end,
      'margen_cobertura_pct', v_cobertura
    );
end;
$$;

revoke all on function public.dashboard_propietario_v1(uuid,integer)
    from public, anon;

grant execute on function public.dashboard_propietario_v1(uuid,integer)
    to authenticated;

do $$
begin
    if has_function_privilege(
        'authenticated',
        'public.dashboard_propietario_v1_legacy_v231(uuid,integer)',
        'execute'
    ) then
        raise exception 'dashboard_propietario_v1_legacy_v231 continúa expuesta a clientes';
    end if;

    if not has_function_privilege(
        'authenticated',
        'public.dashboard_propietario_v1(uuid,integer)',
        'execute'
    ) then
        raise exception 'dashboard_propietario_v1 no quedó disponible para authenticated';
    end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
