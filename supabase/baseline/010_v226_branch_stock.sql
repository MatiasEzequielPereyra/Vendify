-- Vendify v2.26 branch-stock foundation recovered from the authoritative
-- schema and function captures. Run after 001_multiempresa_roles_sucursales.

begin;

alter table public.productos add column if not exists marca text;
alter table public.productos add column if not exists presentacion text;
alter table public.productos add column if not exists codigo_barras text;

create table public.producto_stock_sucursal (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete cascade,
    producto_id uuid not null references public.productos(id) on delete cascade,
    stock integer not null default 0 check (stock >= 0),
    stock_minimo integer not null default 5 check (stock_minimo >= 0),
    creado timestamptz not null default now(),
    actualizado timestamptz not null default now(),
    unique (sucursal_id, producto_id)
);

create index producto_stock_sucursal_negocio_idx on public.producto_stock_sucursal(negocio_id);
create index producto_stock_sucursal_sucursal_idx on public.producto_stock_sucursal(sucursal_id);
create index producto_stock_sucursal_producto_idx on public.producto_stock_sucursal(producto_id);
create index productos_codigo_barras_idx on public.productos(codigo_barras) where codigo_barras is not null;

create or replace function public.recalcular_stock_total_producto_v1(p_producto_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_total integer;
begin
    select coalesce(sum(ps.stock),0)::integer
      into v_total
      from public.producto_stock_sucursal ps
     where ps.producto_id = p_producto_id;

    update public.productos
       set stock = greatest(v_total,0),
           actualizado = now()
     where id = p_producto_id;
end;
$$;

create or replace function public.stock_sucursal_recalcular_total_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.recalcular_stock_total_producto_v1(coalesce(new.producto_id, old.producto_id));
    return coalesce(new, old);
end;
$$;

create or replace function public.crear_stock_sucursales_producto_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_principal_id uuid;
begin
    select s.id into v_principal_id
      from public.sucursales s
     where s.negocio_id = new.negocio_id and s.activa = true
     order by case when lower(s.nombre) = 'principal' then 0 else 1 end, s.creado
     limit 1;

    insert into public.producto_stock_sucursal(negocio_id, sucursal_id, producto_id, stock, stock_minimo)
    select new.negocio_id, s.id, new.id,
           case when s.id = v_principal_id then greatest(coalesce(new.stock,0),0) else 0 end,
           greatest(coalesce(new.stock_minimo,5),0)
      from public.sucursales s
     where s.negocio_id = new.negocio_id
    on conflict (sucursal_id, producto_id) do nothing;
    return new;
end;
$$;

create trigger stock_sucursal_recalcular_total_v1
after insert or delete or update of stock on public.producto_stock_sucursal
for each row execute function public.stock_sucursal_recalcular_total_trigger_v1();

create trigger productos_crear_stock_sucursales_v1
after insert on public.productos
for each row execute function public.crear_stock_sucursales_producto_v1();

alter table public.producto_stock_sucursal enable row level security;
create policy producto_stock_sucursal_select
on public.producto_stock_sucursal for select
using (public.es_miembro_negocio(negocio_id));

commit;
