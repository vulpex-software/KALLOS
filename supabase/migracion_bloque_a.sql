-- =========================================================
-- MIGRACIÓN Bloque A — Dinero
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- Cambios:
--   #2 medios de pago -> efectivo / nequi / daviplata / datafono
--   #3 las especialistas NO registran medio de pago en sus trabajos
--   #5 descuento por porcentaje en los trabajos
--   #1 medio de pago del abono en las citas
--   cierre de caja con los 4 medios + comparación por total
-- =========================================================

-- ---- registros_trabajo: método de pago opcional + descuento ----
alter table public.registros_trabajo
  alter column metodo_pago drop not null;

-- quitar el check viejo (efectivo/transferencia/tarjeta) y permitir los nuevos o null
alter table public.registros_trabajo
  drop constraint if exists registros_trabajo_metodo_pago_check;
alter table public.registros_trabajo
  add constraint registros_trabajo_metodo_pago_check
  check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono'));

alter table public.registros_trabajo
  add column if not exists descuento_porcentaje numeric(5,2) not null default 0
    check (descuento_porcentaje >= 0 and descuento_porcentaje <= 100);

-- ---- citas: medio de pago del abono ----
alter table public.citas
  add column if not exists abono_metodo_pago text
    check (abono_metodo_pago is null or abono_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono'));

-- El trigger de inmutabilidad de citas debe permitir/proteger el nuevo campo:
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

-- ---- cierres_caja: 4 medios de pago ----
alter table public.cierres_caja
  add column if not exists nequi_reportado numeric(12,2) not null default 0,
  add column if not exists daviplata_reportado numeric(12,2) not null default 0,
  add column if not exists datafono_reportado numeric(12,2) not null default 0;

-- columnas viejas ya no se usan (no se borran para no perder datos previos;
-- si el cierre estaba vacío puedes ignorarlas)
alter table public.cierres_caja
  alter column transferencias_reportadas set default 0,
  alter column tarjeta_reportada set default 0;

-- ---- Vista de comparación: ahora por TOTAL del día ----
-- (las especialistas ya no registran medio de pago, así que comparamos el total
--  de servicios realizados contra el total reportado en el cierre de caja)
drop view if exists public.vista_comparacion_diaria;
create view public.vista_comparacion_diaria as
select
  coalesce(r.fecha, c.fecha) as fecha,
  coalesce(r.total, 0) as total_registrado,
  coalesce(c.total, 0) as total_reportado,
  coalesce(r.total, 0) - coalesce(c.total, 0) as diferencia
from (
  select created_at::date as fecha, sum(precio_cobrado) as total
  from public.registros_trabajo
  where not anulado
  group by created_at::date
) r
full outer join (
  select fecha,
         sum(efectivo_entregado + nequi_reportado + daviplata_reportado
             + datafono_reportado + transferencias_reportadas + tarjeta_reportada) as total
  from public.cierres_caja
  group by fecha
) c on r.fecha = c.fecha
order by fecha desc;
