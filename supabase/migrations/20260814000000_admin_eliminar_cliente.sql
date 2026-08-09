-- Borrar una cuenta de clienta (no de personal, ver nota en schema.sql).
-- Borra auth.users, que en cascada se lleva profiles. Si la clienta ya
-- tiene citas o créditos registrados, la base de datos rechaza el borrado
-- por la FK -- el frontend lo traduce a un mensaje claro.
create or replace function public.admin_eliminar_cliente(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_salon uuid;
  v_rol text;
begin
  if not public.es_super() then
    raise exception 'Solo la dueña puede eliminar una cuenta.';
  end if;

  select salon_id, rol into v_salon, v_rol from public.profiles where id = p_user_id;
  if v_salon is null or v_salon is distinct from public.mi_salon() then
    raise exception 'Esa cuenta no pertenece a tu salón.';
  end if;
  if v_rol <> 'cliente' then
    raise exception 'Solo se pueden eliminar cuentas de clientas.';
  end if;

  delete from auth.users where id = p_user_id;
end;
$$;

grant execute on function public.admin_eliminar_cliente(uuid) to authenticated;
