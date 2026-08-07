-- =========================================================
-- MIGRACIÓN — Bloque I: Inventario (productos) + Ventas de vitrina, y
-- préstamos de insumo enlazados a un producto (descuentan del inventario).
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- ---------------------------------------------------------
-- Productos (inventario). Se crean "poco a poco": solo la dueña
-- (superadmin) da de alta productos, precios y ajusta el stock.
-- ---------------------------------------------------------
create table public.productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  precio_venta numeric(12,2) not null default 0 check (precio_venta >= 0),
  costo numeric(12,2) check (costo is null or costo >= 0),
  stock integer not null default 0 check (stock >= 0),
  activo boolean not null default true,
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.productos enable row level security;

create policy "gestor administra productos"
  on public.productos for all
  using (public.es_super())
  with check (public.es_super());

create policy "admin ve productos"
  on public.productos for select
  using (public.es_admin());

create trigger trg_auditoria_productos
  after insert or update on public.productos
  for each row execute function public.registrar_auditoria();

-- ---------------------------------------------------------
-- Ventas: venta de un producto de la vitrina a una clienta o cualquier
-- persona (distinto del fiado a empleadas, que sigue siendo por Préstamos).
-- Descuenta el stock automáticamente. Inmutable salvo anulación.
-- ---------------------------------------------------------
create table public.ventas (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id),
  cantidad integer not null check (cantidad > 0),
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),
  total numeric(12,2) not null check (total >= 0),
  cliente_nombre text,
  metodo_pago text not null check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  foto_url text,
  nota text,
  vendido_por uuid not null references public.profiles(id),
  anulado boolean not null default false,
  motivo_anulacion text,
  anulado_por uuid references public.profiles(id),
  anulado_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.ventas enable row level security;

create policy "admin registra ventas"
  on public.ventas for insert
  with check (public.es_admin() and vendido_por = auth.uid());

create policy "admin ve ventas"
  on public.ventas for select
  using (public.es_admin());

create policy "gestor anula ventas"
  on public.ventas for update
  using (public.es_gestor())
  with check (public.es_gestor());

-- Nadie borra una venta ya registrada (No se crea policy de DELETE).

create or replace function public.bloquear_edicion_venta()
returns trigger
language plpgsql
as $$
begin
  if new.producto_id is distinct from old.producto_id
     or new.cantidad is distinct from old.cantidad
     or new.precio_unitario is distinct from old.precio_unitario
     or new.total is distinct from old.total
     or new.cliente_nombre is distinct from old.cliente_nombre
     or new.metodo_pago is distinct from old.metodo_pago
     or (new.foto_url is distinct from old.foto_url and new.foto_url is not null)
     or new.nota is distinct from old.nota
     or new.vendido_por is distinct from old.vendido_por
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Los datos de una venta ya registrada no se pueden modificar. Solo se puede anular.';
  end if;
  return new;
end;
$$;

create trigger trg_bloquear_edicion_venta
  before update on public.ventas
  for each row execute function public.bloquear_edicion_venta();

create trigger trg_auditoria_ventas
  after insert or update on public.ventas
  for each row execute function public.registrar_auditoria();

-- Descuenta el stock al registrar la venta (con bloqueo de fila para evitar
-- que dos ventas simultáneas dejen el stock en negativo).
create or replace function public.descontar_stock_venta()
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

create trigger trg_descontar_stock_venta
  after insert on public.ventas
  for each row execute function public.descontar_stock_venta();

-- Si se anula una venta, el producto vuelve al inventario.
create or replace function public.restaurar_stock_venta_anulada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.anulado = true and old.anulado = false then
    update public.productos set stock = stock + old.cantidad where id = old.producto_id;
  end if;
  return new;
end;
$$;

create trigger trg_restaurar_stock_venta_anulada
  after update on public.ventas
  for each row execute function public.restaurar_stock_venta_anulada();

-- ---------------------------------------------------------
-- Préstamos de insumo enlazados a un producto: al fiarle un insumo a una
-- empleada, si se elige un producto del inventario, se descuenta el stock.
-- ---------------------------------------------------------
alter table public.prestamos
  add column if not exists producto_id uuid references public.productos(id),
  add column if not exists cantidad integer check (cantidad is null or cantidad > 0);

create or replace function public.descontar_stock_prestamo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock integer;
begin
  if new.producto_id is null then
    return new;
  end if;
  select stock into v_stock from public.productos where id = new.producto_id for update;
  if v_stock is null then
    raise exception 'Producto no encontrado.';
  end if;
  if v_stock < coalesce(new.cantidad, 1) then
    raise exception 'No hay suficiente stock de este producto (disponible: %).', v_stock;
  end if;
  update public.productos set stock = stock - coalesce(new.cantidad, 1) where id = new.producto_id;
  return new;
end;
$$;

create trigger trg_descontar_stock_prestamo
  after insert on public.prestamos
  for each row execute function public.descontar_stock_prestamo();
