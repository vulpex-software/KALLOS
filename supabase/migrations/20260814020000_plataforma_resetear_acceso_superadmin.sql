-- Soporte: el operador restablece el usuario/contraseña de la dueña de un
-- salón cliente (ej. si quedó bloqueada y no hay nadie más en ese salón que
-- pueda cambiárselo). Resuelve el superadmin activo más antiguo del salón
-- (mismo criterio que "Entrar como"). Mismo dominio compartido que el login.
create or replace function public.plataforma_resetear_acceso_superadmin(
  p_salon_id uuid,
  p_nuevo_usuario text default null,
  p_nueva_password text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid;
  v_email text;
begin
  if not public.es_operador() then
    raise exception 'Solo un operador de plataforma puede hacer esto.';
  end if;

  select id into v_user_id
    from public.profiles
    where salon_id = p_salon_id and rol = 'superadmin' and activo = true
    order by created_at asc
    limit 1;
  if v_user_id is null then
    raise exception 'Ese salón no tiene un superadmin activo.';
  end if;

  if p_nuevo_usuario is not null and length(trim(p_nuevo_usuario)) > 0 then
    v_email := lower(trim(p_nuevo_usuario));
    if position('@' in v_email) = 0 then
      v_email := v_email || '@cuentas.kallos.app';
    end if;
    update auth.users set email = v_email where id = v_user_id;
  end if;

  if p_nueva_password is not null and length(p_nueva_password) > 0 then
    if length(p_nueva_password) < 6 then
      raise exception 'La contraseña debe tener al menos 6 caracteres.';
    end if;
    update auth.users set encrypted_password = crypt(p_nueva_password, gen_salt('bf')) where id = v_user_id;
  end if;
end;
$$;

grant execute on function public.plataforma_resetear_acceso_superadmin(uuid, text, text) to authenticated;
