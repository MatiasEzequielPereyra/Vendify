-- ============================================================
-- Ventas Kiosco v2.0
-- Migración 001 — Multiempresa / Roles / Sucursales
-- Compatible con la v1 durante la transición.
--
-- IMPORTANTE:
-- 1) Hacer backup antes de ejecutar.
-- 2) Ejecutar completo en Supabase > SQL Editor.
-- 3) No elimina tablas ni datos existentes.
-- ============================================================

begin;

create extension if not exists "pgcrypto";

-- ============================================================
-- 1. NEGOCIOS
-- ============================================================

create table if not exists public.negocios (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    slug text,
    cuit text,
    telefono text,
    email text,
    direccion text,
    plan text not null default 'starter'
        check (plan in ('starter', 'negocio', 'pro')),
    activo boolean not null default true,
    creado timestamptz not null default now(),
    actualizado timestamptz not null default now()
);

create unique index if not exists negocios_slug_unique_idx
    on public.negocios (lower(slug))
    where slug is not null;

-- ============================================================
-- 2. MIEMBROS DEL NEGOCIO / ROLES
-- ============================================================

create table if not exists public.negocio_miembros (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    rol text not null default 'cashier'
        check (rol in ('owner', 'admin', 'manager', 'cashier')),
    activo boolean not null default true,
    creado timestamptz not null default now(),
    unique (negocio_id, user_id)
);

create index if not exists negocio_miembros_user_idx
    on public.negocio_miembros(user_id);

create index if not exists negocio_miembros_negocio_idx
    on public.negocio_miembros(negocio_id);

-- ============================================================
-- 3. SUCURSALES
-- ============================================================

create table if not exists public.sucursales (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    nombre text not null,
    direccion text,
    telefono text,
    activa boolean not null default true,
    creado timestamptz not null default now(),
    actualizado timestamptz not null default now(),
    unique (negocio_id, nombre)
);

create index if not exists sucursales_negocio_idx
    on public.sucursales(negocio_id);

-- ============================================================
-- 4. CAJAS FÍSICAS
-- ============================================================

create table if not exists public.cajas (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete cascade,
    nombre text not null,
    activa boolean not null default true,
    creado timestamptz not null default now(),
    unique (sucursal_id, nombre)
);

create index if not exists cajas_negocio_idx on public.cajas(negocio_id);
create index if not exists cajas_sucursal_idx on public.cajas(sucursal_id);

-- ============================================================
-- 5. FUNCIONES DE SEGURIDAD
-- SECURITY DEFINER evita recursión de RLS en negocio_miembros.
-- ============================================================

create or replace function public.es_miembro_negocio(p_negocio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.negocio_miembros nm
        where nm.negocio_id = p_negocio_id
          and nm.user_id = auth.uid()
          and nm.activo = true
    );
$$;

create or replace function public.tiene_rol_negocio(
    p_negocio_id uuid,
    p_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.negocio_miembros nm
        where nm.negocio_id = p_negocio_id
          and nm.user_id = auth.uid()
          and nm.activo = true
          and nm.rol = any(p_roles)
    );
$$;

revoke all on function public.es_miembro_negocio(uuid) from public;
grant execute on function public.es_miembro_negocio(uuid) to authenticated;

revoke all on function public.tiene_rol_negocio(uuid, text[]) from public;
grant execute on function public.tiene_rol_negocio(uuid, text[]) to authenticated;

-- ============================================================
-- 6. MIGRAR LOS USUARIOS EXISTENTES A UN NEGOCIO
--
-- Versión robusta: no usa tablas temporales.
-- Crea 1 negocio por cada usuario autenticado que todavía no
-- sea owner de ningún negocio.
-- ============================================================

do $$
declare
    v_user record;
    v_negocio_id uuid;
begin
    for v_user in
        select u.id as user_id, u.email
        from auth.users u
        order by u.created_at
    loop
        -- ¿Ya tiene un negocio como owner?
        select nm.negocio_id
          into v_negocio_id
          from public.negocio_miembros nm
         where nm.user_id = v_user.user_id
           and nm.rol = 'owner'
           and nm.activo = true
         order by nm.creado
         limit 1;

        -- Si no lo tiene, se crea.
        if v_negocio_id is null then
            insert into public.negocios(nombre, email)
            values (
                coalesce(
                    nullif(split_part(coalesce(v_user.email, ''), '@', 1), ''),
                    'Mi negocio'
                ),
                v_user.email
            )
            returning id into v_negocio_id;

            insert into public.negocio_miembros(
                negocio_id,
                user_id,
                rol,
                activo
            )
            values (
                v_negocio_id,
                v_user.user_id,
                'owner',
                true
            )
            on conflict (negocio_id, user_id)
            do update set
                rol = 'owner',
                activo = true;
        end if;
    end loop;
end $$;

-- Una sucursal principal por negocio.
insert into public.sucursales(negocio_id, nombre)
select n.id, 'Principal'
from public.negocios n
where not exists (
    select 1
    from public.sucursales s
    where s.negocio_id = n.id
);

-- Una caja principal por sucursal.
insert into public.cajas(negocio_id, sucursal_id, nombre)
select s.negocio_id, s.id, 'Caja 1'
from public.sucursales s
where not exists (
    select 1
    from public.cajas c
    where c.sucursal_id = s.id
);

-- ============================================================
-- 7. AGREGAR business_id / sucursal_id A TABLAS V1
-- Mantenemos user_id temporalmente para no romper el frontend.
-- ============================================================

alter table public.categorias
    add column if not exists negocio_id uuid references public.negocios(id) on delete cascade;

alter table public.productos
    add column if not exists negocio_id uuid references public.negocios(id) on delete cascade;

alter table public.movimientos
    add column if not exists negocio_id uuid references public.negocios(id) on delete cascade;

alter table public.ventas
    add column if not exists negocio_id uuid references public.negocios(id) on delete cascade;

alter table public.venta_items
    add column if not exists negocio_id uuid references public.negocios(id) on delete cascade;

alter table public.ventas
    add column if not exists sucursal_id uuid references public.sucursales(id) on delete restrict;

alter table public.ventas
    add column if not exists caja_id uuid references public.cajas(id) on delete restrict;

-- Si existe configuracion, también la preparamos.
do $$
begin
    if to_regclass('public.configuracion') is not null then
        execute 'alter table public.configuracion
                 add column if not exists negocio_id uuid references public.negocios(id) on delete cascade';
    end if;
end $$;

-- ============================================================
-- 8. BACKFILL DE DATOS EXISTENTES
-- ============================================================

update public.categorias c
set negocio_id = (
    select nm.negocio_id
    from public.negocio_miembros nm
    where nm.user_id = c.user_id
      and nm.rol = 'owner'
      and nm.activo = true
    order by nm.creado
    limit 1
)
where c.negocio_id is null;

update public.productos p
set negocio_id = (
    select nm.negocio_id
    from public.negocio_miembros nm
    where nm.user_id = p.user_id
      and nm.rol = 'owner'
      and nm.activo = true
    order by nm.creado
    limit 1
)
where p.negocio_id is null;

update public.movimientos mv
set negocio_id = (
    select nm.negocio_id
    from public.negocio_miembros nm
    where nm.user_id = mv.user_id
      and nm.rol = 'owner'
      and nm.activo = true
    order by nm.creado
    limit 1
)
where mv.negocio_id is null;

update public.ventas v
set negocio_id = (
    select nm.negocio_id
    from public.negocio_miembros nm
    where nm.user_id = v.user_id
      and nm.rol = 'owner'
      and nm.activo = true
    order by nm.creado
    limit 1
)
where v.negocio_id is null;

update public.venta_items vi
set negocio_id = (
    select nm.negocio_id
    from public.negocio_miembros nm
    where nm.user_id = vi.user_id
      and nm.rol = 'owner'
      and nm.activo = true
    order by nm.creado
    limit 1
)
where vi.negocio_id is null;

do $$
begin
    if to_regclass('public.configuracion') is not null then
        execute $sql$
            update public.configuracion c
               set negocio_id = (
                   select nm.negocio_id
                   from public.negocio_miembros nm
                   where nm.user_id = c.user_id
                     and nm.rol = 'owner'
                     and nm.activo = true
                   order by nm.creado
                   limit 1
               )
             where c.negocio_id is null
        $sql$;
    end if;
end $$;

-- Asignar sucursal/caja principal a ventas históricas.
update public.ventas v
set sucursal_id = s.id
from public.sucursales s
where s.negocio_id = v.negocio_id
  and s.nombre = 'Principal'
  and v.sucursal_id is null;

update public.ventas v
set caja_id = c.id
from public.cajas c
where c.sucursal_id = v.sucursal_id
  and c.nombre = 'Caja 1'
  and v.caja_id is null;

-- ============================================================
-- 9. ÍNDICES NUEVOS
-- ============================================================

create index if not exists categorias_negocio_idx
    on public.categorias(negocio_id);

create index if not exists productos_negocio_idx
    on public.productos(negocio_id);

create index if not exists movimientos_negocio_idx
    on public.movimientos(negocio_id);

create index if not exists ventas_negocio_idx
    on public.ventas(negocio_id);

create index if not exists ventas_negocio_creado_idx
    on public.ventas(negocio_id, creado desc);

create index if not exists venta_items_negocio_idx
    on public.venta_items(negocio_id);

-- ============================================================
-- 10. CONSTRAINTS DE INTEGRIDAD
-- ============================================================

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'productos_stock_no_negativo'
    ) then
        alter table public.productos
            add constraint productos_stock_no_negativo check (stock >= 0);
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'productos_precio_compra_no_negativo'
    ) then
        alter table public.productos
            add constraint productos_precio_compra_no_negativo check (precio_compra >= 0);
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'productos_precio_venta_no_negativo'
    ) then
        alter table public.productos
            add constraint productos_precio_venta_no_negativo check (precio_venta >= 0);
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'venta_items_cantidad_positiva'
    ) then
        alter table public.venta_items
            add constraint venta_items_cantidad_positiva check (cantidad > 0);
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'ventas_total_no_negativo'
    ) then
        alter table public.ventas
            add constraint ventas_total_no_negativo check (total >= 0);
    end if;
end $$;

-- ============================================================
-- 11. COSTO HISTÓRICO EN ITEMS DE VENTA
-- ============================================================

alter table public.venta_items
    add column if not exists costo_unitario numeric not null default 0;

alter table public.venta_items
    add column if not exists ganancia numeric generated always as
        ((precio_unitario - costo_unitario) * cantidad) stored;

-- Los tickets históricos de la v1 no guardaban costo al vender.
-- No inventamos el valor histórico. Queda 0 y se podrá identificar.
-- A partir de la nueva registrar_venta_v2 se guarda correctamente.

-- ============================================================
-- 12. FUNCIÓN PARA RESOLVER EL NEGOCIO DEL USUARIO
-- Durante transición espera que el usuario tenga un negocio principal.
-- ============================================================

create or replace function public.negocio_actual_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
begin
    select nm.negocio_id
      into v_negocio_id
      from public.negocio_miembros nm
     where nm.user_id = auth.uid()
       and nm.activo = true
     order by
       case nm.rol
         when 'owner' then 1
         when 'admin' then 2
         when 'manager' then 3
         else 4
       end,
       nm.creado
     limit 1;

    if v_negocio_id is null then
        raise exception 'El usuario no pertenece a ningún negocio';
    end if;

    return v_negocio_id;
end;
$$;

revoke all on function public.negocio_actual_id() from public;
grant execute on function public.negocio_actual_id() to authenticated;

-- ============================================================
-- 13. TRIGGER DE COMPATIBILIDAD
-- Si el frontend v1 inserta sin negocio_id, se autocompleta.
-- ============================================================

create or replace function public.completar_negocio_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.negocio_id is null then
        new.negocio_id := public.negocio_actual_id();
    end if;

    if not public.es_miembro_negocio(new.negocio_id) then
        raise exception 'No autorizado para este negocio';
    end if;

    return new;
end;
$$;

drop trigger if exists categorias_completar_negocio on public.categorias;
create trigger categorias_completar_negocio
before insert or update of negocio_id on public.categorias
for each row execute function public.completar_negocio_id();

drop trigger if exists productos_completar_negocio on public.productos;
create trigger productos_completar_negocio
before insert or update of negocio_id on public.productos
for each row execute function public.completar_negocio_id();

drop trigger if exists movimientos_completar_negocio on public.movimientos;
create trigger movimientos_completar_negocio
before insert or update of negocio_id on public.movimientos
for each row execute function public.completar_negocio_id();

drop trigger if exists ventas_completar_negocio on public.ventas;
create trigger ventas_completar_negocio
before insert or update of negocio_id on public.ventas
for each row execute function public.completar_negocio_id();

drop trigger if exists venta_items_completar_negocio on public.venta_items;
create trigger venta_items_completar_negocio
before insert or update of negocio_id on public.venta_items
for each row execute function public.completar_negocio_id();

-- ============================================================
-- 14. RLS NUEVA
-- ============================================================

alter table public.negocios enable row level security;
alter table public.negocio_miembros enable row level security;
alter table public.sucursales enable row level security;
alter table public.cajas enable row level security;

drop policy if exists "negocios_select_miembro" on public.negocios;
create policy "negocios_select_miembro"
on public.negocios
for select
using (public.es_miembro_negocio(id));

drop policy if exists "negocios_update_admin" on public.negocios;
create policy "negocios_update_admin"
on public.negocios
for update
using (public.tiene_rol_negocio(id, array['owner','admin']))
with check (public.tiene_rol_negocio(id, array['owner','admin']));

drop policy if exists "miembros_select_mismo_negocio" on public.negocio_miembros;
create policy "miembros_select_mismo_negocio"
on public.negocio_miembros
for select
using (public.es_miembro_negocio(negocio_id));

drop policy if exists "miembros_admin_insert" on public.negocio_miembros;
create policy "miembros_admin_insert"
on public.negocio_miembros
for insert
with check (public.tiene_rol_negocio(negocio_id, array['owner','admin']));

drop policy if exists "miembros_admin_update" on public.negocio_miembros;
create policy "miembros_admin_update"
on public.negocio_miembros
for update
using (public.tiene_rol_negocio(negocio_id, array['owner','admin']))
with check (public.tiene_rol_negocio(negocio_id, array['owner','admin']));

drop policy if exists "miembros_owner_delete" on public.negocio_miembros;
create policy "miembros_owner_delete"
on public.negocio_miembros
for delete
using (public.tiene_rol_negocio(negocio_id, array['owner']));

drop policy if exists "sucursales_select_miembro" on public.sucursales;
create policy "sucursales_select_miembro"
on public.sucursales
for select
using (public.es_miembro_negocio(negocio_id));

drop policy if exists "sucursales_admin_write" on public.sucursales;
create policy "sucursales_admin_write"
on public.sucursales
for all
using (public.tiene_rol_negocio(negocio_id, array['owner','admin']))
with check (public.tiene_rol_negocio(negocio_id, array['owner','admin']));

drop policy if exists "cajas_select_miembro" on public.cajas;
create policy "cajas_select_miembro"
on public.cajas
for select
using (public.es_miembro_negocio(negocio_id));

drop policy if exists "cajas_admin_write" on public.cajas;
create policy "cajas_admin_write"
on public.cajas
for all
using (public.tiene_rol_negocio(negocio_id, array['owner','admin']))
with check (public.tiene_rol_negocio(negocio_id, array['owner','admin']));

-- Reemplaza policies v1 por policies multiempresa.
drop policy if exists "categorias_por_dueno" on public.categorias;
drop policy if exists "productos_por_dueno" on public.productos;
drop policy if exists "movimientos_por_dueno" on public.movimientos;
drop policy if exists "ventas_por_dueno" on public.ventas;
drop policy if exists "venta_items_por_dueno" on public.venta_items;

drop policy if exists "categorias_negocio_select" on public.categorias;
create policy "categorias_negocio_select"
on public.categorias for select
using (public.es_miembro_negocio(negocio_id));

drop policy if exists "categorias_negocio_write" on public.categorias;
create policy "categorias_negocio_write"
on public.categorias for all
using (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']))
with check (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']));

drop policy if exists "productos_negocio_select" on public.productos;
create policy "productos_negocio_select"
on public.productos for select
using (public.es_miembro_negocio(negocio_id));

drop policy if exists "productos_negocio_write" on public.productos;
create policy "productos_negocio_write"
on public.productos for all
using (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']))
with check (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']));

drop policy if exists "movimientos_negocio_select" on public.movimientos;
create policy "movimientos_negocio_select"
on public.movimientos for select
using (public.es_miembro_negocio(negocio_id));

-- Los movimientos normales se generan desde RPCs security definer.
-- Escritura directa queda limitada a responsables.
drop policy if exists "movimientos_negocio_write" on public.movimientos;
create policy "movimientos_negocio_write"
on public.movimientos for all
using (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']))
with check (public.tiene_rol_negocio(negocio_id, array['owner','admin','manager']));

drop policy if exists "ventas_negocio_select" on public.ventas;
create policy "ventas_negocio_select"
on public.ventas for select
using (public.es_miembro_negocio(negocio_id));

drop policy if exists "venta_items_negocio_select" on public.venta_items;
create policy "venta_items_negocio_select"
on public.venta_items for select
using (public.es_miembro_negocio(negocio_id));

-- ============================================================
-- 15. RPC DE VENTA V2
-- - agrupa productos repetidos
-- - valida permisos
-- - bloquea stock con FOR UPDATE
-- - evita stock negativo
-- - guarda costo histórico
-- - guarda negocio/sucursal/caja
-- ============================================================

create or replace function public.registrar_venta_v2(
    p_items jsonb,
    p_medio_pago text default null,
    p_sucursal_id uuid default null,
    p_caja_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_negocio_id uuid;
    v_sucursal_id uuid;
    v_caja_id uuid;
    v_total numeric := 0;
    v_venta public.ventas;
    v_item record;
    v_producto public.productos;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then
        raise exception 'El carrito está vacío';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager','cashier']
    ) then
        raise exception 'No tenés permiso para registrar ventas';
    end if;

    if p_sucursal_id is null then
        select s.id
          into v_sucursal_id
          from public.sucursales s
         where s.negocio_id = v_negocio_id
           and s.activa = true
         order by s.creado
         limit 1;
    else
        select s.id
          into v_sucursal_id
          from public.sucursales s
         where s.id = p_sucursal_id
           and s.negocio_id = v_negocio_id
           and s.activa = true;
    end if;

    if v_sucursal_id is null then
        raise exception 'Sucursal inválida';
    end if;

    if p_caja_id is null then
        select c.id
          into v_caja_id
          from public.cajas c
         where c.negocio_id = v_negocio_id
           and c.sucursal_id = v_sucursal_id
           and c.activa = true
         order by c.creado
         limit 1;
    else
        select c.id
          into v_caja_id
          from public.cajas c
         where c.id = p_caja_id
           and c.negocio_id = v_negocio_id
           and c.sucursal_id = v_sucursal_id
           and c.activa = true;
    end if;

    if v_caja_id is null then
        raise exception 'Caja inválida';
    end if;

    -- Validación y locks. Agrupa IDs repetidos para cerrar el edge case v1.
    for v_item in
        select
            (x->>'producto_id')::uuid as producto_id,
            sum((x->>'cantidad')::integer)::integer as cantidad
        from jsonb_array_elements(p_items) x
        group by (x->>'producto_id')::uuid
    loop
        if v_item.cantidad is null or v_item.cantidad <= 0 then
            raise exception 'Cantidad inválida';
        end if;

        select *
          into v_producto
          from public.productos
         where id = v_item.producto_id
           and negocio_id = v_negocio_id
         for update;

        if not found then
            raise exception 'Producto no encontrado o no autorizado';
        end if;

        if v_producto.stock < v_item.cantidad then
            raise exception 'Stock insuficiente de "%": quedan % unidades',
                v_producto.nombre,
                v_producto.stock;
        end if;
    end loop;

    insert into public.ventas(
        user_id,
        negocio_id,
        sucursal_id,
        caja_id,
        total,
        medio_pago
    )
    values (
        auth.uid(),
        v_negocio_id,
        v_sucursal_id,
        v_caja_id,
        0,
        p_medio_pago
    )
    returning * into v_venta;

    for v_item in
        select
            (x->>'producto_id')::uuid as producto_id,
            sum((x->>'cantidad')::integer)::integer as cantidad
        from jsonb_array_elements(p_items) x
        group by (x->>'producto_id')::uuid
    loop
        update public.productos
           set stock = stock - v_item.cantidad,
               actualizado = now()
         where id = v_item.producto_id
           and negocio_id = v_negocio_id
           and stock >= v_item.cantidad
         returning * into v_producto;

        if not found then
            raise exception 'No se pudo descontar stock de forma segura';
        end if;

        insert into public.venta_items(
            venta_id,
            user_id,
            negocio_id,
            producto_id,
            producto_nombre,
            cantidad,
            precio_unitario,
            costo_unitario,
            subtotal
        )
        values (
            v_venta.id,
            auth.uid(),
            v_negocio_id,
            v_producto.id,
            v_producto.nombre,
            v_item.cantidad,
            v_producto.precio_venta,
            v_producto.precio_compra,
            v_producto.precio_venta * v_item.cantidad
        );

        insert into public.movimientos(
            user_id,
            negocio_id,
            producto_id,
            producto_nombre,
            tipo,
            delta,
            stock_resultante
        )
        values (
            auth.uid(),
            v_negocio_id,
            v_producto.id,
            v_producto.nombre,
            'venta',
            -v_item.cantidad,
            v_producto.stock
        );

        v_total := v_total + (v_producto.precio_venta * v_item.cantidad);
    end loop;

    update public.ventas
       set total = v_total
     where id = v_venta.id
     returning * into v_venta;

    return jsonb_build_object(
        'venta', to_jsonb(v_venta),
        'negocio_id', v_negocio_id,
        'sucursal_id', v_sucursal_id,
        'caja_id', v_caja_id
    );
end;
$$;

revoke all on function public.registrar_venta_v2(jsonb, text, uuid, uuid) from public;
grant execute on function public.registrar_venta_v2(jsonb, text, uuid, uuid) to authenticated;

-- ============================================================
-- 16. RPC AJUSTAR STOCK V2
-- No corrige silenciosamente a cero: si quedaría negativo, falla.
-- ============================================================

create or replace function public.ajustar_stock_v2(
    p_producto_id uuid,
    p_delta integer,
    p_tipo text default 'ajuste'
)
returns public.productos
language plpgsql
security definer
set search_path = public
as $$
declare
    v_producto public.productos;
    v_negocio_id uuid;
begin
    if auth.uid() is null then
        raise exception 'Sesión requerida';
    end if;

    if p_tipo not in ('venta','ajuste','ingreso') then
        raise exception 'Tipo de movimiento inválido';
    end if;

    v_negocio_id := public.negocio_actual_id();

    if not public.tiene_rol_negocio(
        v_negocio_id,
        array['owner','admin','manager']
    ) then
        raise exception 'No tenés permiso para ajustar stock';
    end if;

    select *
      into v_producto
      from public.productos
     where id = p_producto_id
       and negocio_id = v_negocio_id
     for update;

    if not found then
        raise exception 'Producto no encontrado o no autorizado';
    end if;

    if v_producto.stock + p_delta < 0 then
        raise exception 'Stock insuficiente. Stock actual: %, ajuste solicitado: %',
            v_producto.stock,
            p_delta;
    end if;

    update public.productos
       set stock = stock + p_delta,
           actualizado = now()
     where id = p_producto_id
     returning * into v_producto;

    insert into public.movimientos(
        user_id,
        negocio_id,
        producto_id,
        producto_nombre,
        tipo,
        delta,
        stock_resultante
    )
    values (
        auth.uid(),
        v_negocio_id,
        v_producto.id,
        v_producto.nombre,
        p_tipo,
        p_delta,
        v_producto.stock
    );

    return v_producto;
end;
$$;

revoke all on function public.ajustar_stock_v2(uuid, integer, text) from public;
grant execute on function public.ajustar_stock_v2(uuid, integer, text) to authenticated;

-- ============================================================
-- 17. AUDITORÍA BASE
-- ============================================================

create table if not exists public.audit_log (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    user_id uuid references auth.users(id) on delete set null,
    accion text not null,
    entidad text not null,
    entidad_id uuid,
    detalle jsonb not null default '{}'::jsonb,
    creado timestamptz not null default now()
);

create index if not exists audit_log_negocio_creado_idx
    on public.audit_log(negocio_id, creado desc);

alter table public.audit_log enable row level security;

drop policy if exists "audit_select_responsables" on public.audit_log;
create policy "audit_select_responsables"
on public.audit_log
for select
using (
    public.tiene_rol_negocio(
        negocio_id,
        array['owner','admin','manager']
    )
);

-- Escritura directa de audit_log no se habilita al cliente.
-- La usaremos desde funciones seguras.

-- ============================================================
-- 18. VALIDACIÓN FINAL DE MIGRACIÓN
-- ============================================================

do $$
begin
    if exists (select 1 from public.productos where negocio_id is null) then
        raise exception 'Migración incompleta: existen productos sin negocio_id';
    end if;

    if exists (select 1 from public.ventas where negocio_id is null) then
        raise exception 'Migración incompleta: existen ventas sin negocio_id';
    end if;

    if exists (select 1 from public.venta_items where negocio_id is null) then
        raise exception 'Migración incompleta: existen items de venta sin negocio_id';
    end if;
end $$;

commit;

-- ============================================================
-- CONSULTAS DE VERIFICACIÓN (ejecutarlas después si querés)
-- ============================================================
--
-- select * from public.negocios;
-- select * from public.negocio_miembros;
-- select * from public.sucursales;
-- select * from public.cajas;
--
-- select
--   n.nombre,
--   count(distinct p.id) as productos,
--   count(distinct v.id) as ventas
-- from public.negocios n
-- left join public.productos p on p.negocio_id = n.id
-- left join public.ventas v on v.negocio_id = n.id
-- group by n.id, n.nombre;
--
-- ============================================================
