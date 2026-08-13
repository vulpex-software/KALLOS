-- El trigger de alta de usuarios no leía "apellidos" de los metadatos --
-- necesario ahora que el autorregistro de clientas pide nombre y apellido
-- por separado (antes era un solo "nombre completo").
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salon_id uuid;
  v_rol text;
begin
  v_salon_id := nullif(new.raw_user_meta_data->>'salon_id', '')::uuid;
  if v_salon_id is null then
    raise exception 'Falta salon_id en los metadatos del nuevo usuario.';
  end if;

  perform 1 from public.salones where id = v_salon_id for update;

  v_rol := case
    when exists (select 1 from public.profiles where salon_id = v_salon_id)
    then 'cliente'
    else 'superadmin'
  end;

  insert into public.profiles (id, salon_id, nombre, apellidos, telefono, cedula, rol)
  values (
    new.id,
    v_salon_id,
    coalesce(nullif(new.raw_user_meta_data->>'nombre', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data->>'apellidos', ''),
    nullif(new.raw_user_meta_data->>'telefono', ''),
    nullif(new.raw_user_meta_data->>'cedula', ''),
    v_rol
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
