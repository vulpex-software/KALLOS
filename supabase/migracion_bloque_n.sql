-- =========================================================
-- MIGRACIÓN — Bloque N: catálogo de obsequios editable por la dueña
-- (superadmin), en vez de una lista fija en el código.
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

create table public.obsequios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activo boolean not null default true,
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.obsequios enable row level security;

create policy "gestor administra obsequios"
  on public.obsequios for all
  using (public.es_super())
  with check (public.es_super());

create policy "admin ve obsequios"
  on public.obsequios for select
  using (public.es_admin());

create trigger trg_auditoria_obsequios
  after insert or update on public.obsequios
  for each row execute function public.registrar_auditoria();

-- Se cargan los 6 que ya existían fijos en el código, para no perderlos.
insert into public.obsequios (nombre, creado_por)
select nombre, (select id from public.profiles where rol = 'superadmin' order by created_at limit 1)
from (values
  ('Veloterapia'), ('Chocolaterapia'), ('Mascarilla menta'),
  ('Polvo espumoso'), ('Jelly spa'), ('Parafina')
) as v(nombre)
where exists (select 1 from public.profiles where rol = 'superadmin')
on conflict (nombre) do nothing;
