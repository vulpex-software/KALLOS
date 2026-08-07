-- =========================================================
-- Cuentas por cobrar: 2 features portadas del proyecto original de
-- Yessica Arango (se agregaron ahí DESPUÉS de sacar la copia que dio
-- origen a KALLOS). Adaptadas a multi-tenant: salon_id + mi_salon() en
-- todo, mismo patrón que el resto del esquema.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Devolver dinero (reembolso) de un saldo a favor: sacar plata física
--    de caja es solo de la dueña. Un admin todavía puede dejarlo como
--    crédito (no mueve caja), pero no puede reembolsar.
-- ---------------------------------------------------------
drop policy if exists "admin registra creditos de su salon" on public.creditos_clientes;
create policy "admin registra creditos de su salon"
  on public.creditos_clientes for insert
  with check (
    public.es_admin()
    and creado_por = auth.uid()
    and salon_id = public.mi_salon()
    and (resolucion = 'credito' or public.es_super())
  );

-- ---------------------------------------------------------
-- 2. Condonaciones: eliminar/perdonar un saldo PENDIENTE por cobrar (la
--    clienta debe, pero la dueña decide no cobrarlo) SIN que cuente como
--    dinero que entró a caja -- por eso es una tabla aparte de "cobros",
--    no una fila más ahí. Ledger inmutable (solo insert/select), solo
--    superadmin puede crearlas.
-- ---------------------------------------------------------
create table if not exists public.condonaciones (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  visita_id uuid not null,
  monto numeric(12,2) not null check (monto > 0),
  motivo text not null check (length(trim(motivo)) > 0),
  condonado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_condonaciones_visita on public.condonaciones(visita_id);
create index if not exists idx_condonaciones_salon on public.condonaciones(salon_id);

alter table public.condonaciones enable row level security;

drop policy if exists "super condona saldo de su salon" on public.condonaciones;
create policy "super condona saldo de su salon"
  on public.condonaciones for insert
  with check (public.es_super() and condonado_por = auth.uid() and salon_id = public.mi_salon());

drop policy if exists "admin ve condonaciones de su salon" on public.condonaciones;
create policy "admin ve condonaciones de su salon"
  on public.condonaciones for select
  using (public.es_admin() and salon_id = public.mi_salon());

-- Sin policy de update/delete: queda bloqueado por RLS, es inmutable.

grant all on public.condonaciones to anon, authenticated, service_role;
