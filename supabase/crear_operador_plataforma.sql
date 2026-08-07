-- =========================================================
-- Crear un OPERADOR DE PLATAFORMA (dueño de KALLOS / Vulpex)
-- =========================================================
-- El operador administra la plataforma completa desde la Consola KALLOS
-- (/plataforma en la app): ve todos los salones, crea salones nuevos,
-- suspende, cambia planes. NO es el superadmin de un salón cliente.
--
-- Su perfil vive en un salón especial "KALLOS Plataforma" (activo=false
-- para que no resuelva públicamente ni acepte registro de clientas).
--
-- PASO 1: crear el salón de plataforma (solo la primera vez):
--
--   insert into public.salones (nombre, slug, dominio_interno, activo)
--   values ('KALLOS Plataforma', 'plataforma', 'plataforma.kallos.app', false)
--   returning id;
--
-- Copia el "id" -- lo necesitas en el paso 2.
--
-- PASO 2: crear el usuario del operador.
--   Supabase Dashboard (o Studio local) -> Authentication -> Users -> "Add user"
--     Email:    tu-correo@kallos.app  (o el que uses de verdad)
--     Password: (elige una y guardala en un gestor seguro)
--     "Auto Confirm User": marcado.
--     En "User Metadata" (JSON), con el id del paso 1:
--       {"salon_id": "PEGA-AQUI-EL-ID-DEL-PASO-1", "nombre": "Tu Nombre"}
--
-- PASO 3: volverlo operador. Reemplaza el correo y ejecuta:

insert into public.plataforma_operadores (user_id, nota)
select id, 'Operador fundador'
from auth.users
where email = 'PEGA-AQUI-EL-CORREO-DEL-PASO-2'
on conflict (user_id) do nothing;

-- (Opcional pero recomendado) que dentro de su salón de plataforma sea
-- superadmin, para que el Layout no lo trate como clienta:
update public.profiles
set rol = 'superadmin', activo = true
where id = (select id from auth.users where email = 'PEGA-AQUI-EL-CORREO-DEL-PASO-2');

-- Verifica (debe salir 1 fila con es_operador = true):
select u.email, p.nombre, p.rol, s.nombre as salon,
       exists(select 1 from public.plataforma_operadores o where o.user_id = u.id) as es_operador
from auth.users u
join public.profiles p on p.id = u.id
join public.salones s on s.id = p.salon_id
where u.email = 'PEGA-AQUI-EL-CORREO-DEL-PASO-2';

-- =========================================================
-- SEGURIDAD: la tabla plataforma_operadores NO tiene policy de escritura --
-- solo se agregan/quitan operadores desde acá (SQL) o con service-role,
-- nunca desde la app. Para revocar un operador:
--   delete from public.plataforma_operadores where user_id = (select id from auth.users where email = '...');
-- =========================================================
