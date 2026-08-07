-- =========================================================
-- MIGRACIÓN — Bloque M: quitar el tope de las 8pm a la hora de TÉRMINO.
-- La hora de INICIO sigue limitada a 9am-8pm, pero un servicio que empieza
-- cerca del cierre puede terminar después (ej: empieza 7pm, dura 2 horas,
-- termina 9pm).
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

alter table public.citas
  drop constraint if exists citas_hora_fin_en_horario;
