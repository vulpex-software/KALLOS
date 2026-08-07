-- =========================================================
-- MIGRACIÓN — Clientas por cédula (NUIP / CC)
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- La clienta se registra con su cédula; al crear la cuenta, guardamos la cédula
-- en el perfil para poder buscarla después al agendar.
-- =========================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nombre, telefono, cedula, rol)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nombre', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data->>'telefono', ''),
    nullif(new.raw_user_meta_data->>'cedula', ''),
    'cliente'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- (Opcional) evita dos clientas con la misma cédula.
create unique index if not exists profiles_cedula_unica
  on public.profiles (cedula) where cedula is not null;
