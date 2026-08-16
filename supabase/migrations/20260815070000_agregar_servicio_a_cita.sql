-- Una clienta agenda hoy y días después pide un servicio más ("ya que
-- estoy, hazme también las cejas"). El trigger congelaba servicios_ids en
-- cuanto la cita pasaba a confirmada, así que no había forma de agregarlo:
-- tocaba cancelar y volver a agendar, perdiendo el abono registrado.
--
-- Criterio nuevo: lo que se le VA A HACER a la clienta (servicios,
-- adicional, obsequios, nota) queda ajustable hasta que la atiendan. QUIÉN
-- es y CUÁNTO abonó sigue congelado al confirmar, igual que antes. Nada se
-- puede tocar una vez completada o cancelada.
--
-- De paso corrige un bug latente: el modal de confirmar/reprogramar deja
-- cambiar los obsequios, pero el trigger los rechazaba para una cita ya
-- confirmada -- o sea que cambiar un obsequio al reprogramar reventaba.
create or replace function public.bloquear_edicion_cita()
returns trigger
language plpgsql
as $$
begin
  -- Datos de origen: SIEMPRE inmutables.
  if new.salon_id is distinct from old.salon_id
     or new.creado_por is distinct from old.creado_por
     or new.created_at is distinct from old.created_at
     or new.cliente_id is distinct from old.cliente_id
  then
    raise exception 'No se pueden modificar los datos de origen de una cita.';
  end if;

  -- Cita ya atendida o cancelada: TODO queda congelado, es registro histórico.
  if old.estado in ('completada', 'cancelada') then
    if new.empleada_id is distinct from old.empleada_id then
      raise exception 'No se puede cambiar la profesional de una cita completada o cancelada.';
    end if;
    if new.fecha is distinct from old.fecha
       or new.hora is distinct from old.hora
       or new.hora_fin is distinct from old.hora_fin
    then
      raise exception 'No se puede reprogramar una cita ya completada o cancelada.';
    end if;
    if new.servicio_id is distinct from old.servicio_id
       or new.servicios_ids is distinct from old.servicios_ids
       or new.obsequios is distinct from old.obsequios
       or new.nota is distinct from old.nota
       or new.adicional_concepto is distinct from old.adicional_concepto
       or new.adicional_valor is distinct from old.adicional_valor
    then
      raise exception 'No se pueden cambiar los servicios de una cita ya completada o cancelada.';
    end if;
  end if;

  -- Si se reprograma una cita YA confirmada, se marca para avisar en la
  -- campanita (la dueña/admin la revisa y la marca como vista).
  if old.estado = 'confirmada' and (
       new.fecha is distinct from old.fecha
       or new.hora is distinct from old.hora
       or new.hora_fin is distinct from old.hora_fin
     ) then
    new.reprogramada := true;
  end if;

  -- Cita ya confirmada: se congela QUIÉN es y CUÁNTO abonó. Lo que se le va a
  -- hacer sigue ajustable (ver la nota de arriba).
  if old.estado <> 'pendiente' then
    if new.cliente_nombre is distinct from old.cliente_nombre
       or new.cliente_telefono is distinct from old.cliente_telefono
       or new.abono is distinct from old.abono
       or new.abono_metodo_pago is distinct from old.abono_metodo_pago
       or (new.abono_foto_url is distinct from old.abono_foto_url and new.abono_foto_url is not null)
    then
      raise exception 'De una cita ya confirmada no se puede cambiar la clienta ni el abono.';
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
