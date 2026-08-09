-- Corrige un bug real: admin_actualizar_acceso resolvía un "usuario corto"
-- (sin @) contra salones.dominio_interno (POR salón), pero el login
-- (normalizarCorreoOUsuario en src/lib/authDominio.ts) resuelve contra el
-- dominio COMPARTIDO cuentas.kallos.app -- cualquier cuenta a la que se le
-- cambiara el usuario a un nombre corto quedaba con un correo que el login
-- nunca podía reconstruir, dejándola sin poder volver a entrar.
create or replace function public.admin_actualizar_acceso(
  p_user_id uuid,
  p_nuevo_usuario text default null,
  p_nueva_password text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_email text;
  v_salon_objetivo uuid;
begin
  if not public.es_super() then
    raise exception 'Solo la dueña puede cambiar el acceso de un usuario.';
  end if;

  select salon_id into v_salon_objetivo from public.profiles where id = p_user_id;
  if v_salon_objetivo is null or v_salon_objetivo is distinct from public.mi_salon() then
    raise exception 'Ese usuario no pertenece a tu salón.';
  end if;

  if p_nuevo_usuario is not null and length(trim(p_nuevo_usuario)) > 0 then
    v_email := lower(trim(p_nuevo_usuario));
    if position('@' in v_email) = 0 then
      v_email := v_email || '@cuentas.kallos.app';
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
