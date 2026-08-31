-- ============================================================
-- Vendify v2.30 — Compras y proveedores
--
-- Requiere:
-- - multisucursal
-- - inventario profesional
--
-- Incluye:
-- - proveedores
-- - compras y detalle
-- - historial de costos
-- - recepción de mercadería -> incrementa stock
-- - actualización del último costo
-- - corrección física por scanner para ventas con stock desfasado
-- ============================================================

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- 1. PROVEEDORES
-- ============================================================

create table if not exists public.proveedores (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,

    nombre text not null,
    cuit text,
    contacto text,
    telefono text,
    email text,
    direccion text,
    notas text,

    activo boolean not null default true,
    creado timestamptz not null default now(),
    actualizado timestamptz not null default now()
);

create unique index if not exists proveedores_nombre_negocio_uidx
    on public.proveedores(negocio_id, lower(nombre))
    where activo = true;

create index if not exists proveedores_negocio_idx
    on public.proveedores(negocio_id, activo, nombre);

alter table public.proveedores enable row level security;

drop policy if exists "proveedores_select_miembros" on public.proveedores;

create policy "proveedores_select_miembros"
on public.proveedores
for select
using (public.es_miembro_negocio(negocio_id));

-- ============================================================
-- 2. COMPRAS
-- ============================================================

create table if not exists public.compras (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete restrict,
    proveedor_id uuid not null references public.proveedores(id) on delete restrict,
    user_id uuid not null references auth.users(id) on delete restrict,

    numero_comprobante text,
    nota text,

    estado text not null default 'borrador'
        check (estado in ('borrador','recibida','anulada')),

    total numeric(14,2) not null default 0 check (total >= 0),

    recibida_en timestamptz,
    recibida_por uuid references auth.users(id) on delete set null,

    creado timestamptz not null default now(),
    actualizado timestamptz not null default now()
);

create index if not exists compras_negocio_sucursal_fecha_idx
    on public.compras(negocio_id, sucursal_id, creado desc);

create index if not exists compras_proveedor_idx
    on public.compras(proveedor_id, creado desc);

alter table public.compras enable row level security;

drop policy if exists "compras_select_miembros" on public.compras;

create policy "compras_select_miembros"
on public.compras
for select
using (public.es_miembro_negocio(negocio_id));

create table if not exists public.compra_items (
    id uuid primary key default gen_random_uuid(),
    compra_id uuid not null references public.compras(id) on delete cascade,
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    producto_id uuid not null references public.productos(id) on delete restrict,

    producto_nombre text not null,
    cantidad integer not null check (cantidad > 0),
    costo_unitario numeric(14,2) not null check (costo_unitario >= 0),
    subtotal numeric(14,2) not null check (subtotal >= 0),

    creado timestamptz not null default now(),

    unique(compra_id, producto_id)
);

create index if not exists compra_items_producto_idx
    on public.compra_items(producto_id, creado desc);

alter table public.compra_items enable row level security;

drop policy if exists "compra_items_select_miembros" on public.compra_items;

create policy "compra_items_select_miembros"
on public.compra_items
for select
using (public.es_miembro_negocio(negocio_id));

-- ============================================================
-- 3. HISTORIAL DE COSTOS
-- ============================================================

create table if not exists public.producto_costos_historial (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete restrict,
    producto_id uuid not null references public.productos(id) on delete cascade,
    proveedor_id uuid references public.proveedores(id) on delete set null,
    compra_id uuid references public.compras(id) on delete set null,

    costo_anterior numeric(14,2) not null default 0,
    costo_nuevo numeric(14,2) not null default 0,

    user_id uuid references auth.users(id) on delete set null,
    creado timestamptz not null default now()
);

create index if not exists producto_costos_historial_producto_idx
    on public.producto_costos_historial(producto_id, creado desc);

alter table public.producto_costos_historial enable row level security;

drop policy if exists "costos_historial_select_supervisores"
    on public.producto_costos_historial;

create policy "costos_historial_select_supervisores"
on public.producto_costos_historial
for select
using (
    public.es_miembro_negocio(negocio_id)
    and public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

-- ============================================================
-- 4. MOVIMIENTOS: agregar tipo compra si falta
-- ============================================================

do $$
declare
    v_tipos text;
begin
    select string_agg(quote_literal(tipo), ', ' order by tipo)
      into v_tipos
      from (
          select distinct tipo::text
          from public.movimientos
          where tipo is not null

          union select 'venta'
          union select 'ingreso'
          union select 'ajuste'
          union select 'rotura'
          union select 'vencimiento'
          union select 'perdida'
          union select 'inventario'
          union select 'transferencia_salida'
          union select 'transferencia_entrada'
          union select 'devolucion'
          union select 'compra'
      ) t;

    alter table public.movimientos
        drop constraint if exists movimientos_tipo_check;

    execute format(
        'alter table public.movimientos
         add constraint movimientos_tipo_check
         check (tipo in (%s))',
        v_tipos
    );
end $$;

-- ============================================================
-- 5. PROVEEDORES RPC
-- ============================================================

create or replace function public.listar_proveedores_v1()
returns table (
    id uuid,
    nombre text,
    cuit text,
    contacto text,
    telefono text,
    email text,
    direccion text,
    notas text,
    activo boolean,
    compras_recibidas bigint,
    total_comprado numeric,
    ultima_compra timestamptz
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

    return query
    select
        p.id,
        p.nombre,
        p.cuit,
        p.contacto,
        p.telefono,
        p.email,
        p.direccion,
        p.notas,
        p.activo,
        count(c.id) filter (where c.estado = 'recibida')::bigint,
        coalesce(
            sum(c.total) filter (where c.estado = 'recibida'),
            0
        )::numeric,
        max(c.recibida_en) filter (where c.estado = 'recibida')
    from public.proveedores p
    left join public.compras c
      on c.proveedor_id = p.id
     and c.negocio_id = p.negocio_id
    where p.negocio_id = v_negocio_id
    group by p.id
    order by p.activo desc, p.nombre;
end;
$$;

revoke all on function public.listar_proveedores_v1() from public;
grant execute on function public.listar_proveedores_v1() to authenticated;

create or replace function public.guardar_proveedor_v1(
    p_id uuid,
    p_nombre text,
    p_cuit text default null,
    p_contacto text default null,
    p_telefono text default null,
    p_email text default null,
    p_direccion text default null,
    p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_id uuid;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para administrar proveedores';
    end if;

    if nullif(trim(coalesce(p_nombre,'')),'') is null then
        return jsonb_build_object('ok',false,'message','El nombre es obligatorio');
    end if;

    if p_id is null then
        insert into public.proveedores(
            negocio_id,nombre,cuit,contacto,telefono,email,direccion,notas
        )
        values(
            v_negocio_id,
            trim(p_nombre),
            nullif(trim(coalesce(p_cuit,'')),''),
            nullif(trim(coalesce(p_contacto,'')),''),
            nullif(trim(coalesce(p_telefono,'')),''),
            nullif(trim(coalesce(p_email,'')),''),
            nullif(trim(coalesce(p_direccion,'')),''),
            nullif(trim(coalesce(p_notas,'')),'')
        )
        returning id into v_id;
    else
        update public.proveedores
           set nombre = trim(p_nombre),
               cuit = nullif(trim(coalesce(p_cuit,'')),''),
               contacto = nullif(trim(coalesce(p_contacto,'')),''),
               telefono = nullif(trim(coalesce(p_telefono,'')),''),
               email = nullif(trim(coalesce(p_email,'')),''),
               direccion = nullif(trim(coalesce(p_direccion,'')),''),
               notas = nullif(trim(coalesce(p_notas,'')),''),
               actualizado = now()
         where id = p_id
           and negocio_id = v_negocio_id
        returning id into v_id;

        if v_id is null then
            raise exception 'Proveedor inexistente';
        end if;
    end if;

    return jsonb_build_object('ok',true,'proveedor_id',v_id);
exception
    when unique_violation then
        return jsonb_build_object(
            'ok',false,
            'message','Ya existe un proveedor activo con ese nombre'
        );
end;
$$;

revoke all on function public.guardar_proveedor_v1(uuid,text,text,text,text,text,text,text) from public;
grant execute on function public.guardar_proveedor_v1(uuid,text,text,text,text,text,text,text) to authenticated;

-- ============================================================
-- 6. COMPRAS RPC
-- ============================================================

create or replace function public.listar_compras_v1(
    p_sucursal_id uuid,
    p_limit integer default 150
)
returns table (
    id uuid,
    sucursal_id uuid,
    proveedor_id uuid,
    proveedor_nombre text,
    numero_comprobante text,
    nota text,
    estado text,
    total numeric,
    items_count bigint,
    recibida_en timestamptz,
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

    return query
    select
        c.id,
        c.sucursal_id,
        c.proveedor_id,
        p.nombre,
        c.numero_comprobante,
        c.nota,
        c.estado,
        c.total,
        count(ci.id)::bigint,
        c.recibida_en,
        c.creado
    from public.compras c
    join public.proveedores p on p.id = c.proveedor_id
    left join public.compra_items ci on ci.compra_id = c.id
    where c.negocio_id = v_negocio_id
      and c.sucursal_id = p_sucursal_id
    group by c.id, p.nombre
    order by c.creado desc
    limit greatest(1, least(coalesce(p_limit,150),500));
end;
$$;

revoke all on function public.listar_compras_v1(uuid,integer) from public;
grant execute on function public.listar_compras_v1(uuid,integer) to authenticated;

create or replace function public.obtener_compra_v1(
    p_compra_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_compra jsonb;
    v_items jsonb;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    select to_jsonb(c)
      into v_compra
      from public.compras c
     where c.id = p_compra_id
       and c.negocio_id = v_negocio_id;

    if v_compra is null then
        raise exception 'Compra inexistente';
    end if;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'id',ci.id,
                'producto_id',ci.producto_id,
                'producto_nombre',ci.producto_nombre,
                'cantidad',ci.cantidad,
                'costo_unitario',ci.costo_unitario,
                'subtotal',ci.subtotal
            )
            order by ci.creado, ci.id
        ),
        '[]'::jsonb
    )
      into v_items
      from public.compra_items ci
     where ci.compra_id = p_compra_id
       and ci.negocio_id = v_negocio_id;

    return jsonb_build_object(
        'compra',v_compra,
        'items',v_items
    );
end;
$$;

revoke all on function public.obtener_compra_v1(uuid) from public;
grant execute on function public.obtener_compra_v1(uuid) to authenticated;

create or replace function public.guardar_compra_borrador_v1(
    p_compra_id uuid,
    p_sucursal_id uuid,
    p_proveedor_id uuid,
    p_numero_comprobante text,
    p_nota text,
    p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_compra_id uuid;
    v_estado text;
    v_item record;
    v_producto public.productos;
    v_total numeric(14,2) := 0;
    v_qty integer;
    v_cost numeric(14,2);
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para registrar compras';
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

    if not exists (
        select 1
        from public.proveedores p
        where p.id = p_proveedor_id
          and p.negocio_id = v_negocio_id
          and p.activo = true
    ) then
        raise exception 'Proveedor inválido';
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then
        return jsonb_build_object(
            'ok',false,
            'message','Agregá al menos un producto'
        );
    end if;

    if p_compra_id is null then
        insert into public.compras(
            negocio_id,sucursal_id,proveedor_id,user_id,
            numero_comprobante,nota,estado,total
        )
        values(
            v_negocio_id,p_sucursal_id,p_proveedor_id,auth.uid(),
            nullif(trim(coalesce(p_numero_comprobante,'')),''),
            nullif(trim(coalesce(p_nota,'')),''),
            'borrador',0
        )
        returning id into v_compra_id;
    else
        select c.estado
          into v_estado
          from public.compras c
         where c.id = p_compra_id
           and c.negocio_id = v_negocio_id
         for update;

        if v_estado is null then
            raise exception 'Compra inexistente';
        end if;

        if v_estado <> 'borrador' then
            raise exception 'Solo se pueden modificar compras en borrador';
        end if;

        v_compra_id := p_compra_id;

        update public.compras
           set sucursal_id = p_sucursal_id,
               proveedor_id = p_proveedor_id,
               numero_comprobante = nullif(trim(coalesce(p_numero_comprobante,'')),''),
               nota = nullif(trim(coalesce(p_nota,'')),''),
               actualizado = now()
         where id = v_compra_id;

        delete from public.compra_items
         where compra_id = v_compra_id;
    end if;

    for v_item in
        select
            (x->>'producto_id')::uuid as producto_id,
            (x->>'cantidad')::integer as cantidad,
            (x->>'costo_unitario')::numeric as costo_unitario
        from jsonb_array_elements(p_items) x
    loop
        v_qty := v_item.cantidad;
        v_cost := round(v_item.costo_unitario,2);

        if v_qty is null or v_qty <= 0 then
            raise exception 'Cantidad inválida en la compra';
        end if;

        if v_cost is null or v_cost < 0 then
            raise exception 'Costo inválido en la compra';
        end if;

        select *
          into v_producto
          from public.productos p
         where p.id = v_item.producto_id
           and p.negocio_id = v_negocio_id;

        if not found then
            raise exception 'Producto inválido en la compra';
        end if;

        insert into public.compra_items(
            compra_id,negocio_id,producto_id,producto_nombre,
            cantidad,costo_unitario,subtotal
        )
        values(
            v_compra_id,
            v_negocio_id,
            v_producto.id,
            v_producto.nombre,
            v_qty,
            v_cost,
            round(v_qty * v_cost,2)
        );

        v_total := v_total + round(v_qty * v_cost,2);
    end loop;

    update public.compras
       set total = round(v_total,2),
           actualizado = now()
     where id = v_compra_id;

    return jsonb_build_object(
        'ok',true,
        'compra_id',v_compra_id,
        'total',round(v_total,2)
    );
end;
$$;

revoke all on function public.guardar_compra_borrador_v1(uuid,uuid,uuid,text,text,jsonb) from public;
grant execute on function public.guardar_compra_borrador_v1(uuid,uuid,uuid,text,text,jsonb) to authenticated;

create or replace function public.recibir_compra_v1(
    p_compra_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_compra public.compras;
    v_item public.compra_items;
    v_producto public.productos;
    v_stock public.producto_stock_sucursal;
    v_anterior integer;
    v_nuevo integer;
    v_costo_anterior numeric(14,2);
    v_unidades integer := 0;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para recibir compras';
    end if;

    select *
      into v_compra
      from public.compras c
     where c.id = p_compra_id
       and c.negocio_id = v_negocio_id
     for update;

    if v_compra.id is null then
        raise exception 'Compra inexistente';
    end if;

    if v_compra.estado <> 'borrador' then
        raise exception 'La compra ya fue procesada';
    end if;

    if not exists (
        select 1 from public.compra_items ci
        where ci.compra_id = v_compra.id
    ) then
        raise exception 'La compra no tiene productos';
    end if;

    for v_item in
        select *
        from public.compra_items ci
        where ci.compra_id = v_compra.id
        order by ci.producto_id
    loop
        select *
          into v_producto
          from public.productos p
         where p.id = v_item.producto_id
           and p.negocio_id = v_negocio_id
         for update;

        if v_producto.id is null then
            raise exception 'Producto inexistente al recibir compra';
        end if;

        select *
          into v_stock
          from public.producto_stock_sucursal ps
         where ps.negocio_id = v_negocio_id
           and ps.sucursal_id = v_compra.sucursal_id
           and ps.producto_id = v_producto.id
         for update;

        if v_stock.id is null then
            insert into public.producto_stock_sucursal(
                negocio_id,sucursal_id,producto_id,stock,stock_minimo
            )
            values(
                v_negocio_id,
                v_compra.sucursal_id,
                v_producto.id,
                0,
                greatest(coalesce(v_producto.stock_minimo,0),0)
            )
            returning * into v_stock;
        end if;

        v_anterior := v_stock.stock;
        v_nuevo := v_anterior + v_item.cantidad;
        v_costo_anterior := coalesce(v_producto.precio_compra,0);

        update public.producto_stock_sucursal
           set stock = v_nuevo,
               actualizado = now()
         where id = v_stock.id;

        update public.productos
           set precio_compra = v_item.costo_unitario,
               actualizado = now()
         where id = v_producto.id;

        insert into public.producto_costos_historial(
            negocio_id,sucursal_id,producto_id,proveedor_id,compra_id,
            costo_anterior,costo_nuevo,user_id
        )
        values(
            v_negocio_id,
            v_compra.sucursal_id,
            v_producto.id,
            v_compra.proveedor_id,
            v_compra.id,
            v_costo_anterior,
            v_item.costo_unitario,
            auth.uid()
        );

        insert into public.movimientos(
            user_id,negocio_id,sucursal_id,producto_id,producto_nombre,
            tipo,delta,stock_resultante,motivo,detalle
        )
        values(
            auth.uid(),
            v_negocio_id,
            v_compra.sucursal_id,
            v_producto.id,
            v_producto.nombre,
            'compra',
            v_item.cantidad,
            v_nuevo,
            'Compra de mercadería',
            jsonb_build_object(
                'compra_id',v_compra.id,
                'proveedor_id',v_compra.proveedor_id,
                'cantidad',v_item.cantidad,
                'costo_unitario',v_item.costo_unitario,
                'costo_anterior',v_costo_anterior
            )
        );

        v_unidades := v_unidades + v_item.cantidad;
    end loop;

    update public.compras
       set estado = 'recibida',
           recibida_en = now(),
           recibida_por = auth.uid(),
           actualizado = now()
     where id = v_compra.id;

    insert into public.audit_log(
        negocio_id,user_id,accion,entidad,entidad_id,detalle
    )
    values(
        v_negocio_id,
        auth.uid(),
        'compra_recibida',
        'compras',
        v_compra.id,
        jsonb_build_object(
            'sucursal_id',v_compra.sucursal_id,
            'proveedor_id',v_compra.proveedor_id,
            'total',v_compra.total,
            'unidades',v_unidades
        )
    );

    return jsonb_build_object(
        'ok',true,
        'compra_id',v_compra.id,
        'unidades_ingresadas',v_unidades,
        'total',v_compra.total
    );
end;
$$;

revoke all on function public.recibir_compra_v1(uuid) from public;
grant execute on function public.recibir_compra_v1(uuid) to authenticated;

create or replace function public.anular_compra_borrador_v1(
    p_compra_id uuid
)
returns jsonb
language plpgsql
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

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para anular compras';
    end if;

    update public.compras
       set estado = 'anulada',
           actualizado = now()
     where id = p_compra_id
       and negocio_id = v_negocio_id
       and estado = 'borrador';

    if not found then
        raise exception 'Solo se pueden anular compras en borrador';
    end if;

    return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.anular_compra_borrador_v1(uuid) from public;
grant execute on function public.anular_compra_borrador_v1(uuid) to authenticated;

-- ============================================================
-- 7. SCANNER COMO EVIDENCIA FÍSICA DE UNA UNIDAD
-- ============================================================

create or replace function public.confirmar_stock_por_scanner_v1(
    p_producto_id uuid,
    p_sucursal_id uuid,
    p_stock_minimo_necesario integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_producto public.productos;
    v_stock public.producto_stock_sucursal;
    v_anterior integer;
    v_nuevo integer;
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

    select *
      into v_producto
      from public.productos p
     where p.id = p_producto_id
       and p.negocio_id = v_negocio_id;

    if v_producto.id is null then
        raise exception 'Producto inexistente';
    end if;

    select *
      into v_stock
      from public.producto_stock_sucursal ps
     where ps.negocio_id = v_negocio_id
       and ps.sucursal_id = p_sucursal_id
       and ps.producto_id = p_producto_id
     for update;

    if v_stock.id is null then
        insert into public.producto_stock_sucursal(
            negocio_id,sucursal_id,producto_id,stock,stock_minimo
        )
        values(
            v_negocio_id,p_sucursal_id,p_producto_id,0,
            greatest(coalesce(v_producto.stock_minimo,0),0)
        )
        returning * into v_stock;
    end if;

    v_anterior := v_stock.stock;

    if p_stock_minimo_necesario is null
       or p_stock_minimo_necesario <= v_anterior then
        return jsonb_build_object(
            'ok',true,
            'stock',v_anterior,
            'ajustado',false
        );
    end if;

    -- Cada lectura física solo puede justificar UNA unidad adicional.
    if p_stock_minimo_necesario > v_anterior + 1 then
        raise exception 'El scanner solo puede confirmar una unidad física por lectura';
    end if;

    v_nuevo := v_anterior + 1;

    update public.producto_stock_sucursal
       set stock = v_nuevo,
           actualizado = now()
     where id = v_stock.id;

    insert into public.movimientos(
        user_id,negocio_id,sucursal_id,producto_id,producto_nombre,
        tipo,delta,stock_resultante,motivo,detalle
    )
    values(
        auth.uid(),
        v_negocio_id,
        p_sucursal_id,
        v_producto.id,
        v_producto.nombre,
        'ajuste',
        1,
        v_nuevo,
        'Corrección automática por escaneo físico',
        jsonb_build_object(
            'origen','scanner_venta',
            'stock_anterior',v_anterior,
            'stock_nuevo',v_nuevo
        )
    );

    return jsonb_build_object(
        'ok',true,
        'stock',v_nuevo,
        'ajustado',true
    );
end;
$$;

revoke all on function public.confirmar_stock_por_scanner_v1(uuid,uuid,integer) from public;
grant execute on function public.confirmar_stock_por_scanner_v1(uuid,uuid,integer) to authenticated;

notify pgrst, 'reload schema';

commit;
