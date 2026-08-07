-- =========================================================
-- MIGRACIÓN Bloque B — Varios servicios por cita
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez, después de la A)
-- =========================================================

-- Lista de servicios de la cita (además del principal servicio_id).
alter table public.citas
  add column if not exists servicios_ids uuid[] not null default '{}';

-- El trigger de inmutabilidad debe proteger también la lista de servicios.
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

  return new;
end;
$$;
