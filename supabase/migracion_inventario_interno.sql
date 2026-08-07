-- =========================================================
-- MIGRACIÓN — inventario interno (consumo) separado del de vitrina
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- 1. Marca cada producto como "vitrina" (se vende/presta, genera pago) o
--    "interno" (insumos de uso profesional: bases, esmaltes... solo se
--    descuentan por consumo, sin ningún valor ni pago). Los productos que
--    ya existían quedan como "vitrina" (comportamiento igual que antes).
alter table public.productos
  add column if not exists tipo text not null default 'vitrina' check (tipo in ('vitrina', 'interno'));

-- 2. Consumo interno: no es una venta ni un préstamo (no tiene clienta,
--    monto ni medio de pago), solo descuenta stock para llevar el control
--    de lo que hay (ej. "se usó 1 base"). Ledger inmutable.
create table if not exists public.consumos_internos (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id),
  cantidad integer not null check (cantidad > 0),
  nota text,
  registrado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_consumos_internos_producto on public.consumos_internos(producto_id);

alter table public.consumos_internos enable row level security;

-- (Postgres no soporta "CREATE POLICY IF NOT EXISTS": se borran primero por
-- si ya existen, para que esta migración se pueda volver a correr sin error.)
drop policy if exists "admin registra consumo interno" on public.consumos_internos;
create policy "admin registra consumo interno"
  on public.consumos_internos for insert
  with check (public.es_admin() and registrado_por = auth.uid());

drop policy if exists "admin ve consumo interno" on public.consumos_internos;
create policy "admin ve consumo interno"
  on public.consumos_internos for select
  using (public.es_admin());

-- Nadie edita ni borra un consumo ya registrado (no se crean policies de update/delete).

create or replace function public.descontar_stock_consumo_interno()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock integer;
begin
  select stock into v_stock from public.productos where id = new.producto_id for update;
  if v_stock is null then
    raise exception 'Producto no encontrado.';
  end if;
  if v_stock < new.cantidad then
    raise exception 'No hay suficiente stock de este producto (disponible: %).', v_stock;
  end if;
  update public.productos set stock = stock - new.cantidad where id = new.producto_id;
  return new;
end;
$$;

drop trigger if exists trg_descontar_stock_consumo_interno on public.consumos_internos;
create trigger trg_descontar_stock_consumo_interno
  after insert on public.consumos_internos
  for each row execute function public.descontar_stock_consumo_interno();
