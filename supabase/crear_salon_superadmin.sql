-- =========================================================
-- Crear un salón nuevo + su primer SUPERADMIN
-- =========================================================
-- No hay onboarding self-serve todavía (ver CLAUDE.md, roadmap multi-tenant).
-- Dar de alta un salón nuevo en KALLOS son estos 3 pasos manuales:
--
-- PASO 1: crear la fila del salón. Ejecuta esto en el SQL Editor
-- (reemplaza nombre/slug/dominio_interno por los del salón real; slug y
-- dominio_interno deben ser únicos en toda la plataforma):
--
--   insert into public.salones (nombre, slug, dominio_interno)
--   values ('Nombre del Salón', 'nombre-del-salon', 'nombre-del-salon.kallos.app')
--   returning id;
--
-- Copia el "id" que devuelve -- lo necesitas en el paso 2.
--
-- PASO 2: crear el usuario del superadmin desde el Dashboard de Supabase
-- (por seguridad, un usuario NO se crea desde SQL con su contraseña):
--
--   Supabase Dashboard -> Authentication -> Users -> "Add user"
--     Email:    superadmin@nombre-del-salon.kallos.app  (o el dominio_interno que usaste)
--     Password: (elige una contraseña y guardala en un lugar seguro)
--     Marca la casilla "Auto Confirm User".
--     En "User Metadata" (JSON) pega EXACTAMENTE esto, con el id del paso 1:
--       {"salon_id": "PEGA-AQUI-EL-ID-DEL-PASO-1", "nombre": "Superadmin"}
--
--   El trigger handle_new_user() exige salon_id en los metadatos -- si no
--   lo pones, la creación del usuario falla.
--
-- PASO 3: promover ese perfil a superadmin. Reemplaza el correo por el que
-- usaste en el paso 2 y ejecuta:

update public.profiles
set rol = 'superadmin',
    activo = true
where id = (
  select id from auth.users
  where email = 'superadmin@nombre-del-salon.kallos.app'
);

-- Verifica que quedó bien (debe salir el salón, el rol y el correo correctos):
select s.nombre as salon, p.nombre, p.rol, u.email
from public.profiles p
join auth.users u on u.id = p.id
join public.salones s on s.id = p.salon_id
where u.email = 'superadmin@nombre-del-salon.kallos.app';

-- =========================================================
-- SEGURIDAD: nunca escribas la contraseña real dentro de este archivo (el
-- repositorio puede volverse público). Guarda la contraseña en un gestor
-- seguro y, si crees que se filtró, cambiala en Authentication -> Users ->
-- el usuario -> "Reset password".
--
-- Desde ese usuario Superadmin ya se puede crear/promover al resto del
-- personal de ESE salón en la pantalla "Usuarios" de la app -- cada alta
-- hecha desde ahí hereda automáticamente el salon_id del superadmin que la
-- crea, no hace falta repetir este proceso salvo para el primer usuario de
-- cada salón nuevo.
--
-- (Opcional) catálogo de obsequios por defecto para el salón nuevo -- el
-- esquema no trae ninguno preseeded (cada salón es independiente). Si
-- quieres arrancar con los mismos de ejemplo del salón original, corre esto
-- reemplazando el uuid por el id del paso 1 y por el id de un perfil
-- superadmin ya creado (paso 3):
--
--   insert into public.obsequios (salon_id, nombre, creado_por) values
--     ('PEGA-AQUI-EL-ID-DEL-PASO-1', 'Veloterapia', 'PEGA-AQUI-EL-ID-DEL-SUPERADMIN'),
--     ('PEGA-AQUI-EL-ID-DEL-PASO-1', 'Chocolaterapia', 'PEGA-AQUI-EL-ID-DEL-SUPERADMIN');
-- =========================================================
