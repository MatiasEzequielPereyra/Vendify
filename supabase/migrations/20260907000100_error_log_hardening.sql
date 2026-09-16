-- ============================================================
-- Vendify — endurecimiento de observabilidad de cliente
-- ============================================================
-- Evita que un cliente autenticado pueda asociar errores a sucursales de otro
-- negocio y limita el volumen de eventos sin depender del throttle del browser.

begin;

create index if not exists vendify_error_logs_negocio_usuario_fecha_idx
    on public.vendify_error_logs(negocio_id, user_id, creado desc);

create or replace function public.registrar_error_cliente_v1(
    p_tipo text,
    p_mensaje text,
    p_version text default null,
    p_contexto jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_sucursal_solicitada uuid;
    v_sucursal_id uuid;
    v_contexto jsonb;
    v_eventos_recientes integer;
begin
    if auth.uid() is null then
        return;
    end if;

    v_negocio_id := public.negocio_actual_id();

    if public.es_miembro_negocio(v_negocio_id) is not true then
        return;
    end if;

    -- Serializa solamente los eventos del mismo usuario y negocio para que dos
    -- requests paralelos no puedan superar el límite de la ventana.
    perform pg_advisory_xact_lock(
        hashtext(auth.uid()::text || ':' || v_negocio_id::text)
    );

    select count(*)
      into v_eventos_recientes
      from public.vendify_error_logs e
     where e.negocio_id = v_negocio_id
       and e.user_id = auth.uid()
       and e.creado >= now() - interval '1 minute';

    if v_eventos_recientes >= 30 then
        return;
    end if;

    begin
        v_sucursal_solicitada :=
          nullif(coalesce(p_contexto->>'branch_id',''),'')::uuid;
    exception
        when others then
          v_sucursal_solicitada := null;
    end;

    -- Nunca persistir una sucursal indicada por el cliente si no pertenece al
    -- negocio resuelto por la sesión autenticada.
    if v_sucursal_solicitada is not null then
        select s.id
          into v_sucursal_id
          from public.sucursales s
         where s.id = v_sucursal_solicitada
           and s.negocio_id = v_negocio_id;
    end if;

    v_contexto := coalesce(p_contexto, '{}'::jsonb) - 'branch_id';
    if v_sucursal_id is not null then
        v_contexto := v_contexto || jsonb_build_object('branch_id', v_sucursal_id::text);
    end if;

    insert into public.vendify_error_logs(
        negocio_id,sucursal_id,user_id,tipo,mensaje,version,contexto
    )
    values(
        v_negocio_id,
        v_sucursal_id,
        auth.uid(),
        left(coalesce(nullif(trim(p_tipo),''),'client'),50),
        left(coalesce(nullif(trim(p_mensaje),''),'Error cliente'),1000),
        left(coalesce(p_version,''),30),
        v_contexto
    );
end;
$$;

revoke all on function public.registrar_error_cliente_v1(
    text,text,text,jsonb
) from public, anon;

grant execute on function public.registrar_error_cliente_v1(
    text,text,text,jsonb
) to authenticated;

do $$
begin
    if has_function_privilege(
        'anon',
        'public.registrar_error_cliente_v1(text,text,text,jsonb)',
        'execute'
    ) then
        raise exception 'registrar_error_cliente_v1 continúa expuesta a anon';
    end if;
end;
$$;

commit;
