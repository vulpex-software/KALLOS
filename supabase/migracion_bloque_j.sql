-- =========================================================
-- MIGRACIÓN — Bloque J: horario de atención (9:00am a 8:00pm).
-- Ninguna cita NUEVA se puede agendar fuera de este rango, sin importar
-- desde dónde se cree (app de la clienta o panel del admin).
--
-- Se usa "NOT VALID": esto hace que el constraint aplique de aquí en
-- adelante (toda cita nueva, o cualquier cita vieja que se actualice,
-- debe cumplir el horario), pero NO revisa las citas que ya existen
-- (por eso no falla aunque haya alguna vieja fuera de horario, de pruebas
-- u otra causa).
--
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

alter table public.citas
  add constraint citas_hora_en_horario check (hora >= '09:00' and hora <= '20:00') not valid;

alter table public.citas
  add constraint citas_hora_fin_en_horario check (hora_fin is null or hora_fin <= '20:00') not valid;

-- ---------------------------------------------------------
-- Opcional: para ver qué citas viejas quedan fuera de horario (curiosidad,
-- no hace falta corregirlas; el constraint ya no las va a bloquear).
-- ---------------------------------------------------------
-- select id, fecha, hora, hora_fin, cliente_nombre, estado
-- from public.citas
-- where hora < '09:00' or hora > '20:00' or (hora_fin is not null and hora_fin > '20:00')
-- order by fecha desc;
