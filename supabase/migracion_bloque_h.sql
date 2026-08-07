-- =========================================================
-- MIGRACIÓN — Bloque H: pagos de préstamos con medio de pago (para que se
-- reflejen en el cierre de caja) + pago a proveedores en el cierre de caja.
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- ---------------------------------------------------------
-- Ledger de pagos de préstamos (permite abonos parciales, cada uno con su
-- medio de pago). Inmutable: no hay policy de update/delete.
-- ---------------------------------------------------------
create table public.prestamo_pagos (
  id uuid primary key default gen_random_uuid(),
  prestamo_id uuid not null references public.prestamos(id),
  monto numeric(12,2) not null check (monto > 0),
  metodo_pago text not null check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  nota text,
  pagado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_prestamo_pagos_prestamo on public.prestamo_pagos(prestamo_id);

alter table public.prestamo_pagos enable row level security;

create policy "super registra pagos de prestamo"
  on public.prestamo_pagos for insert
  with check (public.es_super() and pagado_por = auth.uid());

create policy "admin ve pagos de prestamo"
  on public.prestamo_pagos for select
  using (public.es_admin());

create trigger trg_auditoria_prestamo_pagos
  after insert on public.prestamo_pagos
  for each row execute function public.registrar_auditoria();

-- ---------------------------------------------------------
-- Cierre de caja: pago a proveedores hecho ese día (salida de caja).
-- ---------------------------------------------------------
alter table public.cierres_caja
  add column if not exists proveedor_monto numeric(12,2) not null default 0,
  add column if not exists proveedor_metodo_pago text
    check (proveedor_metodo_pago is null or proveedor_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  add column if not exists proveedor_nota text;
