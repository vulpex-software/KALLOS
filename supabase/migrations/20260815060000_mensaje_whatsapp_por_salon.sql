-- El bloque "Importante" del mensaje de WhatsApp (sin niños, sin bicicletas,
-- puntualidad) venía escrito fijo en el código, heredado del salón original
-- de una sola dueña. Con KALLOS multi-salón eso significaba que TODOS los
-- salones clientes le mandaban a sus clientas la política de otro negocio.
-- Ahora cada salón guarda la suya; en null se usa el texto por defecto que
-- vive en src/lib/whatsapp.ts.
alter table public.salones
  add column if not exists mensaje_importante text;

-- Cierra una puerta que estaba abierta: la policy de UPDATE sobre salones
-- para el superadmin no puede restringir columnas, así que un salón podía
-- cambiarse su propio `plan` (y desbloquear el branding de Pro) o ponerse
-- `activo = true` estando suspendido, desde la consola del navegador con su
-- propia sesión. Nada en el frontend usaba esa policy -- los cambios de
-- plan/activo los hace el operador desde la Consola -- así que quitarla no
-- rompe nada. Lo que el salón sí puede editar de lo suyo pasa por RPCs que
-- tocan una sola columna, como el de abajo.
drop policy if exists "superadmin edita su propio salon" on public.salones;

create or replace function public.actualizar_mensaje_importante(p_texto text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_super() then
    raise exception 'Solo la dueña puede cambiar el mensaje del salón.';
  end if;
  if length(coalesce(p_texto, '')) > 2000 then
    raise exception 'El mensaje es demasiado largo (máximo 2000 caracteres).';
  end if;
  -- Vacío se guarda como null a propósito: así vuelve al texto por defecto
  -- en vez de dejar el bloque "Importante" en blanco.
  update public.salones
    set mensaje_importante = nullif(btrim(p_texto), '')
    where id = public.mi_salon();
end;
$$;

grant execute on function public.actualizar_mensaje_importante(text) to authenticated, service_role;
