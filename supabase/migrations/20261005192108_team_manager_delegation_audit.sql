-- VEN-015 — Team Manager Delegation + Audit
-- Incremental policy change captured from disposable Vendify Staging.
-- Production is intentionally untouched.

create or replace function public.obtener_contexto_app()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
    v_user_id uuid;
    v_miembro public.negocio_miembros;
    v_negocio public.negocios;
    v_sucursal public.sucursales;
    v_caja public.cajas;
begin
    v_user_id := auth.uid();

    if v_user_id is null then
        raise exception 'Sesión requerida';
    end if;

    select nm.*
      into v_miembro
      from public.negocio_miembros nm
     where nm.user_id = v_user_id
       and nm.activo = true
     order by
       case nm.rol
         when 'owner' then 1
         when 'admin' then 2
         when 'manager' then 3
         when 'cashier' then 4
         else 5
       end,
       nm.creado
     limit 1;

    if not found then
        raise exception 'El usuario no pertenece a ningún negocio activo';
    end if;

    select *
      into v_negocio
      from public.negocios
     where id = v_miembro.negocio_id
       and activo = true;

    if not found then
        raise exception 'Negocio inexistente o inactivo';
    end if;

    select *
      into v_sucursal
      from public.sucursales
     where negocio_id = v_negocio.id
       and activa = true
     order by
       case when nombre = 'Principal' then 0 else 1 end,
       creado
     limit 1;

    if not found then
        raise exception 'El negocio no tiene una sucursal activa';
    end if;

    select *
      into v_caja
      from public.cajas
     where negocio_id = v_negocio.id
       and sucursal_id = v_sucursal.id
       and activa = true
     order by
       case when nombre = 'Caja 1' then 0 else 1 end,
       creado
     limit 1;

    if not found then
        raise exception 'La sucursal no tiene una caja activa';
    end if;

    return jsonb_build_object(
        'user', jsonb_build_object(
            'id', v_user_id
        ),
        'business', jsonb_build_object(
            'id', v_negocio.id,
            'nombre', v_negocio.nombre,
            'plan', v_negocio.plan,
            'activo', v_negocio.activo
        ),
        'membership', jsonb_build_object(
            'id', v_miembro.id,
            'role', v_miembro.rol,
            'activo', v_miembro.activo
        ),
        'branch', jsonb_build_object(
            'id', v_sucursal.id,
            'nombre', v_sucursal.nombre
        ),
        'cashRegister', jsonb_build_object(
            'id', v_caja.id,
            'nombre', v_caja.nombre
        ),
        'permissions',
        case v_miembro.rol
            when 'owner' then jsonb_build_object(
                'sell', true,
                'viewProducts', true,
                'manageProducts', true,
                'adjustStock', true,
                'viewCosts', true,
                'viewProfit', true,
                'viewReports', true,
                'manageEmployees', true,
                'manageBusiness', true
            )
            when 'admin' then jsonb_build_object(
                'sell', true,
                'viewProducts', true,
                'manageProducts', true,
                'adjustStock', true,
                'viewCosts', true,
                'viewProfit', true,
                'viewReports', true,
                'manageEmployees', true,
                'manageBusiness', true
            )
            when 'manager' then jsonb_build_object(
                'sell', true,
                'viewProducts', true,
                'manageProducts', true,
                'adjustStock', true,
                'viewCosts', true,
                'viewProfit', true,
                'viewReports', true,
                'manageEmployees', true,
                'manageBusiness', false
            )
            else jsonb_build_object(
                'sell', true,
                'viewProducts', true,
                'manageProducts', false,
                'adjustStock', false,
                'viewCosts', false,
                'viewProfit', false,
                'viewReports', false,
                'manageEmployees', false,
                'manageBusiness', false
            )
        end
    );
end;
$function$;

create or replace function public.obtener_negocio_admin_actual()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
    v_negocio public.negocios;
begin
    select n.*
      into v_negocio
      from public.negocios n
      join public.negocio_miembros nm on nm.negocio_id = n.id
     where nm.user_id = auth.uid()
       and nm.activo = true
       and nm.rol in ('owner','admin','manager')
     order by
       case nm.rol
         when 'owner' then 1
         when 'admin' then 2
         when 'manager' then 3
         else 4
       end
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
$function$;

create or replace function public.listar_equipo_v3()
returns table(
    membership_id uuid,
    user_id uuid,
    email text,
    username text,
    nombre text,
    rol text,
    activo boolean,
    debe_cambiar_password boolean,
    creado timestamp with time zone
)
language plpgsql
stable
security definer
set search_path = public, auth
as $function$
declare
    v_negocio_id uuid;
begin
    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(v_negocio_id, array['owner','admin','manager']) then
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
$function$;

create or replace function public.actualizar_rol_miembro_v2(
    p_membership_id uuid,
    p_rol text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_negocio_id uuid;
    v_actor public.negocio_miembros;
    v_target public.negocio_miembros;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    select *
      into v_actor
      from public.negocio_miembros nm
     where nm.negocio_id = v_negocio_id
       and nm.user_id = auth.uid()
       and nm.activo = true
       and nm.rol in ('owner','admin','manager')
     order by
       case nm.rol when 'owner' then 1 when 'admin' then 2 else 3 end
     limit 1;

    if not found then
        raise exception 'No tenés permiso para cambiar roles';
    end if;

    if p_rol not in ('admin','manager','cashier') then
        raise exception 'Rol inválido';
    end if;

    select *
      into v_target
      from public.negocio_miembros nm
     where nm.id = p_membership_id
       and nm.negocio_id = v_negocio_id
     for update;

    if not found then
        raise exception 'Miembro inexistente';
    end if;

    if v_target.rol = 'owner' then
        raise exception 'El propietario no puede cambiarse desde Equipo';
    end if;

    if v_target.user_id = auth.uid() then
        raise exception 'No podés cambiar tu propio rol';
    end if;

    if v_actor.rol = 'manager' then
        if v_target.rol not in ('manager','cashier') then
            raise exception 'Un encargado no puede modificar administradores';
        end if;
        if p_rol not in ('manager','cashier') then
            raise exception 'Un encargado no puede asignar el rol administrador';
        end if;
    end if;

    update public.negocio_miembros
       set rol = p_rol
     where id = p_membership_id;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'rol_actualizado',
        'negocio_miembros',
        p_membership_id,
        jsonb_build_object(
            'actor_role', v_actor.rol,
            'target_user_id', v_target.user_id,
            'rol_anterior', v_target.rol,
            'rol_nuevo', p_rol
        )
    );

    return jsonb_build_object('ok',true,'rol',p_rol);
end;
$function$;

create or replace function public.cambiar_estado_miembro_v3(
    p_membership_id uuid,
    p_activo boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_negocio_id uuid;
    v_actor public.negocio_miembros;
    v_target public.negocio_miembros;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    select *
      into v_actor
      from public.negocio_miembros nm
     where nm.negocio_id = v_negocio_id
       and nm.user_id = auth.uid()
       and nm.activo = true
       and nm.rol in ('owner','admin','manager')
     order by
       case nm.rol when 'owner' then 1 when 'admin' then 2 else 3 end
     limit 1;

    if not found then
        raise exception 'No tenés permiso para cambiar el estado de empleados';
    end if;

    select *
      into v_target
      from public.negocio_miembros nm
     where nm.id = p_membership_id
       and nm.negocio_id = v_negocio_id
     for update;

    if not found then
        raise exception 'Miembro inexistente';
    end if;

    if v_target.rol = 'owner' then
        raise exception 'El propietario no puede desactivarse';
    end if;

    if v_target.user_id = auth.uid() then
        raise exception 'No podés cambiar el estado de tu propio usuario';
    end if;

    if v_actor.rol = 'manager' and v_target.rol not in ('manager','cashier') then
        raise exception 'Un encargado no puede modificar administradores';
    end if;

    update public.negocio_miembros
       set activo = p_activo
     where id = p_membership_id;

    update public.empleados
       set activo = p_activo,
           actualizado = now()
     where negocio_id = v_negocio_id
       and user_id = v_target.user_id;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'estado_empleado_actualizado',
        'negocio_miembros',
        v_target.id,
        jsonb_build_object(
            'actor_role', v_actor.rol,
            'target_user_id', v_target.user_id,
            'target_role', v_target.rol,
            'activo_anterior', v_target.activo,
            'activo_nuevo', p_activo
        )
    );

    return jsonb_build_object('ok',true,'activo',p_activo);
end;
$function$;

create or replace function public.listar_permisos_stock_equipo_v1()
returns table (
    membership_id uuid,
    puede_gestionar_stock boolean
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
    v_negocio_id uuid;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para ver permisos del equipo';
    end if;

    return query
    select
        nm.id,
        case
          when nm.rol = 'owner' then true
          else coalesce(nm.puede_gestionar_stock,false)
        end
    from public.negocio_miembros nm
    where nm.negocio_id = v_negocio_id
    order by nm.creado;
end;
$function$;

create or replace function public.actualizar_permiso_stock_miembro_v1(
    p_membership_id uuid,
    p_permitir boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_negocio_id uuid;
    v_target public.negocio_miembros;
    v_anterior boolean;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(v_negocio_id, array['owner']) then
        raise exception 'Solo el propietario puede cambiar permisos de stock';
    end if;

    select *
      into v_target
      from public.negocio_miembros nm
     where nm.id = p_membership_id
       and nm.negocio_id = v_negocio_id
     for update;

    if v_target.id is null then
        raise exception 'Empleado inexistente';
    end if;

    if v_target.rol = 'owner' then
        raise exception 'El permiso del propietario no puede desactivarse';
    end if;

    v_anterior := coalesce(v_target.puede_gestionar_stock,false);

    update public.negocio_miembros
       set puede_gestionar_stock = coalesce(p_permitir,false)
     where id = v_target.id;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'permiso_stock_actualizado',
        'negocio_miembros',
        v_target.id,
        jsonb_build_object(
            'actor_role','owner',
            'target_user_id',v_target.user_id,
            'target_role',v_target.rol,
            'permitido_anterior',v_anterior,
            'permitido_nuevo',coalesce(p_permitir,false)
        )
    );

    return jsonb_build_object(
        'ok',true,
        'membership_id',v_target.id,
        'puede_gestionar_stock',coalesce(p_permitir,false)
    );
end;
$function$;

revoke all on function public.obtener_contexto_app() from public, anon;
grant execute on function public.obtener_contexto_app() to authenticated, service_role;
revoke all on function public.obtener_negocio_admin_actual() from public, anon;
grant execute on function public.obtener_negocio_admin_actual() to authenticated, service_role;
revoke all on function public.listar_equipo_v3() from public, anon;
grant execute on function public.listar_equipo_v3() to authenticated, service_role;
revoke all on function public.actualizar_rol_miembro_v2(uuid,text) from public, anon;
grant execute on function public.actualizar_rol_miembro_v2(uuid,text) to authenticated, service_role;
revoke all on function public.cambiar_estado_miembro_v3(uuid,boolean) from public, anon;
grant execute on function public.cambiar_estado_miembro_v3(uuid,boolean) to authenticated, service_role;
revoke all on function public.listar_permisos_stock_equipo_v1() from public, anon;
grant execute on function public.listar_permisos_stock_equipo_v1() to authenticated, service_role;
revoke all on function public.actualizar_permiso_stock_miembro_v1(uuid,boolean) from public, anon;
grant execute on function public.actualizar_permiso_stock_miembro_v1(uuid,boolean) to authenticated, service_role;
