-- ============================================================
-- Vendify — orden determinista de locks para ventas concurrentes
-- ============================================================
-- v3 bloquea stock por producto. v4 adquiere primero locks transaccionales
-- por producto en UUID ascendente para que dos cajas con carritos cruzados
-- no tomen esos locks en orden inverso.

begin;

create or replace function public.registrar_venta_v4(
  p_items jsonb,
  p_pagos jsonb,
  p_descuento_tipo text default null,
  p_descuento_valor numeric default 0,
  p_observacion text default null,
  p_sucursal_id uuid default null,
  p_caja_id uuid default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_negocio_id uuid;
  v_request_id text;
  v_insertado uuid;
  v_respuesta jsonb;
  v_lock_producto_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sesión requerida';
  end if;

  if to_regprocedure(
    'public.registrar_venta_v3(jsonb,jsonb,text,numeric,text,uuid,uuid)'
  ) is null then
    raise exception 'Falta instalar registrar_venta_v3 antes de Stability';
  end if;

  v_negocio_id := public.negocio_actual_id();
  v_request_id := nullif(trim(coalesce(p_request_id, '')), '');

  if v_request_id is null
     or length(v_request_id) < 8
     or length(v_request_id) > 100 then
    raise exception 'Identificador de operación inválido';
  end if;

  insert into public.venta_idempotencia_v23011(
    negocio_id, user_id, request_id
  )
  values(v_negocio_id, auth.uid(), v_request_id)
  on conflict (negocio_id, user_id, request_id) do nothing
  returning id into v_insertado;

  if v_insertado is null then
    select vi.respuesta
      into v_respuesta
      from public.venta_idempotencia_v23011 vi
     where vi.negocio_id = v_negocio_id
       and vi.user_id = auth.uid()
       and vi.request_id = v_request_id;

    if v_respuesta is null then
      raise exception 'La misma venta todavía se está procesando. Esperá un instante.';
    end if;

    return v_respuesta;
  end if;

  for v_lock_producto_id in
    select distinct (item->>'producto_id')::uuid
      from jsonb_array_elements(p_items) item
     order by 1
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(v_lock_producto_id::text, 0)
    );
  end loop;

  v_respuesta := public.registrar_venta_v3(
    p_items,
    p_pagos,
    p_descuento_tipo,
    p_descuento_valor,
    p_observacion,
    p_sucursal_id,
    p_caja_id
  );

  update public.venta_idempotencia_v23011
     set respuesta = v_respuesta,
         actualizado = now()
   where id = v_insertado;

  return v_respuesta;
end;
$$;

do $$
declare
  v_v4 regprocedure := to_regprocedure(
    'public.registrar_venta_v4(jsonb,jsonb,text,numeric,text,uuid,uuid,text)'
  );
begin
  if v_v4 is null then
    raise exception 'Falta registrar_venta_v4 después de configurar locks de stock.';
  end if;

  if has_function_privilege('anon', v_v4, 'execute')
     or not has_function_privilege('authenticated', v_v4, 'execute') then
    raise exception 'Permisos inesperados en registrar_venta_v4 después de configurar locks.';
  end if;
end;
$$;

commit;
