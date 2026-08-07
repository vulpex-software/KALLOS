-- =========================================================
-- MIGRACIÓN — Bloque O: pagar una venta con varios medios en un solo
-- formulario (ej. mitad efectivo, mitad Nequi), igual que ya se podía con
-- los cobros de servicios.
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- El pago real (uno o varios medios) ahora se registra en venta_pagos.
-- Estas columnas de ventas quedan solo por compatibilidad con ventas viejas.
alter table public.ventas
  alter column metodo_pago drop not null;

create table public.venta_pagos (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas(id),
  monto numeric(12,2) not null check (monto > 0),
  metodo_pago text not null check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  foto_url text,
  pagado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_venta_pagos_venta on public.venta_pagos(venta_id);

alter table public.venta_pagos enable row level security;

create policy "admin registra pagos de venta"
  on public.venta_pagos for insert
  with check (public.es_admin() and pagado_por = auth.uid());

create policy "admin ve pagos de venta"
  on public.venta_pagos for select
  using (public.es_admin());

create trigger trg_auditoria_venta_pagos
  after insert on public.venta_pagos
  for each row execute function public.registrar_auditoria();
