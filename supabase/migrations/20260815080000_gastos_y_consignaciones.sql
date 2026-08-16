-- Dos salidas/movimientos de caja que antes no tenían dónde registrarse:
--
-- 1. GASTOS varios ("caja menor"): lo que se compra afuera en el día -- una
--    copia, unos vasos, el domicilio. Antes solo existía "Pago a
--    proveedores" en el cierre, que es otra cosa (el proveedor de producto
--    de vitrina, con su nombre en Inventario) y además no pide soporte.
--    Acá la FOTO DE LA FACTURA ES OBLIGATORIA -- es la diferencia con el
--    pago a proveedores, y la razón de ser de la tabla.
--
-- 2. CONSIGNACIONES: el efectivo que se lleva al banco, con el comprobante.
--    El cierre de caja avisa cuánto hay para consignar y queda registrado
--    acá con su soporte.
--
-- Las dos son ledgers de una sola escritura, igual que "cobros": no se
-- editan. Se pueden borrar (solo la dueña) porque un monto mal escrito con
-- foto equivocada no se arregla con un registro corrector, a diferencia de
-- un cobro donde la plata sí entró.

create table if not exists public.gastos (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  monto numeric(12,2) not null check (monto > 0),
  metodo_pago text not null check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b')),
  concepto text not null,
  -- Obligatoria a nivel de base de datos, no solo en la pantalla.
  foto_url text not null,
  registrado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_gastos_salon on public.gastos(salon_id);
create index if not exists idx_gastos_created on public.gastos(created_at);

alter table public.gastos enable row level security;

drop policy if exists "admin registra gastos de su salon" on public.gastos;
create policy "admin registra gastos de su salon"
  on public.gastos for insert
  with check (public.es_admin() and registrado_por = auth.uid() and salon_id = public.mi_salon());

drop policy if exists "admin ve gastos de su salon" on public.gastos;
create policy "admin ve gastos de su salon"
  on public.gastos for select
  using (public.es_admin() and salon_id = public.mi_salon());

drop policy if exists "super borra gastos de su salon" on public.gastos;
create policy "super borra gastos de su salon"
  on public.gastos for delete
  using (public.es_super() and salon_id = public.mi_salon());

create table if not exists public.consignaciones (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  monto numeric(12,2) not null check (monto > 0),
  -- Día de caja al que corresponde (no necesariamente el día en que se fue
  -- al banco), para poder cruzarla contra el cierre de esa fecha.
  fecha date not null,
  banco text,
  foto_url text not null,
  registrado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_consignaciones_salon on public.consignaciones(salon_id);
create index if not exists idx_consignaciones_fecha on public.consignaciones(fecha);

alter table public.consignaciones enable row level security;

drop policy if exists "admin registra consignaciones de su salon" on public.consignaciones;
create policy "admin registra consignaciones de su salon"
  on public.consignaciones for insert
  with check (public.es_admin() and registrado_por = auth.uid() and salon_id = public.mi_salon());

drop policy if exists "admin ve consignaciones de su salon" on public.consignaciones;
create policy "admin ve consignaciones de su salon"
  on public.consignaciones for select
  using (public.es_admin() and salon_id = public.mi_salon());

drop policy if exists "super borra consignaciones de su salon" on public.consignaciones;
create policy "super borra consignaciones de su salon"
  on public.consignaciones for delete
  using (public.es_super() and salon_id = public.mi_salon());

drop trigger if exists trg_auditoria_gastos on public.gastos;
create trigger trg_auditoria_gastos
  after insert on public.gastos
  for each row execute function public.registrar_auditoria();

drop trigger if exists trg_auditoria_consignaciones on public.consignaciones;
create trigger trg_auditoria_consignaciones
  after insert on public.consignaciones
  for each row execute function public.registrar_auditoria();

-- El runner local no hereda los default privileges del schema.sql base.
grant all on public.gastos to anon, authenticated, service_role;
grant all on public.consignaciones to anon, authenticated, service_role;
