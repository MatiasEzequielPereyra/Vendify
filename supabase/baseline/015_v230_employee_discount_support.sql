-- ============================================================
-- Vendify v2.30 — soporte de empleados y autorización de descuentos
-- ============================================================

begin;

alter table public.negocios
    add column if not exists codigo_acceso text;

create unique index if not exists negocios_codigo_acceso_uidx
    on public.negocios(codigo_acceso)
    where codigo_acceso is not null;

alter table public.negocio_miembros
    add column if not exists pin_descuento_hash text,
    add column if not exists pin_descuento_actualizado timestamptz,
    add column if not exists actualizado timestamptz not null default now();

create table if not exists public.empleados (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    username text,
    nombre text,
    debe_cambiar_password boolean not null default false,
    activo boolean not null default true,
    creado timestamptz not null default now(),
    actualizado timestamptz not null default now(),
    unique (negocio_id, user_id)
);

create unique index if not exists empleados_username_negocio_uidx
    on public.empleados(negocio_id, lower(username))
    where username is not null;

create table if not exists public.descuento_pin_intentos (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    intentos integer not null default 0 check (intentos >= 0),
    ventana_inicio timestamptz not null default now(),
    bloqueado_hasta timestamptz,
    actualizado timestamptz not null default now(),
    unique (negocio_id, user_id)
);

create table if not exists public.descuento_autorizaciones (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    sucursal_id uuid not null references public.sucursales(id) on delete cascade,
    solicitante_user_id uuid not null references auth.users(id) on delete cascade,
    autorizador_user_id uuid not null references auth.users(id) on delete restrict,
    subtotal numeric(14,2) not null check (subtotal > 0),
    descuento_tipo text not null check (descuento_tipo in ('porcentaje','monto')),
    descuento_valor numeric(14,2) not null check (descuento_valor > 0),
    expira_en timestamptz not null,
    usado_en timestamptz,
    venta_id uuid references public.ventas(id) on delete set null,
    creado timestamptz not null default now()
);

create index if not exists descuento_autorizaciones_pendientes_idx
    on public.descuento_autorizaciones(
        negocio_id, sucursal_id, solicitante_user_id, expira_en desc
    )
    where usado_en is null;

alter table public.empleados enable row level security;
alter table public.descuento_pin_intentos enable row level security;
alter table public.descuento_autorizaciones enable row level security;

revoke all on table public.empleados,
    public.descuento_pin_intentos,
    public.descuento_autorizaciones
    from public, anon, authenticated;

commit;
