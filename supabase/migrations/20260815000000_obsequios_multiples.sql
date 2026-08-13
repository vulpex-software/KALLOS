-- Una cita podía tener un solo obsequio (texto); ahora puede tener varios.
alter table public.citas add column obsequios text[] not null default '{}';
update public.citas set obsequios = array[obsequio] where obsequio is not null and obsequio <> '';
alter table public.citas drop column obsequio;

-- El trigger de inmutabilidad referenciaba la columna vieja -- se reescribe
-- completo (mismo cuerpo, solo obsequio -> obsequios) para no perder
-- ninguna de las demás reglas.
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

  -- La profesional solo se congela cuando la cita ya está completada o cancelada
  -- (antes se puede asignar o cambiar).
  if old.estado in ('completada', 'cancelada') and new.empleada_id is distinct from old.empleada_id then
    raise exception 'No se puede cambiar la profesional de una cita completada o cancelada.';
  end if;

  -- Fecha/hora se pueden reprogramar (la clienta cambia de opinión o hubo un
  -- error) mientras la cita no esté completada ni cancelada. Una vez asistida
  -- o cancelada, quedan congeladas como registro histórico.
  if old.estado in ('completada', 'cancelada') and (
       new.fecha is distinct from old.fecha
       or new.hora is distinct from old.hora
       or new.hora_fin is distinct from old.hora_fin
     ) then
    raise exception 'No se puede reprogramar una cita ya completada o cancelada.';
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

  if old.estado <> 'pendiente' then
    -- Cita ya confirmada/completada/cancelada: los datos quedan congelados
    -- (salvo estado, profesional, fecha/hora, aviso de reprogramación, saldo
    -- y nota_interna, que la dueña/admin puede seguir editando siempre).
    if new.servicio_id is distinct from old.servicio_id
       or new.servicios_ids is distinct from old.servicios_ids
       or new.cliente_nombre is distinct from old.cliente_nombre
       or new.cliente_telefono is distinct from old.cliente_telefono
       or new.abono is distinct from old.abono
       or new.abono_metodo_pago is distinct from old.abono_metodo_pago
       or (new.abono_foto_url is distinct from old.abono_foto_url and new.abono_foto_url is not null)
       or new.obsequios is distinct from old.obsequios
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
