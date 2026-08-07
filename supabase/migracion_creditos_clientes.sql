-- =========================================================
-- MIGRACIÓN — saldo a favor / reembolsos a clientas
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- Cuando el abono ya pagado por una cita termina siendo mayor que el total
-- finalmente cobrado (ej: la clienta cambió a un servicio más barato ya con
-- el 100% abonado), queda una diferencia a favor de la clienta. Admin/super
-- decide cómo resolverla al ver la visita en "Cuentas por cobrar": dejarla
-- como crédito para una próxima cita, o devolverla en efectivo/transferencia
-- (eso sí sale de caja, y se refleja en el Cierre de caja del día).
create table if not exists public.creditos_clientes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.profiles(id),
  cita_id uuid references public.citas(id),
  visita_id uuid,
  monto numeric(12,2) not null check (monto > 0),
  resolucion text not null check (resolucion in ('credito', 'reembolso')),
  metodo_pago text check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  nota text,
  -- Solo aplica al tipo "credito": si ya se descontó en una cita posterior.
  usado boolean not null default false,
  usado_en_cita_id uuid references public.citas(id),
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((resolucion = 'reembolso') = (metodo_pago is not null))
);

create index if not exists idx_creditos_clientes_cliente on public.creditos_clientes(cliente_id);
create index if not exists idx_creditos_clientes_visita on public.creditos_clientes(visita_id);

alter table public.creditos_clientes enable row level security;

-- (Postgres no soporta "CREATE POLICY IF NOT EXISTS": se borran primero por
-- si ya existen, para que esta migración se pueda volver a correr sin error.)
drop policy if exists "admin registra creditos" on public.creditos_clientes;
create policy "admin registra creditos"
  on public.creditos_clientes for insert
  with check (public.es_admin() and creado_por = auth.uid());

drop policy if exists "admin ve creditos" on public.creditos_clientes;
create policy "admin ve creditos"
  on public.creditos_clientes for select
  using (public.es_admin());

drop policy if exists "clienta ve sus propios creditos" on public.creditos_clientes;
create policy "clienta ve sus propios creditos"
  on public.creditos_clientes for select
  using (cliente_id = auth.uid());

-- El único cambio permitido después de creado es marcarlo como usado
-- (el trigger de abajo bloquea cualquier otro campo).
drop policy if exists "admin marca credito como usado" on public.creditos_clientes;
create policy "admin marca credito como usado"
  on public.creditos_clientes for update
  using (public.es_admin())
  with check (public.es_admin());

create or replace function public.bloquear_edicion_credito()
returns trigger
language plpgsql
as $$
begin
  if new.cliente_id is distinct from old.cliente_id
     or new.cita_id is distinct from old.cita_id
     or new.visita_id is distinct from old.visita_id
     or new.monto is distinct from old.monto
     or new.resolucion is distinct from old.resolucion
     or new.metodo_pago is distinct from old.metodo_pago
     or new.nota is distinct from old.nota
     or new.creado_por is distinct from old.creado_por
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Un crédito/reembolso ya registrado no se puede modificar; solo marcarse como usado.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bloquear_edicion_credito on public.creditos_clientes;
create trigger trg_bloquear_edicion_credito
  before update on public.creditos_clientes
  for each row execute function public.bloquear_edicion_credito();
