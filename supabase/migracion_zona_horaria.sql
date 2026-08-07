-- =========================================================
-- MIGRACIÓN — Zona horaria Colombia (America/Bogota)
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- Corrige que la comparación diaria agrupe los servicios por la fecha LOCAL
-- (Colombia) y no por la fecha UTC.
-- =========================================================

drop view if exists public.vista_comparacion_diaria;
create view public.vista_comparacion_diaria as
select
  coalesce(r.fecha, c.fecha) as fecha,
  coalesce(r.total, 0) as total_registrado,
  coalesce(c.total, 0) as total_reportado,
  coalesce(r.total, 0) - coalesce(c.total, 0) as diferencia
from (
  select (created_at at time zone 'America/Bogota')::date as fecha, sum(precio_cobrado) as total
  from public.registros_trabajo
  where not anulado
  group by (created_at at time zone 'America/Bogota')::date
) r
full outer join (
  select fecha,
         sum(efectivo_entregado + nequi_reportado + daviplata_reportado + datafono_reportado) as total
  from public.cierres_caja
  group by fecha
) c on r.fecha = c.fecha
order by fecha desc;
