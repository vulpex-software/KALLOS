-- =========================================================
-- MIGRACIÓN Bloque F — Cuentas por cobrar (la administradora cobra)
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
--
-- Nuevo flujo de dinero:
--   1. La profesional registra el trabajo (sin tocar dinero).
--   2. Se genera una "cuenta por cobrar" que ve la administradora.
--   3. La administradora cobra: elige el medio de pago y sube la foto del pago.
--   4. El cierre de caja suma lo cobrado por cada medio.
-- Además: la clienta, al pedir cita, registra su abono con medio de pago
-- y foto del comprobante.
-- =========================================================

-- ---------------------------------------------------------
-- 1. registros_trabajo: agrupar servicios de una misma visita
--    (visita_id agrupa; cita_id enlaza si vino de una cita agendada)
-- ---------------------------------------------------------
alter table public.registros_trabajo
  add column if not exists visita_id uuid,
  add column if not exists cita_id uuid references public.citas(id);

create index if not exists idx_registros_visita on public.registros_trabajo(visita_id);

-- El trigger de inmutabilidad ahora también congela visita_id y cita_id.
create or replace function public.bloquear_edicion_registro_trabajo()
returns trigger
language plpgsql
as $$
begin
  if new.empleada_id is distinct from old.empleada_id
     or new.servicio_id is distinct from old.servicio_id
     or new.precio_cobrado is distinct from old.precio_cobrado
     or new.metodo_pago is distinct from old.metodo_pago
     or new.cliente_nombre is distinct from old.cliente_nombre
     or new.cliente_telefono is distinct from old.cliente_telefono
     -- Se permite BORRAR la foto (ponerla en NULL) por la retención de 1 mes,
     -- pero no cambiarla por otra.
     or (new.foto_url is distinct from old.foto_url and new.foto_url is not null)
     or new.nota is distinct from old.nota
     or new.visita_id is distinct from old.visita_id
     or new.cita_id is distinct from old.cita_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Los datos de un trabajo ya registrado no se pueden modificar. Solo se puede anular.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------
-- 2. Tabla de cobros: lo que la administradora recibe de la clienta.
--    Un cobro pertenece a una visita (grupo de trabajos registrados).
--    Puede haber más de un cobro por visita (ej: mitad efectivo, mitad Nequi).
-- ---------------------------------------------------------
create table if not exists public.cobros (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid not null,
  monto numeric(12,2) not null check (monto > 0),
  metodo_pago text not null check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  -- Foto del comprobante del pago (obligatoria en la app para pagos digitales).
  foto_url text,
  nota text,
  cobrado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_cobros_visita on public.cobros(visita_id);

alter table public.cobros enable row level security;

-- Solo admin y superadmin manejan cobros.
drop policy if exists "admin registra cobros" on public.cobros;
create policy "admin registra cobros"
  on public.cobros for insert
  with check (public.es_admin() and cobrado_por = auth.uid());

drop policy if exists "admin ve cobros" on public.cobros;
create policy "admin ve cobros"
  on public.cobros for select
  using (public.es_admin());

-- Sin policy de UPDATE ni DELETE: un cobro registrado no se toca (anti-fraude).
-- Excepción: se permite limpiar la foto por la retención de 1 mes.
drop policy if exists "gestor limpia foto de cobro" on public.cobros;
create policy "gestor limpia foto de cobro"
  on public.cobros for update
  using (public.es_gestor())
  with check (public.es_gestor());

create or replace function public.bloquear_edicion_cobro()
returns trigger
language plpgsql
as $$
begin
  if new.visita_id is distinct from old.visita_id
     or new.monto is distinct from old.monto
     or new.metodo_pago is distinct from old.metodo_pago
     or (new.foto_url is distinct from old.foto_url and new.foto_url is not null)
     or new.nota is distinct from old.nota
     or new.cobrado_por is distinct from old.cobrado_por
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Un cobro registrado no se puede modificar.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bloquear_edicion_cobro on public.cobros;
create trigger trg_bloquear_edicion_cobro
  before update on public.cobros
  for each row execute function public.bloquear_edicion_cobro();

drop trigger if exists trg_auditoria_cobros on public.cobros;
create trigger trg_auditoria_cobros
  after insert or update on public.cobros
  for each row execute function public.registrar_auditoria();

-- ---------------------------------------------------------
-- 3. Citas: foto del comprobante del abono (la clienta la sube al pedir cita)
-- ---------------------------------------------------------
alter table public.citas
  add column if not exists abono_foto_url text;

-- La clienta ahora SÍ registra su abono (monto + medio + foto) al pedir la cita.
drop policy if exists "clienta solicita su propia cita" on public.citas;
create policy "clienta solicita su propia cita"
  on public.citas for insert
  with check (
    public.mi_rol() = 'cliente'
    and creado_por = auth.uid()
    and cliente_id = auth.uid()
  );

-- Trigger de citas: congela también la foto del abono cuando ya no está pendiente
-- (permitiendo solo limpiarla a NULL por la retención de fotos).
create or replace function public.bloquear_edicion_cita()
returns trigger
language plpgsql
as $$
begin
  if new.creado_por is distinct from old.creado_por
     or new.created_at is distinct from old.created_at
     or new.cliente_id is distinct from old.cliente_id
  then
    raise exception 'No se pueden modificar los datos de origen de una cita.';
  end if;

  -- La profesional solo se congela cuando la cita ya está completada o cancelada.
  if old.estado in ('completada', 'cancelada') and new.empleada_id is distinct from old.empleada_id then
    raise exception 'No se puede cambiar la profesional de una cita completada o cancelada.';
  end if;

  if old.estado <> 'pendiente' then
    if new.servicio_id is distinct from old.servicio_id
       or new.servicios_ids is distinct from old.servicios_ids
       or new.cliente_nombre is distinct from old.cliente_nombre
       or new.cliente_telefono is distinct from old.cliente_telefono
       or new.fecha is distinct from old.fecha
       or new.hora is distinct from old.hora
       or new.hora_fin is distinct from old.hora_fin
       or new.abono is distinct from old.abono
       or new.abono_metodo_pago is distinct from old.abono_metodo_pago
       or (new.abono_foto_url is distinct from old.abono_foto_url and new.abono_foto_url is not null)
       or new.obsequio is distinct from old.obsequio
       or new.nota is distinct from old.nota
    then
      raise exception 'Una cita ya confirmada no se puede modificar; solo estado, profesional y saldo.';
    end if;
  end if;

  if old.saldo_pagado <> 0 and (
       new.saldo_pagado is distinct from old.saldo_pagado
       or new.saldo_metodo_pago is distinct from old.saldo_metodo_pago
     ) then
    raise exception 'El saldo de esta cita ya fue registrado.';
  end if;

  return new;
end;
$$;
