-- =========================================================
-- MIGRACIÓN Bloque E — Agenda y disponibilidad
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

-- Duración de cada servicio en minutos (para bloquear el horario)
alter table public.servicios
  add column if not exists duracion_minutos integer not null default 30;

-- Hora de término de la cita (inicio + duración de los servicios)
alter table public.citas
  add column if not exists hora_fin time;

-- La clienta puede elegir profesional al pedir su cita (ya no se exige nula)
drop policy if exists "clienta solicita su propia cita" on public.citas;
create policy "clienta solicita su propia cita"
  on public.citas for insert
  with check (
    public.mi_rol() = 'cliente'
    and creado_por = auth.uid()
    and cliente_id = auth.uid()
    and abono = 0
  );

-- Trigger: la profesional se puede cambiar mientras la cita no esté completada ni
-- cancelada; hora_fin queda protegida como los demás datos.
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

-- Función: profesionales disponibles (personal activo SIN cruce en ese rango).
-- security definer: puede mirar todas las citas sin exponerlas a la clienta.
create or replace function public.profesionales_disponibles(p_fecha date, p_desde time, p_hasta time)
returns table (id uuid, nombre text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.nombre
  from public.profiles p
  where p.rol = 'personal' and p.activo = true
    and not exists (
      select 1 from public.citas c
      where c.empleada_id = p.id
        and c.fecha = p_fecha
        and c.estado <> 'cancelada'
        and c.hora < p_hasta
        and coalesce(c.hora_fin, c.hora) > p_desde
    )
  order by p.nombre;
$$;

grant execute on function public.profesionales_disponibles(date, time, time) to anon, authenticated;
