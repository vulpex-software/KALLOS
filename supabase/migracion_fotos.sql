-- =========================================================
-- MIGRACIÓN — Compresión + retención de fotos (1 mes)
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- La foto de evidencia se borra 1 mes después; el registro de la clienta
-- atendida queda para siempre (solo se pone foto_url en NULL).
-- =========================================================

-- 1) Permitir que admin/superadmin borren fotos del bucket de evidencias.
create policy "gestor borra evidencias"
  on storage.objects for delete
  using (bucket_id = 'evidencias' and public.es_admin());

-- 2) Permitir poner foto_url en NULL (limpiar la foto) sin cambiarla por otra.
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
     or (new.foto_url is distinct from old.foto_url and new.foto_url is not null)
     or new.nota is distinct from old.nota
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Los datos de un trabajo ya registrado no se pueden modificar. Solo se puede anular.';
  end if;
  return new;
end;
$$;
