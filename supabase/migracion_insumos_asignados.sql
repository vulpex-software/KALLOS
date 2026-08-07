-- =========================================================
-- MIGRACIÓN — nuevo tipo de préstamo "insumo_interno" (insumo asignado)
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- 'insumo' ya existía = insumo fiado de vitrina (con monto/medio de pago,
-- genera deuda). 'insumo_interno' es nuevo = insumo asignado del inventario
-- interno, sin costo (no genera deuda; solo queda el registro de a quién y
-- qué se le dio, ej. "se le asignó 1 base para el trabajo diario").
alter table public.prestamos drop constraint if exists prestamos_tipo_check;
alter table public.prestamos add constraint prestamos_tipo_check
  check (tipo in ('dinero', 'insumo', 'insumo_interno'));
