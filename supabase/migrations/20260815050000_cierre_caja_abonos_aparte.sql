-- Cierre de caja partido en dos cuadres independientes por día:
--   'servicios' -> cobros de «Cuentas por cobrar» + ventas de vitrina +
--                  préstamos + reembolsos + pago a proveedores (con base).
--   'abonos'    -> solo los abonos de citas (sin base ni proveedores).
-- Mezclarlos en un solo número hacía imposible auditar un descuadre: no se
-- sabía si fallaba lo cobrado en servicios o lo recibido en abonos.
--
-- Los cierres ya guardados quedan como 'servicios' por el default, que es
-- exactamente lo que eran.
alter table public.cierres_caja
  add column if not exists tipo text not null default 'servicios'
  check (tipo in ('servicios', 'abonos'));

-- Antes solo se permitía un cierre por salón+fecha+administradora. Ahora
-- uno de cada tipo el mismo día. El nombre viejo es el que Postgres
-- autogeneró para unique (salon_id, fecha, administradora_id) -- verificado
-- contra pg_constraint en producción antes de escribir esto.
alter table public.cierres_caja
  drop constraint if exists cierres_caja_salon_id_fecha_administradora_id_key;
alter table public.cierres_caja
  drop constraint if exists cierres_caja_salon_id_fecha_administradora_id_tipo_key;
alter table public.cierres_caja
  add constraint cierres_caja_salon_id_fecha_administradora_id_tipo_key
  unique (salon_id, fecha, administradora_id, tipo);
