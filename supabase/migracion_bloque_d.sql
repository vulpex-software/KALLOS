-- =========================================================
-- MIGRACIÓN Bloque D — Permisos, préstamos y base de caja
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- Permisos: hora opcional (permisos de unas horas dentro del día)
alter table public.permisos
  add column if not exists hora_desde time,
  add column if not exists hora_hasta time;

-- Préstamos: medio por el que se dio el adelanto
alter table public.prestamos
  add column if not exists metodo_pago text
    check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono'));

-- Cierre de caja: base (efectivo con el que se abre la caja)
alter table public.cierres_caja
  add column if not exists base numeric(12,2) not null default 0;

-- Aprobar permisos: solo el superadmin (se le quita a la administradora)
drop policy if exists "admin gestiona permisos" on public.permisos;
create policy "super gestiona permisos"
  on public.permisos for update
  using (public.es_super())
  with check (public.es_super());

-- El superadmin puede registrar permisos/descansos para CUALQUIER persona.
create policy "super registra permisos de cualquiera"
  on public.permisos for insert
  with check (public.es_super());
