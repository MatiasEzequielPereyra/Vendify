-- ============================================================
-- Vendify v2.30.11 — soporte persistente de idempotencia de ventas
-- ============================================================

begin;

create table if not exists public.venta_idempotencia_v23011 (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    request_id text not null check (
        length(request_id) between 8 and 100
    ),
    respuesta jsonb,
    creado timestamptz not null default now(),
    actualizado timestamptz not null default now(),
    unique (negocio_id, user_id, request_id)
);

create index if not exists venta_idempotencia_v23011_creado_idx
    on public.venta_idempotencia_v23011(creado);

alter table public.venta_idempotencia_v23011 enable row level security;

revoke all on table public.venta_idempotencia_v23011
    from public, anon, authenticated;

commit;
