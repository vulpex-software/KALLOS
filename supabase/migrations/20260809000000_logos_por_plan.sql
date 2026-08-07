-- =========================================================
-- Branding por plan: logo propio del cliente (Pro/Enterprise). En Básico
-- siempre se ve la marca KALLOS por defecto, sin importar lo que tenga
-- guardado color_primario/logo_url -- el gate por plan vive en el
-- FRONTEND (src/lib/branding.ts, src/lib/theme.ts), esto solo habilita
-- que el operador pueda subir el archivo.
-- =========================================================

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- Bucket público: la descarga no pasa por RLS (necesario para mostrar el
-- logo en pantallas sin sesión, como el autoregistro de clientas por
-- slug). Solo el operador puede subir/reemplazar/borrar.
drop policy if exists "operador administra logos" on storage.objects;
create policy "operador administra logos"
  on storage.objects for all
  using (bucket_id = 'logos' and public.es_operador())
  with check (bucket_id = 'logos' and public.es_operador());
