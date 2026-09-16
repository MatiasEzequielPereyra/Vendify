-- ============================================================
-- Vendify — integridad del payload idempotente de ventas
-- ============================================================
-- Un request_id sólo puede reutilizarse para el mismo pedido. Sin esta
-- comprobación, un cliente defectuoso o manipulado podría recibir la
-- respuesta de una venta anterior al reutilizar su identificador.

begin;

do $$
begin
  if to_regclass('public.venta_idempotencia_v23011') is null then
    raise exception 'Falta venta_idempotencia_v23011; no es seguro actualizar registrar_venta_v4.';
  end if;
end;
$$;

create extension if not exists pgcrypto;

alter table public.venta_idempotencia_v23011
  add column if not exists payload_hash text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.venta_idempotencia_v23011'::regclass
       and conname = 'venta_idempotencia_v23011_payload_hash_sha256'
  ) then
    alter table public.venta_idempotencia_v23011
      add constraint venta_idempotencia_v23011_payload_hash_sha256
      check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$$;

do $migration$
declare
  v_digest_schema text;
begin
  select n.nspname
    into v_digest_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';

  if v_digest_schema is null then
    raise exception 'No se encontró el esquema de pgcrypto; no es seguro verificar la integridad idempotente.';
  end if;

  execute format($function$
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
as $body$
declare
  v_negocio_id uuid;
  v_request_id text;
  v_payload_hash text;
  v_payload_hash_existente text;
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

  v_payload_hash := encode(
    %1$I.digest(
      convert_to(
        jsonb_build_object(
          'items', p_items,
          'pagos', p_pagos,
          'descuento_tipo', p_descuento_tipo,
          'descuento_valor', p_descuento_valor,
          'observacion', p_observacion,
          'sucursal_id', p_sucursal_id,
          'caja_id', p_caja_id
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.venta_idempotencia_v23011(
    negocio_id, user_id, request_id, payload_hash
  )
  values(v_negocio_id, auth.uid(), v_request_id, v_payload_hash)
  on conflict (negocio_id, user_id, request_id) do nothing
  returning id into v_insertado;

  if v_insertado is null then
    select vi.respuesta, vi.payload_hash
      into v_respuesta, v_payload_hash_existente
      from public.venta_idempotencia_v23011 vi
     where vi.negocio_id = v_negocio_id
       and vi.user_id = auth.uid()
       and vi.request_id = v_request_id;

    if v_payload_hash_existente is not null
       and v_payload_hash_existente <> v_payload_hash then
      raise exception 'El identificador de operación ya fue usado con una venta distinta.';
    end if;

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
$body$;
$function$, v_digest_schema);
end;
$migration$;

do $$
declare
  v_v4 regprocedure := to_regprocedure(
    'public.registrar_venta_v4(jsonb,jsonb,text,numeric,text,uuid,uuid,text)'
  );
begin
  if v_v4 is null then
    raise exception 'Falta registrar_venta_v4 después de reforzar la idempotencia.';
  end if;

  if has_function_privilege('anon', v_v4, 'execute')
     or not has_function_privilege('authenticated', v_v4, 'execute') then
    raise exception 'Permisos inesperados en registrar_venta_v4 después de reforzar la idempotencia.';
  end if;
end;
$$;

commit;
