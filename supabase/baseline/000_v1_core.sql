-- Vendify clean bootstrap: authoritative v1 core reconstructed from the
-- captured pre-v2.31 schema and the ALTER statements in migration 001.
-- Intended only for an empty disposable Supabase project during validation.

begin;

create extension if not exists "pgcrypto";

create table public.categorias (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    nombre text not null,
    creado timestamptz not null default now(),
    unique (user_id, nombre)
);

create table public.productos (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    nombre text not null,
    categoria text,
    precio_compra numeric not null default 0,
    precio_venta numeric not null default 0,
    stock integer not null default 0,
    stock_minimo integer not null default 5,
    foto text,
    creado timestamptz not null default now(),
    actualizado timestamptz not null default now()
);

create table public.movimientos (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    producto_id uuid not null references public.productos(id) on delete cascade,
    producto_nombre text not null,
    tipo text not null check (tipo in ('venta', 'ajuste', 'ingreso')),
    delta integer not null,
    stock_resultante integer not null,
    creado timestamptz not null default now()
);

create table public.ventas (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    total numeric not null default 0,
    medio_pago text,
    creado timestamptz not null default now()
);

create table public.venta_items (
    id uuid primary key default gen_random_uuid(),
    venta_id uuid not null references public.ventas(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    producto_id uuid references public.productos(id) on delete set null,
    producto_nombre text not null,
    cantidad integer not null,
    precio_unitario numeric not null,
    subtotal numeric not null
);

create index productos_user_id_idx on public.productos(user_id);
create index movimientos_user_id_idx on public.movimientos(user_id);
create index movimientos_producto_id_idx on public.movimientos(producto_id);
create index ventas_user_id_idx on public.ventas(user_id);
create index ventas_creado_idx on public.ventas(creado);
create index venta_items_venta_id_idx on public.venta_items(venta_id);

alter table public.categorias enable row level security;
alter table public.productos enable row level security;
alter table public.movimientos enable row level security;
alter table public.ventas enable row level security;
alter table public.venta_items enable row level security;

commit;
