-- =========================================================
-- MIGRACIÓN — nota_interna en citas + tabla push_subscriptions
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- 1. Campo nota_interna: solo la dueña/admin lo escribe; las profesionales lo leen.
--    Siempre editable por admin/superadmin, sin importar el estado de la cita.
alter table public.citas
  add column if not exists nota_interna text;

-- 2. Tabla para guardar las suscripciones push de cada profesional.
create table if not exists public.push_subscriptions (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  subscription text not null,
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

-- Cada usuario solo puede leer y escribir su propia suscripción.
-- (Postgres no soporta "CREATE POLICY IF NOT EXISTS": se borra primero por
-- si ya existe, para que esta migración se pueda volver a correr sin error.)
drop policy if exists "push_own" on public.push_subscriptions;
create policy "push_own"
  on public.push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. Actualizar el trigger bloquear_edicion_cita para que nota_interna
--    sea siempre editable (no se congela con el resto cuando el estado != pendiente).
create or replace function public.bloquear_edicion_cita()
returns trigger
language plpgsql
as $$
begin
  -- Datos de origen: SIEMPRE inmutables.
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

  -- Fecha/hora se pueden reprogramar mientras la cita no esté completada ni cancelada.
  if old.estado in ('completada', 'cancelada') and (
       new.fecha is distinct from old.fecha
       or new.hora is distinct from old.hora
       or new.hora_fin is distinct from old.hora_fin
     ) then
    raise exception 'No se puede reprogramar una cita ya completada o cancelada.';
  end if;

  -- Si se reprograma una cita YA confirmada, se marca para avisar en la campanita.
  if old.estado = 'confirmada' and (
       new.fecha is distinct from old.fecha
       or new.hora is distinct from old.hora
       or new.hora_fin is distinct from old.hora_fin
     ) then
    new.reprogramada := true;
  end if;

  if old.estado <> 'pendiente' then
    -- Cita ya confirmada/completada/cancelada: los datos se congelan,
    -- EXCEPTO estado, profesional, fecha/hora, saldo, reprogramación y nota_interna.
    if new.servicio_id is distinct from old.servicio_id
       or new.servicios_ids is distinct from old.servicios_ids
       or new.cliente_nombre is distinct from old.cliente_nombre
       or new.cliente_telefono is distinct from old.cliente_telefono
       or new.abono is distinct from old.abono
       or new.abono_metodo_pago is distinct from old.abono_metodo_pago
       or (new.abono_foto_url is distinct from old.abono_foto_url and new.abono_foto_url is not null)
       or new.obsequio is distinct from old.obsequio
       or new.nota is distinct from old.nota
       or new.adicional_concepto is distinct from old.adicional_concepto
       or new.adicional_valor is distinct from old.adicional_valor
    then
      raise exception 'Una cita ya confirmada no se puede modificar; solo estado, profesional, fecha/hora, saldo y nota interna.';
    end if;
  end if;

  -- El saldo se registra UNA vez (de 0 a un valor). Después queda fijo.
  if old.saldo_pagado <> 0 and (
       new.saldo_pagado is distinct from old.saldo_pagado
       or new.saldo_metodo_pago is distinct from old.saldo_metodo_pago
     ) then
    raise exception 'El saldo de esta cita ya fue registrado.';
  end if;

  return new;
end;
$$;
