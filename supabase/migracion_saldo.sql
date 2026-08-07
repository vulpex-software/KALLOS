-- =========================================================
-- MIGRACIÓN — Saldo / excedente de la cita
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- Cuando la profesional completa una cita con abono, registra el saldo cobrado
-- (monto + medio de pago). El abono sigue protegido; el saldo se registra una vez.
-- =========================================================

alter table public.citas
  add column if not exists saldo_pagado numeric(12,2) not null default 0,
  add column if not exists saldo_metodo_pago text
    check (saldo_metodo_pago is null or saldo_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono'));

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

  if old.estado <> 'pendiente' then
    -- Congelada, salvo estado, motivo y el saldo (que se registra al completar).
    if new.empleada_id is distinct from old.empleada_id
       or new.servicio_id is distinct from old.servicio_id
       or new.servicios_ids is distinct from old.servicios_ids
       or new.cliente_nombre is distinct from old.cliente_nombre
       or new.cliente_telefono is distinct from old.cliente_telefono
       or new.fecha is distinct from old.fecha
       or new.hora is distinct from old.hora
       or new.abono is distinct from old.abono
       or new.abono_metodo_pago is distinct from old.abono_metodo_pago
       or new.obsequio is distinct from old.obsequio
       or new.nota is distinct from old.nota
    then
      raise exception 'Una cita ya confirmada no se puede modificar; solo se puede cambiar su estado.';
    end if;
  else
    if old.empleada_id is not null and new.empleada_id is distinct from old.empleada_id then
      raise exception 'La manicurista asignada no se puede cambiar; cancela la cita y crea otra.';
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
