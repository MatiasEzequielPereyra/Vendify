-- ============================================================
-- Vendify — unicidad segura de códigos de barras por negocio
-- ============================================================
-- Los códigos vacíos siguen permitidos. Los no vacíos se normalizan con btrim
-- para que " 779... " no pueda duplicar a "779..." dentro del mismo negocio.

begin;

do $$
declare
    v_duplicados text;
begin
    select string_agg(
        format('%s (%s registros)', codigo_barras, cantidad),
        ', ' order by codigo_barras
    )
      into v_duplicados
      from (
          select
              btrim(p.codigo_barras) as codigo_barras,
              count(*) as cantidad
            from public.productos p
           where nullif(btrim(coalesce(p.codigo_barras,'')), '') is not null
           group by p.negocio_id, btrim(p.codigo_barras)
          having count(*) > 1
           order by btrim(p.codigo_barras)
           limit 10
      ) duplicados;

    if v_duplicados is not null then
        raise exception
          'No se puede activar la unicidad de códigos de barras: existen duplicados. Corregí estos códigos y ejecutá nuevamente la migración: %',
          v_duplicados;
    end if;
end;
$$;

create unique index if not exists productos_negocio_codigo_barras_unico_idx
    on public.productos(negocio_id, btrim(codigo_barras))
    where nullif(btrim(codigo_barras), '') is not null;

comment on index public.productos_negocio_codigo_barras_unico_idx is
  'Impide códigos de barras duplicados dentro del mismo negocio; permite valores vacíos.';

commit;
