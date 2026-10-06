-- VEN-014 — Stock Initial Movement Constraint Provenance Fix
-- Restore stock_inicial after historical baseline rebuilds that omitted it.
-- Production is intentionally untouched.

do $$
declare
    v_tipos text;
begin
    if to_regclass('public.movimientos') is null then
        raise exception 'public.movimientos is required before VEN-014';
    end if;

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
          union select 'stock_inicial'
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
