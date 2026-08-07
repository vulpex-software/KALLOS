-- =========================================================
-- MIGRACIÓN — Bloque G: la dueña (superadmin) puede cambiar el usuario
-- de acceso (correo interno) y la contraseña de cualquier persona,
-- sin pasar por el Dashboard de Supabase.
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

create extension if not exists pgcrypto;

create or replace function public.admin_actualizar_acceso(
  p_user_id uuid,
  p_nuevo_usuario text default null,
  p_nueva_password text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
begin
  if not public.es_super() then
    raise exception 'Solo la dueña puede cambiar el acceso de un usuario.';
  end if;

  if p_nuevo_usuario is not null and length(trim(p_nuevo_usuario)) > 0 then
    v_email := lower(trim(p_nuevo_usuario));
    if position('@' in v_email) = 0 then
      v_email := v_email || '@yessica-arango.app';
    end if;
    update auth.users set email = v_email where id = p_user_id;
  end if;

  if p_nueva_password is not null and length(p_nueva_password) > 0 then
    if length(p_nueva_password) < 6 then
      raise exception 'La contraseña debe tener al menos 6 caracteres.';
    end if;
    update auth.users set encrypted_password = crypt(p_nueva_password, gen_salt('bf')) where id = p_user_id;
  end if;
end;
$$;

grant execute on function public.admin_actualizar_acceso(uuid, text, text) to authenticated;
