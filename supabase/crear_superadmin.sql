-- =========================================================
-- OBSOLETO en KALLOS multi-tenant: este script asume el esquema de un solo
-- salón (sin salon_id). Úsalo solo si estás trabajando contra el proyecto
-- Supabase ORIGINAL de Yessica Arango (single-tenant). Para dar de alta un
-- salón nuevo en KALLOS, usa supabase/crear_salon_superadmin.sql.
-- =========================================================

-- =========================================================
-- Crear el usuario SUPERADMIN
-- =========================================================
-- Nota importante: por seguridad, un usuario NO se crea desde SQL con su
-- contraseña. Se crea desde el panel de Supabase y luego este script lo
-- "promueve" a superadmin. Pasos:
--
-- 1. Supabase Dashboard -> Authentication -> Users -> "Add user".
--       Email:    superadmin@yessica-arango.app
--       Password: (elige una contraseña y guardala en un lugar seguro)
--       Marca la casilla "Auto Confirm User" (para no depender de un correo real).
--
--    (En la app se inicia sesión escribiendo solo el usuario "Superadmin" y la
--     contraseña; la app le agrega sola el dominio interno @yessica-arango.app.)
--
-- 2. Al crear ese usuario, el trigger de la base de datos le crea un perfil con
--    rol 'cliente'. Ejecuta este script en el SQL Editor para volverlo superadmin:

update public.profiles
set rol = 'superadmin',
    nombre = 'Superadmin',
    activo = true
where id = (
  select id from auth.users
  where email = 'superadmin@yessica-arango.app'
);

-- 3. Verifica:
select p.nombre, p.rol, u.email
from public.profiles p
join auth.users u on u.id = p.id
where u.email = 'superadmin@yessica-arango.app';

-- =========================================================
-- SEGURIDAD: nunca escribas la contraseña real dentro de este archivo (el
-- repositorio es público). Guarda la contraseña en un gestor seguro y, si crees
-- que se filtró, cambiala en Authentication -> Users -> el usuario -> "Reset password".
-- Desde el usuario Superadmin ya puedes crear/promover a la dueña, la
-- administradora y las manicuristas en la pantalla "Usuarios" de la app.
-- =========================================================
