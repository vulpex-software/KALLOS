-- =========================================================
-- MIGRACIÓN — Bloque P: arreglar "Actualizar acceso"
-- Error visto: "No se pudo actualizar: function gen_salt(unknown) does
-- not exist". En Supabase, pgcrypto (gen_salt/crypt) vive en el esquema
-- "extensions", no en "public", y la función no lo tenía en su
-- search_path, así que nunca encontraba gen_salt/crypt.
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
-- =========================================================

alter function public.admin_actualizar_acceso(uuid, text, text)
  set search_path = public, auth, extensions;
