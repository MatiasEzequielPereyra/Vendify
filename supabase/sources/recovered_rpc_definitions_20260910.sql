-- Recovered from the deployed Supabase project on 2026-09-10.
-- Source reference only: do not include this file in the migration execution chain.
-- The definitions are versioned here for auditability and contract coverage.

CREATE OR REPLACE FUNCTION public.actualizar_rol_miembro_v2(p_membership_id uuid, p_rol text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_negocio_id uuid;
    v_target public.negocio_miembros;
begin
    v_negocio_id := public.negocio_actual_id();
    if not public.tiene_rol_negocio(v_negocio_id, array['owner','admin']) then
        raise exception 'No tenés permiso para cambiar roles';
    end if;
    if p_rol not in ('admin','manager','cashier') then raise exception 'Rol inválido'; end if;

    select * into v_target
      from public.negocio_miembros
     where id=p_membership_id and negocio_id=v_negocio_id
     for update;

    if not found then raise exception 'Miembro inexistente'; end if;
    if v_target.rol='owner' then raise exception 'El propietario no puede cambiarse desde Equipo'; end if;
    if v_target.user_id=auth.uid() then raise exception 'No podés cambiar tu propio rol'; end if;

    update public.negocio_miembros set rol=p_rol where id=p_membership_id;

    insert into public.audit_log(negocio_id,user_id,accion,entidad,entidad_id,detalle)
    values(v_negocio_id,auth.uid(),'rol_actualizado','negocio_miembros',p_membership_id,
           jsonb_build_object('rol_anterior',v_target.rol,'rol_nuevo',p_rol));

    return jsonb_build_object('ok',true,'rol',p_rol);
end;
$function$

CREATE OR REPLACE FUNCTION public.actualizar_sucursal_v1(p_sucursal_id uuid, p_nombre text, p_direccion text DEFAULT NULL::text, p_telefono text DEFAULT NULL::text, p_activa boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_negocio_id uuid;
    v_actual public.sucursales;
    v_resultado public.sucursales;
    v_activas integer;
    v_stock bigint;
begin
    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin']
    ) then
        raise exception 'No tenés permiso para editar sucursales';
    end if;

    select *
      into v_actual
      from public.sucursales
     where id = p_sucursal_id
       and negocio_id = v_negocio_id
     for update;

    if not found then
        raise exception 'Sucursal inexistente';
    end if;

    if length(trim(coalesce(p_nombre,''))) < 2 then
        raise exception 'Ingresá un nombre válido';
    end if;

    if exists (
        select 1
        from public.sucursales s
        where s.negocio_id = v_negocio_id
          and s.id <> p_sucursal_id
          and lower(s.nombre) = lower(trim(p_nombre))
    ) then
        raise exception 'Ya existe una sucursal con ese nombre';
    end if;

    if v_actual.activa = true and p_activa = false then
        select count(*)
          into v_activas
          from public.sucursales s
         where s.negocio_id = v_negocio_id
           and s.activa = true;

        if v_activas <= 1 then
            raise exception 'No podés desactivar la única sucursal activa';
        end if;

        select coalesce(sum(ps.stock),0)
          into v_stock
          from public.producto_stock_sucursal ps
         where ps.sucursal_id = p_sucursal_id;

        if v_stock > 0 then
            raise exception 'Transferí o ajustá el stock antes de desactivar la sucursal';
        end if;
    end if;

    update public.sucursales
       set nombre = trim(p_nombre),
           direccion = nullif(trim(coalesce(p_direccion,'')),''),
           telefono = nullif(trim(coalesce(p_telefono,'')),''),
           activa = p_activa,
           actualizado = now()
     where id = p_sucursal_id
     returning * into v_resultado;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,auth.uid(),'sucursal_actualizada','sucursales',
        v_resultado.id,
        jsonb_build_object(
            'nombre',v_resultado.nombre,
            'activa',v_resultado.activa
        )
    );

    return to_jsonb(v_resultado);
end;
$function$

CREATE OR REPLACE FUNCTION public.autorizar_descuento_v1(p_pin text, p_sucursal_id uuid, p_subtotal numeric, p_descuento_tipo text, p_descuento_valor numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
    v_negocio_id uuid;
    v_intentos public.descuento_pin_intentos;
    v_autorizador_user_id uuid;
    v_autorizador_rol text;
    v_autorizador_nombre text;
    v_auth public.descuento_autorizaciones;
    v_nuevo_intentos integer;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.es_miembro_negocio(v_negocio_id) then
        raise exception 'Usuario sin acceso al negocio';
    end if;

    if not exists (
        select 1
        from public.sucursales s
        where s.id = p_sucursal_id
          and s.negocio_id = v_negocio_id
          and s.activa = true
    ) then
        raise exception 'Sucursal inválida';
    end if;

    if p_subtotal is null or p_subtotal <= 0 then
        return jsonb_build_object('ok',false,'message','El carrito está vacío');
    end if;

    if p_descuento_tipo not in ('porcentaje','monto') then
        return jsonb_build_object('ok',false,'message','Tipo de descuento inválido');
    end if;

    if p_descuento_valor is null or p_descuento_valor <= 0 then
        return jsonb_build_object('ok',false,'message','Ingresá un descuento válido');
    end if;

    if p_descuento_tipo = 'porcentaje' and p_descuento_valor > 100 then
        return jsonb_build_object('ok',false,'message','El porcentaje no puede superar 100%');
    end if;

    if p_descuento_tipo = 'monto' and p_descuento_valor > p_subtotal then
        return jsonb_build_object('ok',false,'message','El descuento no puede superar el subtotal');
    end if;

    -- Crear/lockear estado de intentos.
    insert into public.descuento_pin_intentos(
        negocio_id,user_id,intentos,ventana_inicio,actualizado
    )
    values(
        v_negocio_id,auth.uid(),0,now(),now()
    )
    on conflict (negocio_id,user_id) do nothing;

    select *
      into v_intentos
      from public.descuento_pin_intentos dpi
     where dpi.negocio_id = v_negocio_id
       and dpi.user_id = auth.uid()
     for update;

    if v_intentos.bloqueado_hasta is not null
       and v_intentos.bloqueado_hasta > now() then
        return jsonb_build_object(
            'ok', false,
            'message',
            'Demasiados intentos. Esperá unos minutos antes de volver a probar.'
        );
    end if;

    if v_intentos.ventana_inicio < now() - interval '10 minutes' then
        update public.descuento_pin_intentos
           set intentos = 0,
               ventana_inicio = now(),
               bloqueado_hasta = null,
               actualizado = now()
         where negocio_id = v_negocio_id
           and user_id = auth.uid();

        v_intentos.intentos := 0;
    end if;

    if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
        return jsonb_build_object(
            'ok', false,
            'message', 'PIN inválido'
        );
    end if;

    select
        nm.user_id,
        nm.rol,
        coalesce(
            e.nombre,
            split_part(u.email,'@',1),
            case when nm.rol='owner' then 'Propietario' else 'Administrador' end
        )
      into
        v_autorizador_user_id,
        v_autorizador_rol,
        v_autorizador_nombre
      from public.negocio_miembros nm
      join auth.users u
        on u.id = nm.user_id
      left join public.empleados e
        on e.user_id = nm.user_id
       and e.negocio_id = nm.negocio_id
     where nm.negocio_id = v_negocio_id
       and nm.activo = true
       and nm.rol in ('owner','admin')
       and nm.pin_descuento_hash is not null
       and crypt(p_pin, nm.pin_descuento_hash) = nm.pin_descuento_hash
     order by
       case when nm.rol = 'owner' then 0 else 1 end,
       nm.creado
     limit 1;

    if v_autorizador_user_id is null then
        v_nuevo_intentos := coalesce(v_intentos.intentos,0) + 1;

        update public.descuento_pin_intentos
           set intentos = v_nuevo_intentos,
               bloqueado_hasta =
                   case
                     when v_nuevo_intentos >= 5
                     then now() + interval '5 minutes'
                     else null
                   end,
               actualizado = now()
         where negocio_id = v_negocio_id
           and user_id = auth.uid();

        return jsonb_build_object(
            'ok', false,
            'message',
            case
              when v_nuevo_intentos >= 5
              then 'PIN incorrecto. Se bloquearon nuevos intentos durante 5 minutos.'
              else 'PIN de administrador incorrecto.'
            end
        );
    end if;

    update public.descuento_pin_intentos
       set intentos = 0,
           ventana_inicio = now(),
           bloqueado_hasta = null,
           actualizado = now()
     where negocio_id = v_negocio_id
       and user_id = auth.uid();

    -- Inutilizar autorizaciones anteriores no consumidas del mismo vendedor.
    update public.descuento_autorizaciones
       set expira_en = now()
     where negocio_id = v_negocio_id
       and sucursal_id = p_sucursal_id
       and solicitante_user_id = auth.uid()
       and usado_en is null
       and expira_en > now();

    insert into public.descuento_autorizaciones(
        negocio_id,
        sucursal_id,
        solicitante_user_id,
        autorizador_user_id,
        subtotal,
        descuento_tipo,
        descuento_valor,
        expira_en
    )
    values(
        v_negocio_id,
        p_sucursal_id,
        auth.uid(),
        v_autorizador_user_id,
        round(p_subtotal,2),
        p_descuento_tipo,
        round(p_descuento_valor,2),
        now() + interval '3 minutes'
    )
    returning * into v_auth;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'descuento_pin_validado',
        'descuento_autorizaciones',
        v_auth.id,
        jsonb_build_object(
            'autorizador_user_id',v_autorizador_user_id,
            'sucursal_id',p_sucursal_id,
            'subtotal',round(p_subtotal,2),
            'tipo',p_descuento_tipo,
            'valor',round(p_descuento_valor,2)
        )
    );

    return jsonb_build_object(
        'ok', true,
        'autorizacion_id', v_auth.id,
        'autorizador_user_id', v_autorizador_user_id,
        'autorizador_rol',
            case
              when v_autorizador_rol='owner' then 'Propietario'
              else 'Administrador'
            end,
        'autorizador_nombre', v_autorizador_nombre,
        'expira_segundos', 180
    );
end;
$function$

CREATE OR REPLACE FUNCTION public.cambiar_estado_caja_v1(p_caja_id uuid, p_activa boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_negocio_id uuid;
    v_caja public.cajas;
    v_activas integer;
begin
    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin']
    ) then
        raise exception 'No tenés permiso para modificar cajas';
    end if;

    select *
      into v_caja
      from public.cajas
     where id = p_caja_id
       and negocio_id = v_negocio_id
     for update;

    if not found then
        raise exception 'Caja inexistente';
    end if;

    if v_caja.activa = true and p_activa = false then
        select count(*)
          into v_activas
          from public.cajas c
         where c.sucursal_id = v_caja.sucursal_id
           and c.activa = true;

        if v_activas <= 1 then
            raise exception 'La sucursal debe conservar al menos una caja activa';
        end if;
    end if;

    update public.cajas
       set activa = p_activa
     where id = p_caja_id
     returning * into v_caja;

    return to_jsonb(v_caja);
end;
$function$

CREATE OR REPLACE FUNCTION public.cambiar_estado_miembro_v3(p_membership_id uuid, p_activo boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_negocio_id uuid;
    v_target public.negocio_miembros;
begin
    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(v_negocio_id, array['owner','admin']) then
        raise exception 'No tenés permiso para cambiar el estado de empleados';
    end if;

    select *
      into v_target
      from public.negocio_miembros
     where id = p_membership_id
       and negocio_id = v_negocio_id
     for update;

    if not found then
        raise exception 'Miembro inexistente';
    end if;

    if v_target.rol = 'owner' then
        raise exception 'El propietario no puede desactivarse';
    end if;

    if v_target.user_id = auth.uid() then
        raise exception 'No podés desactivar tu propio usuario';
    end if;

    update public.negocio_miembros
       set activo = p_activo
     where id = p_membership_id;

    update public.empleados
       set activo = p_activo,
           actualizado = now()
     where negocio_id = v_negocio_id
       and user_id = v_target.user_id;

    return jsonb_build_object('ok',true,'activo',p_activo);
end;
$function$

CREATE OR REPLACE FUNCTION public.configurar_pin_descuento_v1(p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
    v_negocio_id uuid;
    v_rol text;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
        return jsonb_build_object(
            'ok', false,
            'message', 'El PIN debe tener entre 4 y 8 números'
        );
    end if;

    v_negocio_id := public.negocio_actual_id();

    select nm.rol
      into v_rol
      from public.negocio_miembros nm
     where nm.negocio_id = v_negocio_id
       and nm.user_id = auth.uid()
       and nm.activo = true
     limit 1;

    if coalesce(v_rol,'') not in ('owner','admin') then
        raise exception 'Solo Propietarios y Administradores pueden configurar un PIN';
    end if;

    update public.negocio_miembros
       set pin_descuento_hash = crypt(p_pin, gen_salt('bf', 8)),
           pin_descuento_actualizado = now()
     where negocio_id = v_negocio_id
       and user_id = auth.uid()
       and activo = true;

    insert into public.audit_log(
        negocio_id,
        user_id,
        accion,
        entidad,
        entidad_id,
        detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'pin_descuento_actualizado',
        'negocio_miembros',
        (
          select nm.id
          from public.negocio_miembros nm
          where nm.negocio_id = v_negocio_id
            and nm.user_id = auth.uid()
          limit 1
        ),
        jsonb_build_object('rol', v_rol)
    );

    return jsonb_build_object(
        'ok', true,
        'configurado', true
    );
end;
$function$

CREATE OR REPLACE FUNCTION public.crear_caja_v1(p_sucursal_id uuid, p_nombre text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_negocio_id uuid;
    v_caja public.cajas;
begin
    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin']
    ) then
        raise exception 'No tenés permiso para crear cajas';
    end if;

    if not exists (
        select 1 from public.sucursales
        where id = p_sucursal_id
          and negocio_id = v_negocio_id
    ) then
        raise exception 'Sucursal inválida';
    end if;

    if length(trim(coalesce(p_nombre,''))) < 2 then
        raise exception 'Ingresá un nombre válido para la caja';
    end if;

    if exists (
        select 1
        from public.cajas c
        where c.sucursal_id = p_sucursal_id
          and lower(c.nombre) = lower(trim(p_nombre))
    ) then
        raise exception 'Ya existe una caja con ese nombre';
    end if;

    insert into public.cajas(
        negocio_id,sucursal_id,nombre,activa
    )
    values(
        v_negocio_id,p_sucursal_id,trim(p_nombre),true
    )
    returning * into v_caja;

    return to_jsonb(v_caja);
end;
$function$

CREATE OR REPLACE FUNCTION public.crear_sucursal_v1(p_nombre text, p_direccion text DEFAULT NULL::text, p_telefono text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_negocio_id uuid;
    v_sucursal public.sucursales;
    v_caja public.cajas;
begin
    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin']
    ) then
        raise exception 'No tenés permiso para crear sucursales';
    end if;

    if length(trim(coalesce(p_nombre,''))) < 2 then
        raise exception 'Ingresá un nombre válido';
    end if;

    if exists (
        select 1
        from public.sucursales s
        where s.negocio_id = v_negocio_id
          and lower(s.nombre) = lower(trim(p_nombre))
    ) then
        raise exception 'Ya existe una sucursal con ese nombre';
    end if;

    insert into public.sucursales(
        negocio_id,nombre,direccion,telefono,activa
    )
    values(
        v_negocio_id,
        trim(p_nombre),
        nullif(trim(coalesce(p_direccion,'')),''),
        nullif(trim(coalesce(p_telefono,'')),''),
        true
    )
    returning * into v_sucursal;

    insert into public.cajas(
        negocio_id,sucursal_id,nombre,activa
    )
    values(
        v_negocio_id,v_sucursal.id,'Caja 1',true
    )
    returning * into v_caja;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,auth.uid(),'sucursal_creada','sucursales',
        v_sucursal.id,
        jsonb_build_object('nombre',v_sucursal.nombre)
    );

    return jsonb_build_object(
        'sucursal', to_jsonb(v_sucursal),
        'caja', to_jsonb(v_caja)
    );
end;
$function$

CREATE OR REPLACE FUNCTION public.diagnostico_integridad_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_negocio_id uuid;
    v_count bigint;
    v_issues jsonb := '[]'::jsonb;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin']
    ) then
        raise exception 'Solo Propietario o Administrador pueden ejecutar el diagnóstico';
    end if;

    -- Stock negativo.
    select count(*)
      into v_count
      from public.producto_stock_sucursal ps
     where ps.negocio_id = v_negocio_id
       and ps.stock < 0;

    if v_count > 0 then
        v_issues := v_issues || jsonb_build_array(
            jsonb_build_object(
                'severity','critical',
                'title','Stock negativo',
                'detail','Hay filas de stock por debajo de cero.',
                'count',v_count
            )
        );
    end if;

    -- Stock actual vs último movimiento auditado.
    select count(*)
      into v_count
      from public.producto_stock_sucursal ps
      join lateral (
          select m.stock_resultante
            from public.movimientos m
           where m.negocio_id = ps.negocio_id
             and m.sucursal_id = ps.sucursal_id
             and m.producto_id = ps.producto_id
             and m.stock_resultante is not null
           order by m.creado desc, m.id desc
           limit 1
      ) lm on true
     where ps.negocio_id = v_negocio_id
       and ps.stock <> lm.stock_resultante;

    if v_count > 0 then
        v_issues := v_issues || jsonb_build_array(
            jsonb_build_object(
                'severity','warning',
                'title','Stock vs movimientos',
                'detail','El stock actual no coincide con el último movimiento registrado. Puede indicar datos legacy o una modificación sin auditoría.',
                'count',v_count
            )
        );
    end if;

    -- Códigos de barras duplicados dentro del negocio.
    select count(*)
      into v_count
      from (
          select p.codigo_barras
            from public.productos p
           where p.negocio_id = v_negocio_id
             and nullif(trim(coalesce(p.codigo_barras,'')),'') is not null
           group by p.codigo_barras
          having count(*) > 1
      ) d;

    if v_count > 0 then
        v_issues := v_issues || jsonb_build_array(
            jsonb_build_object(
                'severity','critical',
                'title','Códigos de barras duplicados',
                'detail','Más de un producto del mismo negocio comparte el mismo código.',
                'count',v_count
            )
        );
    end if;

    -- Más de una sesión abierta por caja.
    select count(*)
      into v_count
      from (
          select cs.caja_id
            from public.cajas_sesiones cs
           where cs.negocio_id = v_negocio_id
             and cs.estado = 'abierta'
           group by cs.caja_id
          having count(*) > 1
      ) c;

    if v_count > 0 then
        v_issues := v_issues || jsonb_build_array(
            jsonb_build_object(
                'severity','critical',
                'title','Caja con múltiples sesiones',
                'detail','Una caja tiene más de un turno abierto simultáneamente.',
                'count',v_count
            )
        );
    end if;

    -- Ventas cuyo cobro no coincide con el total.
    select count(*)
      into v_count
      from public.ventas v
      left join (
          select
              vp.venta_id,
              sum(vp.monto) filter (where vp.operacion = 'cobro') as cobrado
          from public.venta_pagos vp
          where vp.negocio_id = v_negocio_id
          group by vp.venta_id
      ) p on p.venta_id = v.id
     where v.negocio_id = v_negocio_id
       and abs(coalesce(p.cobrado,0) - coalesce(v.total,0)) > 0.01;

    if v_count > 0 then
        v_issues := v_issues || jsonb_build_array(
            jsonb_build_object(
                'severity','critical',
                'title','Cobros inconsistentes',
                'detail','Hay ventas cuyo total no coincide con la suma de cobros registrados.',
                'count',v_count
            )
        );
    end if;

    -- Categorías legacy sin negocio.
    if to_regclass('public.categorias') is not null then
        select count(*)
          into v_count
          from public.categorias c
         where c.negocio_id is null;

        if v_count > 0 then
            v_issues := v_issues || jsonb_build_array(
                jsonb_build_object(
                    'severity','warning',
                    'title','Categorías legacy',
                    'detail','Existen categorías que todavía no están asociadas a un negocio.',
                    'count',v_count
                )
            );
        end if;
    end if;

    return jsonb_build_object(
        'ok',
        not exists (
            select 1
            from jsonb_array_elements(v_issues) x
            where x->>'severity' = 'critical'
        ),
        'issues',v_issues,
        'checked_at',now()
    );
end;
$function$

CREATE OR REPLACE FUNCTION public.estado_pin_descuento_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_negocio_id uuid;
    v_rol text;
    v_configurado boolean := false;
    v_total integer := 0;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    select
        nm.rol,
        nm.pin_descuento_hash is not null
      into
        v_rol,
        v_configurado
      from public.negocio_miembros nm
     where nm.negocio_id = v_negocio_id
       and nm.user_id = auth.uid()
       and nm.activo = true
     limit 1;

    select count(*)
      into v_total
      from public.negocio_miembros nm
     where nm.negocio_id = v_negocio_id
       and nm.activo = true
       and nm.rol in ('owner','admin')
       and nm.pin_descuento_hash is not null;

    return jsonb_build_object(
        'rol', v_rol,
        'puede_configurar', coalesce(v_rol,'') in ('owner','admin'),
        'configurado', coalesce(v_configurado,false),
        'autorizadores_configurados', v_total
    );
end;
$function$

CREATE OR REPLACE FUNCTION public.listar_equipo_v3()
 RETURNS TABLE(membership_id uuid, user_id uuid, email text, username text, nombre text, rol text, activo boolean, debe_cambiar_password boolean, creado timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
    v_negocio_id uuid;
begin
    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(v_negocio_id, array['owner','admin']) then
        raise exception 'No tenés permiso para administrar el equipo';
    end if;

    return query
    select
        nm.id,
        nm.user_id,
        u.email::text,
        e.username,
        coalesce(e.nombre, split_part(u.email,'@',1))::text,
        nm.rol,
        nm.activo,
        coalesce(e.debe_cambiar_password,false),
        nm.creado
    from public.negocio_miembros nm
    join auth.users u on u.id = nm.user_id
    left join public.empleados e
      on e.user_id = nm.user_id
     and e.negocio_id = nm.negocio_id
    where nm.negocio_id = v_negocio_id
    order by
      case nm.rol
        when 'owner' then 1
        when 'admin' then 2
        when 'manager' then 3
        else 4
      end,
      nm.creado;
end;
$function$

CREATE OR REPLACE FUNCTION public.listar_sucursales_admin_v1()
 RETURNS TABLE(id uuid, nombre text, direccion text, telefono text, activa boolean, stock_total bigint, cajas jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_negocio_id uuid;
begin
    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para consultar sucursales';
    end if;

    return query
    select
        s.id,
        s.nombre,
        s.direccion,
        s.telefono,
        s.activa,
        coalesce(sum(ps.stock),0)::bigint,
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'id', c.id,
                        'nombre', c.nombre,
                        'activa', c.activa
                    )
                    order by c.creado
                )
                from public.cajas c
                where c.sucursal_id = s.id
                  and c.negocio_id = v_negocio_id
            ),
            '[]'::jsonb
        )
    from public.sucursales s
    left join public.producto_stock_sucursal ps
      on ps.sucursal_id = s.id
    where s.negocio_id = v_negocio_id
    group by s.id
    order by
      case when lower(s.nombre) = 'principal' then 0 else 1 end,
      s.nombre;
end;
$function$

CREATE OR REPLACE FUNCTION public.obtener_negocio_admin_actual()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_negocio public.negocios;
begin
    select n.*
      into v_negocio
      from public.negocios n
      join public.negocio_miembros nm on nm.negocio_id = n.id
     where nm.user_id = auth.uid()
       and nm.activo = true
       and nm.rol in ('owner','admin')
     order by case nm.rol when 'owner' then 1 else 2 end
     limit 1;

    if not found then
        raise exception 'No autorizado';
    end if;

    return jsonb_build_object(
        'id', v_negocio.id,
        'nombre', v_negocio.nombre,
        'codigo_acceso', v_negocio.codigo_acceso
    );
end;
$function$

CREATE OR REPLACE FUNCTION public.obtener_perfil_empleado_actual()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_emp public.empleados;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    select *
      into v_emp
      from public.empleados
     where user_id = auth.uid()
       and activo = true
     limit 1;

    if not found then
        return null;
    end if;

    return jsonb_build_object(
        'id', v_emp.id,
        'username', v_emp.username,
        'nombre', v_emp.nombre,
        'debe_cambiar_password', v_emp.debe_cambiar_password,
        'activo', v_emp.activo
    );
end;
$function$

