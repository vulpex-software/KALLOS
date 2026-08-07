-- =========================================================
-- KALLOS - Esquema multi-tenant (Postgres + RLS)
-- Cada salón ("tenant") es una fila de public.salones. Prácticamente
-- toda tabla de negocio tiene salon_id, y cada policy de RLS exige
-- además `salon_id = public.mi_salon()` junto al chequeo de rol que ya
-- existía. Esta es la parte más fácil de hacer mal: si al agregar una
-- tabla nueva se te olvida el salon_id o el chequeo en su policy, esa
-- tabla queda visible entre salones.
-- Ejecutar completo en: Supabase Dashboard > SQL Editor (proyecto nuevo,
-- vacío -- no está pensado para correr sobre una base ya poblada).
-- =========================================================

-- ---------------------------------------------------------
-- 0a. Permisos base de los roles de Supabase sobre el esquema public.
--     En Supabase Cloud el SQL Editor los hereda por default privileges,
--     pero el runner de migraciones del CLI local crea los objetos con otro
--     rol y sin esto la API REST responde "permission denied" aunque las
--     policies de RLS estén bien (RLS filtra filas, pero primero hace falta
--     el GRANT a nivel de tabla). Van al principio Y al final del archivo:
--     acá para el esquema, y al final el "grant all on all tables" que
--     cubre todo lo creado en este archivo.
-- ---------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------
-- 0. Salones (tenants). Cada salón que compra KALLOS es una fila acá.
-- ---------------------------------------------------------
create table public.salones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  -- Para URLs propias del salón (ej. link de autoregistro de clientas) y,
  -- más adelante, subdominios reales (clienta.kallos.app).
  slug text not null unique,
  -- Dominio usado para convertir un "usuario corto" en un correo válido de
  -- Supabase Auth en flujos donde ya se conoce el salón de antemano (ver
  -- admin_actualizar_acceso). El login de personal por usuario corto NO usa
  -- esto todavía (ver src/lib/authDominio.ts) -- eso queda para cuando haya
  -- subdominios o selector de salón en el login.
  dominio_interno text not null unique,
  activo boolean not null default true,
  plan text not null default 'basico' check (plan in ('basico', 'pro', 'enterprise')),
  -- Branding por salón (opcional). Si color_primario es NULL, el frontend
  -- usa el negro+dorado por defecto de la plataforma.
  color_primario text,
  color_secundario text,
  logo_url text,
  eslogan text,
  created_at timestamptz not null default now()
);

alter table public.salones enable row level security;

-- Necesario para resolver slug -> salon_id ANTES de tener sesión (login,
-- autoregistro de clientas por link del salón).
create policy "cualquiera lee salones activos"
  on public.salones for select
  using (activo = true);

-- La policy de UPDATE de salones (superadmin edita su propio salon) se crea
-- más abajo, después de definir es_super()/mi_salon() -- esas funciones
-- dependen de public.profiles, que todavía no existe en este punto.

-- ---------------------------------------------------------
-- 1. Perfiles (uno por usuario de auth.users)
-- ---------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  salon_id uuid not null references public.salones(id),
  nombre text not null,
  -- Rol = nivel de acceso (permisos):
  --   superadmin -> la dueña / control total
  --   admin      -> gestiona al personal, su horario y las citas, cierre de caja
  --   personal   -> profesional del servicio (marca su jornada, registra trabajos)
  --   cliente    -> se registra y pide citas
  rol text not null default 'cliente'
    check (rol in ('superadmin', 'admin', 'personal', 'cliente')),
  -- Especialidades del personal (SOLO una etiqueta, NO limita qué se le asigna):
  -- una misma persona puede tener varias, p.ej. {'manicurista','estilista'}.
  especialidades text[] not null default '{}',
  telefono text,
  -- Datos básicos (los llena la dueña/admin; la especialista no los edita).
  apellidos text,
  direccion text,
  cedula text,
  correo text,
  fecha_nacimiento date,
  fecha_ingreso date,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_profiles_salon on public.profiles(salon_id);

alter table public.profiles enable row level security;

create or replace function public.mi_rol()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select rol from public.profiles where id = auth.uid()
$$;

-- Salón del usuario autenticado. Mismo patrón/garantías que mi_rol(): al ser
-- security definer, su select interno a profiles no dispara la RLS de
-- profiles (no hay recursión), igual que ya pasaba con mi_rol().
create or replace function public.mi_salon()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select salon_id from public.profiles where id = auth.uid()
$$;

-- Super = control total (la dueña de ESE salón, no de todos).
create or replace function public.es_super()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.mi_rol() = 'superadmin'
$$;

-- Policy de salones diferida desde la sección 0 (necesitaba es_super()/mi_salon()).
create policy "superadmin edita su propio salon"
  on public.salones for update
  using (public.es_super() and id = public.mi_salon())
  with check (public.es_super() and id = public.mi_salon());

-- Admin operativo = superadmin + admin (gestionan personal, horarios y citas).
create or replace function public.es_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.mi_rol() in ('superadmin', 'admin')
$$;

-- "Gestor" (control total) se mantiene como alias de superadmin para las áreas
-- más sensibles: precios, anulaciones, cierres de caja y auditoría.
create or replace function public.es_gestor()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.mi_rol() = 'superadmin'
$$;

-- Cuando alguien crea su cuenta (auth.users), se le crea automáticamente su
-- perfil con rol 'cliente'. El salon_id es OBLIGATORIO y viene en los
-- metadatos del signUp (raw_user_meta_data) -- no hay onboarding self-serve
-- todavía, así que todo alta (clienta, personal, admin) pasa por un flujo
-- del frontend que ya sabe a qué salón pertenece (ver CLAUDE.md / README).
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

  -- Serializa altas concurrentes contra el MISMO salón nuevo (alta
  -- self-serve): sin este lock, dos signUp() simultáneos podrían ver
  -- ambos "sin perfiles todavía" y los dos quedar como superadmin.
  perform 1 from public.salones where id = v_salon_id for update;

  -- El primer perfil de un salón nuevo es su superadmin automáticamente
  -- (necesario para el alta self-serve: nadie lo promueve a mano). Los
  -- altas siguientes (Usuarios.tsx, Citas.tsx, RegistroCliente.tsx) ya
  -- ocurren sobre un salón que ya tiene perfiles, así que siguen
  -- quedando 'cliente' como antes.
  v_rol := case
    when exists (select 1 from public.profiles where salon_id = v_salon_id)
    then 'cliente'
    else 'superadmin'
  end;

  insert into public.profiles (id, salon_id, nombre, telefono, cedula, rol)
  values (
    new.id,
    v_salon_id,
    coalesce(nullif(new.raw_user_meta_data->>'nombre', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data->>'telefono', ''),
    nullif(new.raw_user_meta_data->>'cedula', ''),
    v_rol
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "cada usuario ve su propio perfil"
  on public.profiles for select
  using (id = auth.uid());

create policy "admin ve todos los perfiles de su salon"
  on public.profiles for select
  using (public.es_admin() and salon_id = public.mi_salon());

-- El superadmin cambia cualquier rol; el admin solo puede tocar perfiles de
-- personal/clientas (activar, especialidades) — no a otros admins ni superadmins.
-- Ambos casos, siempre dentro de su propio salón.
create policy "gestor administra perfiles de su salon"
  on public.profiles for update
  using (
    salon_id = public.mi_salon()
    and (public.es_super() or (public.mi_rol() = 'admin' and rol in ('personal', 'cliente')))
  )
  with check (
    salon_id = public.mi_salon()
    and (public.es_super() or (public.mi_rol() = 'admin' and rol in ('personal', 'cliente')))
  );

create policy "gestor crea perfiles en su salon"
  on public.profiles for insert
  with check (public.es_admin() and salon_id = public.mi_salon());

-- Necesario para poder elegir a la profesional al agendar/asignar una cita:
-- cualquier usuario logueado puede ver al PERSONAL activo de SU salón
-- (no de otro salón, ni a otras clientas).
create policy "usuarios autenticados ven personal activo de su salon"
  on public.profiles for select
  using (activo = true and rol in ('personal', 'admin', 'superadmin') and salon_id = public.mi_salon());

-- ---------------------------------------------------------
-- 2. Servicios ofrecidos (catálogo, por salón)
-- ---------------------------------------------------------
create table public.servicios (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  categoria text not null,
  nombre text not null,
  precio_base numeric(12,2) not null default 0,
  duracion_minutos integer not null default 30,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (salon_id, categoria, nombre)
);

create index idx_servicios_salon on public.servicios(salon_id);

alter table public.servicios enable row level security;

create policy "cualquier usuario autenticado lee servicios de su salon"
  on public.servicios for select
  using (auth.uid() is not null and salon_id = public.mi_salon());

create policy "solo gestor administra servicios de su salon"
  on public.servicios for all
  using (public.es_gestor() and salon_id = public.mi_salon())
  with check (public.es_gestor() and salon_id = public.mi_salon());

-- ---------------------------------------------------------
-- 2b. Productos (inventario, por salón). Se crean "poco a poco": solo la
--     dueña (superadmin) de cada salón da de alta productos, precios y
--     ajusta el stock.
-- ---------------------------------------------------------
create table public.productos (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  -- vitrina = se vende/presta a clientas o al personal (genera un pago).
  -- interno = insumos de uso profesional (bases, esmaltes...); solo se
  -- descuentan por consumo, sin ningún valor ni pago asociado.
  tipo text not null default 'vitrina' check (tipo in ('vitrina', 'interno')),
  nombre text not null,
  descripcion text,
  precio_venta numeric(12,2) not null default 0 check (precio_venta >= 0),
  costo numeric(12,2) check (costo is null or costo >= 0),
  stock integer not null default 0 check (stock >= 0),
  activo boolean not null default true,
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_productos_salon on public.productos(salon_id);

alter table public.productos enable row level security;

create policy "gestor administra productos de su salon"
  on public.productos for all
  using (public.es_super() and salon_id = public.mi_salon())
  with check (public.es_super() and salon_id = public.mi_salon());

create policy "admin ve productos de su salon"
  on public.productos for select
  using (public.es_admin() and salon_id = public.mi_salon());

-- ---------------------------------------------------------
-- 2c. Obsequios (catálogo de cortesías, ej. Veloterapia). Solo la dueña
--     (superadmin) de cada salón puede agregar más. No hay seed global acá
--     -- cada salón nuevo arranca con su catálogo vacío y lo llena desde la
--     app (o se puede insertar a mano en el bootstrap del salón, ver
--     supabase/crear_salon_superadmin.sql).
-- ---------------------------------------------------------
create table public.obsequios (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  nombre text not null,
  activo boolean not null default true,
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (salon_id, nombre)
);

create index idx_obsequios_salon on public.obsequios(salon_id);

alter table public.obsequios enable row level security;

create policy "gestor administra obsequios de su salon"
  on public.obsequios for all
  using (public.es_super() and salon_id = public.mi_salon())
  with check (public.es_super() and salon_id = public.mi_salon());

create policy "admin ve obsequios de su salon"
  on public.obsequios for select
  using (public.es_admin() and salon_id = public.mi_salon());

-- ---------------------------------------------------------
-- 3. Registros de trabajo (el corazón del control)
--    Estos registros son INMUTABLES: nadie puede editar
--    los datos del trabajo ni borrarlos. Solo la dueña
--    puede marcarlos como "anulado" dejando rastro.
-- ---------------------------------------------------------
create table public.registros_trabajo (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  empleada_id uuid not null references public.profiles(id),
  servicio_id uuid not null references public.servicios(id),
  precio_cobrado numeric(12,2) not null check (precio_cobrado >= 0),
  descuento_porcentaje numeric(5,2) not null default 0 check (descuento_porcentaje >= 0 and descuento_porcentaje <= 100),
  -- Las especialistas NO reciben pagos, así que no registran medio de pago
  -- (queda opcional; el medio de pago lo maneja Admin en cita/cierre de caja).
  metodo_pago text check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  cliente_nombre text,
  cliente_telefono text,
  foto_url text,
  nota text,
  -- visita_id agrupa los servicios registrados juntos para una misma clienta;
  -- la administradora cobra la visita completa (tabla cobros). No tiene FK,
  -- así que salon_id no se puede derivar de ahí -- lo manda el frontend
  -- (siempre el salon_id del perfil de quien registra).
  visita_id uuid,
  -- cita_id enlaza el registro con la cita agendada (si vino de una).
  -- (La FK se agrega más abajo, después de crear la tabla citas.)
  cita_id uuid,
  anulado boolean not null default false,
  motivo_anulacion text,
  anulado_por uuid references public.profiles(id),
  anulado_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_registros_trabajo_salon on public.registros_trabajo(salon_id);

alter table public.registros_trabajo enable row level security;

create policy "empleada crea sus propios registros"
  on public.registros_trabajo for insert
  with check (empleada_id = auth.uid() and salon_id = public.mi_salon());

create policy "empleada ve sus propios registros"
  on public.registros_trabajo for select
  using (empleada_id = auth.uid());

create policy "admin y super ven todos los registros de su salon"
  on public.registros_trabajo for select
  using (public.es_admin() and salon_id = public.mi_salon());

-- Solo la dueña / superadmin puede anular (nunca editar precio/servicio/cliente)
create policy "gestor puede anular registros de su salon"
  on public.registros_trabajo for update
  using (public.es_gestor() and salon_id = public.mi_salon())
  with check (public.es_gestor() and salon_id = public.mi_salon());

-- Nadie puede borrar un registro de trabajo, ni siquiera la dueña.
-- (No se crea policy de DELETE => queda bloqueado por RLS)

-- Trigger: impide modificar los datos del trabajo ya creado.
-- Solo permite tocar las columnas de anulación.
create or replace function public.bloquear_edicion_registro_trabajo()
returns trigger
language plpgsql
as $$
begin
  if new.salon_id is distinct from old.salon_id
     or new.empleada_id is distinct from old.empleada_id
     or new.servicio_id is distinct from old.servicio_id
     or new.precio_cobrado is distinct from old.precio_cobrado
     or new.metodo_pago is distinct from old.metodo_pago
     or new.cliente_nombre is distinct from old.cliente_nombre
     or new.cliente_telefono is distinct from old.cliente_telefono
     -- Se permite BORRAR la foto (ponerla en NULL) por la retención de 1 mes,
     -- pero no cambiarla por otra.
     or (new.foto_url is distinct from old.foto_url and new.foto_url is not null)
     or new.nota is distinct from old.nota
     or new.visita_id is distinct from old.visita_id
     or new.cita_id is distinct from old.cita_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Los datos de un trabajo ya registrado no se pueden modificar. Solo se puede anular.';
  end if;
  return new;
end;
$$;

create trigger trg_bloquear_edicion_registro_trabajo
  before update on public.registros_trabajo
  for each row execute function public.bloquear_edicion_registro_trabajo();

-- ---------------------------------------------------------
-- 4. Citas (agenda). El abono es dinero cobrado por adelantado,
--    así que se protege igual que los registros de trabajo:
--    nadie puede editar sus datos financieros ni borrarla, solo
--    cambiar el estado (confirmar / completar / cancelar).
-- ---------------------------------------------------------
create table public.citas (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  -- empleada_id es NULL mientras es una "solicitud" sin manicurista asignada
  -- (por ejemplo cuando la clienta la pide desde la app). El gestor/admin la asigna.
  empleada_id uuid references public.profiles(id),
  servicio_id uuid not null references public.servicios(id),
  -- lista completa de servicios de la cita (una clienta puede pedir varios)
  servicios_ids uuid[] not null default '{}',
  -- cliente_id apunta al perfil de la clienta cuando ella misma se registró y
  -- pidió la cita. Si la agenda el personal a nombre de alguien externo, queda NULL.
  cliente_id uuid references public.profiles(id),
  cliente_nombre text not null,
  cliente_telefono text,
  fecha date not null,
  -- Horario de atención del salón: 9:00am a 8:00pm. Ninguna cita puede
  -- agendarse fuera de este rango, sin importar desde dónde se cree.
  hora time not null check (hora >= '09:00' and hora <= '20:00'),
  -- Sin tope de hora_fin: la hora de INICIO debe caer en el horario de
  -- atención, pero un servicio que empieza cerca del cierre puede terminar
  -- después (ej: empieza 7pm, dura 2 horas, termina 9pm).
  hora_fin time,
  abono numeric(12,2) not null default 0,
  abono_metodo_pago text check (abono_metodo_pago is null or abono_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  -- Foto del comprobante del abono (la clienta la sube al pedir la cita).
  abono_foto_url text,
  -- Saldo/excedente cobrado al completar la cita (además del abono).
  saldo_pagado numeric(12,2) not null default 0,
  saldo_metodo_pago text check (saldo_metodo_pago is null or saldo_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  obsequio text,
  nota text,
  -- Nota privada de la dueña/admin para la profesional asignada (recomendaciones,
  -- indicaciones especiales). Nunca se le muestra a la clienta.
  nota_interna text,
  -- Cuando se pide el servicio "Adicional" (monto y concepto libre, ej. un
  -- diseño de uñas especial), aquí se guarda el nombre y el valor que la
  -- clienta o el personal escribieron al agendar.
  adicional_concepto text,
  adicional_valor numeric(12,2) check (adicional_valor is null or adicional_valor >= 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'confirmada', 'completada', 'cancelada')),
  motivo_cancelacion text,
  -- Se marca en true cuando se reprograma (cambia fecha/hora) una cita ya
  -- confirmada, para avisar en la campanita. Se apaga al "marcar como visto".
  reprogramada boolean not null default false,
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_citas_salon on public.citas(salon_id);

alter table public.citas enable row level security;

-- Solo admin/super agendan citas. Las especialistas NO crean ni gestionan citas;
-- únicamente completan la suya al registrar el trabajo (eso es un UPDATE).
create policy "staff agenda citas de su salon"
  on public.citas for insert
  with check (
    creado_por = auth.uid()
    and salon_id = public.mi_salon()
    and public.mi_rol() in ('admin', 'superadmin')
  );

-- La clienta solo puede crear SOLICITUDES para ella misma. Registra su abono
-- (monto + medio de pago + foto del comprobante) al pedir la cita.
create policy "clienta solicita su propia cita"
  on public.citas for insert
  with check (
    public.mi_rol() = 'cliente'
    and creado_por = auth.uid()
    and cliente_id = auth.uid()
    and salon_id = public.mi_salon()
  );

create policy "clienta ve sus propias citas"
  on public.citas for select
  using (cliente_id = auth.uid());

create policy "empleada ve sus propias citas"
  on public.citas for select
  using (empleada_id = auth.uid() or creado_por = auth.uid());

create policy "admin y super ven todas las citas de su salon"
  on public.citas for select
  using (public.es_admin() and salon_id = public.mi_salon());

-- El personal puede actualizar (asignar profesional, confirmar, completar,
-- cancelar). Los límites de qué se puede tocar los pone el trigger de abajo.
create policy "personal actualiza citas de su salon"
  on public.citas for update
  using ((empleada_id = auth.uid() or creado_por = auth.uid() or public.es_admin()) and salon_id = public.mi_salon())
  with check ((empleada_id = auth.uid() or creado_por = auth.uid() or public.es_admin()) and salon_id = public.mi_salon());

-- Nadie puede borrar una cita ya creada.
-- (No se crea policy de DELETE => queda bloqueado por RLS)

create or replace function public.bloquear_edicion_cita()
returns trigger
language plpgsql
as $$
begin
  -- Datos de origen: SIEMPRE inmutables.
  if new.salon_id is distinct from old.salon_id
     or new.creado_por is distinct from old.creado_por
     or new.created_at is distinct from old.created_at
     or new.cliente_id is distinct from old.cliente_id
  then
    raise exception 'No se pueden modificar los datos de origen de una cita.';
  end if;

  -- La profesional solo se congela cuando la cita ya está completada o cancelada
  -- (antes se puede asignar o cambiar).
  if old.estado in ('completada', 'cancelada') and new.empleada_id is distinct from old.empleada_id then
    raise exception 'No se puede cambiar la profesional de una cita completada o cancelada.';
  end if;

  -- Fecha/hora se pueden reprogramar (la clienta cambia de opinión o hubo un
  -- error) mientras la cita no esté completada ni cancelada. Una vez asistida
  -- o cancelada, quedan congeladas como registro histórico.
  if old.estado in ('completada', 'cancelada') and (
       new.fecha is distinct from old.fecha
       or new.hora is distinct from old.hora
       or new.hora_fin is distinct from old.hora_fin
     ) then
    raise exception 'No se puede reprogramar una cita ya completada o cancelada.';
  end if;

  -- Si se reprograma una cita YA confirmada, se marca para avisar en la
  -- campanita (la dueña/admin la revisa y la marca como vista).
  if old.estado = 'confirmada' and (
       new.fecha is distinct from old.fecha
       or new.hora is distinct from old.hora
       or new.hora_fin is distinct from old.hora_fin
     ) then
    new.reprogramada := true;
  end if;

  if old.estado <> 'pendiente' then
    -- Cita ya confirmada/completada/cancelada: los datos quedan congelados
    -- (salvo estado, profesional, fecha/hora, aviso de reprogramación, saldo
    -- y nota_interna, que la dueña/admin puede seguir editando siempre).
    if new.servicio_id is distinct from old.servicio_id
       or new.servicios_ids is distinct from old.servicios_ids
       or new.cliente_nombre is distinct from old.cliente_nombre
       or new.cliente_telefono is distinct from old.cliente_telefono
       or new.abono is distinct from old.abono
       or new.abono_metodo_pago is distinct from old.abono_metodo_pago
       or (new.abono_foto_url is distinct from old.abono_foto_url and new.abono_foto_url is not null)
       or new.obsequio is distinct from old.obsequio
       or new.nota is distinct from old.nota
       or new.adicional_concepto is distinct from old.adicional_concepto
       or new.adicional_valor is distinct from old.adicional_valor
    then
      raise exception 'Una cita ya confirmada no se puede modificar; solo estado, profesional, fecha/hora, saldo y nota interna.';
    end if;
  end if;

  -- El saldo se registra UNA vez (de 0 a un valor). Después queda fijo.
  if old.saldo_pagado <> 0 and (
       new.saldo_pagado is distinct from old.saldo_pagado
       or new.saldo_metodo_pago is distinct from old.saldo_metodo_pago
     ) then
    raise exception 'El saldo de esta cita ya fue registrado.';
  end if;

  return new;
end;
$$;

create trigger trg_bloquear_edicion_cita
  before update on public.citas
  for each row execute function public.bloquear_edicion_cita();

-- FK pendiente: registros_trabajo.cita_id (la tabla citas ya existe aquí).
alter table public.registros_trabajo
  add constraint registros_trabajo_cita_id_fkey
  foreign key (cita_id) references public.citas(id);

create index if not exists idx_registros_visita on public.registros_trabajo(visita_id);

-- ---------------------------------------------------------
-- 4b. Cobros: lo que la administradora recibe de la clienta.
--     La profesional NO toca dinero: al registrar el trabajo se genera una
--     "cuenta por cobrar" (la visita) y la administradora la cobra aquí,
--     eligiendo el medio de pago y subiendo la foto del pago.
--     Puede haber más de un cobro por visita (ej: mitad efectivo, mitad Nequi).
-- ---------------------------------------------------------
create table public.cobros (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  visita_id uuid not null,
  monto numeric(12,2) not null check (monto > 0),
  metodo_pago text not null check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  -- Foto del comprobante del pago (obligatoria en la app para pagos digitales).
  foto_url text,
  nota text,
  cobrado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_cobros_visita on public.cobros(visita_id);
create index idx_cobros_salon on public.cobros(salon_id);

alter table public.cobros enable row level security;

-- Solo admin y superadmin manejan cobros.
create policy "admin registra cobros de su salon"
  on public.cobros for insert
  with check (public.es_admin() and cobrado_por = auth.uid() and salon_id = public.mi_salon());

create policy "admin ve cobros de su salon"
  on public.cobros for select
  using (public.es_admin() and salon_id = public.mi_salon());

-- Sin policy de DELETE: un cobro registrado no se borra (anti-fraude).
-- El UPDATE solo existe para limpiar la foto (retención); el trigger lo limita.
create policy "gestor limpia foto de cobro de su salon"
  on public.cobros for update
  using (public.es_gestor() and salon_id = public.mi_salon())
  with check (public.es_gestor() and salon_id = public.mi_salon());

create or replace function public.bloquear_edicion_cobro()
returns trigger
language plpgsql
as $$
begin
  if new.salon_id is distinct from old.salon_id
     or new.visita_id is distinct from old.visita_id
     or new.monto is distinct from old.monto
     or new.metodo_pago is distinct from old.metodo_pago
     or (new.foto_url is distinct from old.foto_url and new.foto_url is not null)
     or new.nota is distinct from old.nota
     or new.cobrado_por is distinct from old.cobrado_por
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Un cobro registrado no se puede modificar.';
  end if;
  return new;
end;
$$;

create trigger trg_bloquear_edicion_cobro
  before update on public.cobros
  for each row execute function public.bloquear_edicion_cobro();

-- ---------------------------------------------------------
-- 5. Cierres de caja (lo que la administradora reporta/entrega)
-- ---------------------------------------------------------
create table public.cierres_caja (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  fecha date not null,
  administradora_id uuid not null references public.profiles(id),
  base numeric(12,2) not null default 0,
  efectivo_entregado numeric(12,2) not null default 0,
  nequi_reportado numeric(12,2) not null default 0,
  daviplata_reportado numeric(12,2) not null default 0,
  datafono_reportado numeric(12,2) not null default 0,
  -- Pago a proveedores hecho ese día (salida de caja).
  proveedor_monto numeric(12,2) not null default 0,
  proveedor_metodo_pago text check (proveedor_metodo_pago is null or proveedor_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  proveedor_nota text,
  observaciones text,
  created_at timestamptz not null default now(),
  unique (salon_id, fecha, administradora_id)
);

create index idx_cierres_caja_salon on public.cierres_caja(salon_id);

alter table public.cierres_caja enable row level security;

create policy "admin crea su cierre del dia en su salon"
  on public.cierres_caja for insert
  with check (administradora_id = auth.uid() and salon_id = public.mi_salon() and public.mi_rol() in ('admin', 'superadmin'));

create policy "administradora ve sus propios cierres"
  on public.cierres_caja for select
  using (administradora_id = auth.uid());

create policy "gestor ve todos los cierres de su salon"
  on public.cierres_caja for select
  using (public.es_gestor() and salon_id = public.mi_salon());

-- Un cierre de caja tampoco se edita ni se borra una vez creado:
-- si hay un error, se corrige con un nuevo registro y observaciones.
-- (No se crean policies de UPDATE/DELETE => quedan bloqueadas por RLS)

-- ---------------------------------------------------------
-- 5b. Marcaciones (control horario: entrada / almuerzo / salida)
--     Cada profesional marca su propia jornada. Los registros son
--     INMUTABLES (no se editan ni se borran) para que el horario sea confiable.
-- ---------------------------------------------------------
create table public.marcaciones (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  personal_id uuid not null references public.profiles(id),
  tipo text not null check (tipo in ('entrada', 'inicio_almuerzo', 'fin_almuerzo', 'salida')),
  momento timestamptz not null default now(),
  nota text,
  created_at timestamptz not null default now()
);

create index idx_marcaciones_salon on public.marcaciones(salon_id);

alter table public.marcaciones enable row level security;

-- Cada quien marca su propia jornada.
create policy "personal registra su propia marcacion"
  on public.marcaciones for insert
  with check (
    personal_id = auth.uid()
    and salon_id = public.mi_salon()
    and public.mi_rol() in ('personal', 'admin', 'superadmin')
  );

create policy "personal ve sus propias marcaciones"
  on public.marcaciones for select
  using (personal_id = auth.uid());

-- El admin y el superadmin ven la jornada de todo el personal de su salón.
create policy "admin ve todas las marcaciones de su salon"
  on public.marcaciones for select
  using (public.es_admin() and salon_id = public.mi_salon());

-- Nadie edita ni borra una marcación.
-- (No se crean policies de UPDATE/DELETE => quedan bloqueadas por RLS)

-- ---------------------------------------------------------
-- 5c. Permisos y descansos
-- ---------------------------------------------------------
create table public.permisos (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  persona_id uuid not null references public.profiles(id),
  tipo text not null default 'permiso' check (tipo in ('permiso', 'descanso')),
  fecha_desde date not null,
  fecha_hasta date not null,
  hora_desde time,
  hora_hasta time,
  motivo text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_permisos_salon on public.permisos(salon_id);

alter table public.permisos enable row level security;

create policy "persona solicita su permiso"
  on public.permisos for insert
  with check (persona_id = auth.uid() and creado_por = auth.uid() and salon_id = public.mi_salon());

create policy "persona ve sus permisos"
  on public.permisos for select
  using (persona_id = auth.uid());

create policy "admin ve todos los permisos de su salon"
  on public.permisos for select
  using (public.es_admin() and salon_id = public.mi_salon());

-- El superadmin puede registrar permisos/descansos para cualquier persona de su salón.
create policy "super registra permisos de cualquiera en su salon"
  on public.permisos for insert
  with check (public.es_super() and salon_id = public.mi_salon());

-- Aprobar/rechazar permisos: solo el superadmin, de su propio salón.
create policy "super gestiona permisos de su salon"
  on public.permisos for update
  using (public.es_super() and salon_id = public.mi_salon())
  with check (public.es_super() and salon_id = public.mi_salon());

-- ---------------------------------------------------------
-- 5d. Préstamos / insumos fiados a cada persona
-- ---------------------------------------------------------
create table public.prestamos (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  persona_id uuid not null references public.profiles(id),
  -- 'insumo' = insumo fiado de vitrina (con monto/medio de pago, genera
  -- deuda). 'insumo_interno' = insumo asignado del inventario interno, sin
  -- costo (no genera deuda, solo queda el registro de a quién y qué se dio).
  tipo text not null default 'dinero' check (tipo in ('dinero', 'insumo', 'insumo_interno')),
  descripcion text,
  monto numeric(12,2) not null default 0,
  metodo_pago text check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  pagado boolean not null default false,
  -- Si el insumo fiado es un producto del inventario, se enlaza aquí y se
  -- descuenta el stock automáticamente (ver trigger más abajo).
  producto_id uuid references public.productos(id),
  cantidad integer check (cantidad is null or cantidad > 0),
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_prestamos_salon on public.prestamos(salon_id);

alter table public.prestamos enable row level security;

create policy "super administra prestamos de su salon"
  on public.prestamos for all
  using (public.es_super() and salon_id = public.mi_salon())
  with check (public.es_super() and salon_id = public.mi_salon());

create policy "persona ve sus prestamos"
  on public.prestamos for select
  using (persona_id = auth.uid());

create policy "admin ve prestamos de su salon"
  on public.prestamos for select
  using (public.es_admin() and salon_id = public.mi_salon());

-- ---------------------------------------------------------
-- 5d-2. Pagos de préstamos (ledger): permite abonos parciales con medio de
--       pago para que el cierre de caja pueda reflejarlos. Inmutable: no hay
--       policy de update/delete, así que ningún pago se puede alterar.
--       salon_id se hereda del préstamo (no se confía en que el cliente lo
--       mande): así evitamos que alguien registre un pago de su salón contra
--       un préstamo de otro salón.
-- ---------------------------------------------------------
create table public.prestamo_pagos (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  prestamo_id uuid not null references public.prestamos(id),
  monto numeric(12,2) not null check (monto > 0),
  metodo_pago text not null check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  nota text,
  pagado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_prestamo_pagos_prestamo on public.prestamo_pagos(prestamo_id);
create index idx_prestamo_pagos_salon on public.prestamo_pagos(salon_id);

alter table public.prestamo_pagos enable row level security;

create or replace function public.heredar_salon_de_prestamo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select salon_id into new.salon_id from public.prestamos where id = new.prestamo_id;
  if new.salon_id is null then
    raise exception 'Préstamo no encontrado.';
  end if;
  return new;
end;
$$;

create trigger trg_heredar_salon_prestamo_pagos
  before insert on public.prestamo_pagos
  for each row execute function public.heredar_salon_de_prestamo();

create policy "super registra pagos de prestamo de su salon"
  on public.prestamo_pagos for insert
  with check (public.es_super() and pagado_por = auth.uid());

create policy "admin ve pagos de prestamo de su salon"
  on public.prestamo_pagos for select
  using (public.es_admin() and salon_id = public.mi_salon());

-- Descuenta el stock cuando el préstamo (insumo fiado) está enlazado a un
-- producto del inventario. Bloqueo de fila para evitar carreras. Es
-- security definer (salta RLS de productos), así que valida a mano que el
-- producto pertenezca al mismo salón que el préstamo -- si no, un salón
-- podría drenar el inventario de otro.
create or replace function public.descontar_stock_prestamo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock integer;
  v_salon_producto uuid;
begin
  if new.producto_id is null then
    return new;
  end if;
  select stock, salon_id into v_stock, v_salon_producto from public.productos where id = new.producto_id for update;
  if v_stock is null then
    raise exception 'Producto no encontrado.';
  end if;
  if v_salon_producto is distinct from new.salon_id then
    raise exception 'El producto no pertenece al mismo salón que el préstamo.';
  end if;
  if v_stock < coalesce(new.cantidad, 1) then
    raise exception 'No hay suficiente stock de este producto (disponible: %).', v_stock;
  end if;
  update public.productos set stock = stock - coalesce(new.cantidad, 1) where id = new.producto_id;
  return new;
end;
$$;

create trigger trg_descontar_stock_prestamo
  after insert on public.prestamos
  for each row execute function public.descontar_stock_prestamo();

-- ---------------------------------------------------------
-- 5d-3. Ventas: venta de un producto de la vitrina a una clienta o
--       cualquier persona (distinto del fiado a empleadas, que es por
--       Préstamos). Descuenta el stock automáticamente. Inmutable salvo
--       anulación (igual que registros_trabajo).
-- ---------------------------------------------------------
create table public.ventas (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  producto_id uuid not null references public.productos(id),
  cantidad integer not null check (cantidad > 0),
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),
  total numeric(12,2) not null check (total >= 0),
  cliente_nombre text,
  -- El pago real (uno o varios medios) se registra en venta_pagos, ver más
  -- abajo. Estas dos columnas quedan solo por compatibilidad con ventas viejas.
  metodo_pago text check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  foto_url text,
  nota text,
  vendido_por uuid not null references public.profiles(id),
  anulado boolean not null default false,
  motivo_anulacion text,
  anulado_por uuid references public.profiles(id),
  anulado_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_ventas_salon on public.ventas(salon_id);

alter table public.ventas enable row level security;

create policy "admin registra ventas de su salon"
  on public.ventas for insert
  with check (public.es_admin() and vendido_por = auth.uid() and salon_id = public.mi_salon());

create policy "admin ve ventas de su salon"
  on public.ventas for select
  using (public.es_admin() and salon_id = public.mi_salon());

create policy "gestor anula ventas de su salon"
  on public.ventas for update
  using (public.es_gestor() and salon_id = public.mi_salon())
  with check (public.es_gestor() and salon_id = public.mi_salon());

-- Nadie borra una venta ya registrada (No se crea policy de DELETE).

create or replace function public.bloquear_edicion_venta()
returns trigger
language plpgsql
as $$
begin
  if new.salon_id is distinct from old.salon_id
     or new.producto_id is distinct from old.producto_id
     or new.cantidad is distinct from old.cantidad
     or new.precio_unitario is distinct from old.precio_unitario
     or new.total is distinct from old.total
     or new.cliente_nombre is distinct from old.cliente_nombre
     or new.metodo_pago is distinct from old.metodo_pago
     or (new.foto_url is distinct from old.foto_url and new.foto_url is not null)
     or new.nota is distinct from old.nota
     or new.vendido_por is distinct from old.vendido_por
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Los datos de una venta ya registrada no se pueden modificar. Solo se puede anular.';
  end if;
  return new;
end;
$$;

create trigger trg_bloquear_edicion_venta
  before update on public.ventas
  for each row execute function public.bloquear_edicion_venta();

-- Descuenta el stock al registrar la venta (con bloqueo de fila para evitar
-- que dos ventas simultáneas dejen el stock en negativo). Security definer:
-- valida que el producto sea del mismo salón que la venta.
create or replace function public.descontar_stock_venta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock integer;
  v_salon_producto uuid;
begin
  select stock, salon_id into v_stock, v_salon_producto from public.productos where id = new.producto_id for update;
  if v_stock is null then
    raise exception 'Producto no encontrado.';
  end if;
  if v_salon_producto is distinct from new.salon_id then
    raise exception 'El producto no pertenece al mismo salón que la venta.';
  end if;
  if v_stock < new.cantidad then
    raise exception 'No hay suficiente stock de este producto (disponible: %).', v_stock;
  end if;
  update public.productos set stock = stock - new.cantidad where id = new.producto_id;
  return new;
end;
$$;

create trigger trg_descontar_stock_venta
  after insert on public.ventas
  for each row execute function public.descontar_stock_venta();

-- Si se anula una venta, el producto vuelve al inventario.
create or replace function public.restaurar_stock_venta_anulada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.anulado = true and old.anulado = false then
    update public.productos set stock = stock + old.cantidad where id = old.producto_id and salon_id = old.salon_id;
  end if;
  return new;
end;
$$;

create trigger trg_restaurar_stock_venta_anulada
  after update on public.ventas
  for each row execute function public.restaurar_stock_venta_anulada();

-- ---------------------------------------------------------
-- 5d-4. Pagos de una venta: permite pagar una sola venta con varios medios
--       (ej. mitad efectivo, mitad Nequi) en un solo formulario. Igual que
--       cobros: inmutable, cada línea con su propia foto si aplica.
--       salon_id se hereda de la venta (mismo motivo que prestamo_pagos).
-- ---------------------------------------------------------
create table public.venta_pagos (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  venta_id uuid not null references public.ventas(id),
  monto numeric(12,2) not null check (monto > 0),
  metodo_pago text not null check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  foto_url text,
  pagado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_venta_pagos_venta on public.venta_pagos(venta_id);
create index idx_venta_pagos_salon on public.venta_pagos(salon_id);

alter table public.venta_pagos enable row level security;

create or replace function public.heredar_salon_de_venta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select salon_id into new.salon_id from public.ventas where id = new.venta_id;
  if new.salon_id is null then
    raise exception 'Venta no encontrada.';
  end if;
  return new;
end;
$$;

create trigger trg_heredar_salon_venta_pagos
  before insert on public.venta_pagos
  for each row execute function public.heredar_salon_de_venta();

create policy "admin registra pagos de venta de su salon"
  on public.venta_pagos for insert
  with check (public.es_admin() and pagado_por = auth.uid());

create policy "admin ve pagos de venta de su salon"
  on public.venta_pagos for select
  using (public.es_admin() and salon_id = public.mi_salon());

-- ---------------------------------------------------------
-- 5e. Disponibilidad de profesionales (para evitar cruces de horario).
--     Se usa desde flujos SIN sesión (autoregistro de clienta pidiendo
--     cita), así que mi_salon() no sirve -- recibe el salón explícito,
--     resuelto en el frontend por el slug de la URL del salón.
-- ---------------------------------------------------------
create or replace function public.profesionales_disponibles(p_salon_id uuid, p_fecha date, p_desde time, p_hasta time)
returns table (id uuid, nombre text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.nombre
  from public.profiles p
  where p.rol = 'personal' and p.activo = true and p.salon_id = p_salon_id
    and not exists (
      select 1 from public.citas c
      where c.empleada_id = p.id
        and c.salon_id = p_salon_id
        and c.fecha = p_fecha
        and c.estado <> 'cancelada'
        and c.hora < p_hasta
        and coalesce(c.hora_fin, c.hora) > p_desde
    )
  order by p.nombre;
$$;

grant execute on function public.profesionales_disponibles(uuid, date, time, time) to anon, authenticated;

-- ---------------------------------------------------------
-- 6. Auditoría (registro inmutable de toda la actividad, por salón)
-- ---------------------------------------------------------
create table public.auditoria (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  tabla text not null,
  registro_id uuid not null,
  accion text not null,
  usuario_id uuid references public.profiles(id),
  detalle jsonb,
  created_at timestamptz not null default now()
);

create index idx_auditoria_salon on public.auditoria(salon_id);

alter table public.auditoria enable row level security;

create policy "solo gestor lee auditoria de su salon"
  on public.auditoria for select
  using (public.es_gestor() and salon_id = public.mi_salon());

-- Guarda salon_id como columna propia (no solo dentro de detalle jsonb) para
-- poder filtrar auditoria sin desempacar JSON. Toma el salon_id de la fila
-- auditada (new/old ya lo tienen, porque toda tabla auditada tiene salon_id).
create or replace function public.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.auditoria (salon_id, tabla, registro_id, accion, usuario_id, detalle)
  values (
    coalesce(new.salon_id, old.salon_id),
    tg_table_name,
    coalesce(new.id, old.id),
    tg_op,
    auth.uid(),
    to_jsonb(coalesce(new, old))
  );
  return coalesce(new, old);
end;
$$;

create trigger trg_auditoria_registros_trabajo
  after insert or update on public.registros_trabajo
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_cierres_caja
  after insert on public.cierres_caja
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_citas
  after insert or update on public.citas
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_cobros
  after insert or update on public.cobros
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_marcaciones
  after insert on public.marcaciones
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_permisos
  after insert or update on public.permisos
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_prestamos
  after insert or update on public.prestamos
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_prestamo_pagos
  after insert on public.prestamo_pagos
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_productos
  after insert or update on public.productos
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_obsequios
  after insert or update on public.obsequios
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_ventas
  after insert or update on public.ventas
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_venta_pagos
  after insert on public.venta_pagos
  for each row execute function public.registrar_auditoria();

-- ---------------------------------------------------------
-- 7. Vista de comparación diaria (para el dashboard y alertas)
--    Compara el TOTAL de servicios realizados contra el TOTAL reportado
--    en el cierre de caja (las especialistas ya no registran medio de pago).
--    No necesita salon_id propio: al ser una vista normal (no
--    security-definer), Postgres sigue aplicando la RLS de
--    registros_trabajo/cierres_caja según quién la consulte -- cada quien ya
--    ve solo lo de su salón por las policies de esas dos tablas.
-- ---------------------------------------------------------
create or replace view public.vista_comparacion_diaria as
select
  coalesce(r.fecha, c.fecha) as fecha,
  coalesce(r.total, 0) as total_registrado,
  coalesce(c.total, 0) as total_reportado,
  coalesce(r.total, 0) - coalesce(c.total, 0) as diferencia
from (
  select (created_at at time zone 'America/Bogota')::date as fecha, sum(precio_cobrado) as total
  from public.registros_trabajo
  where not anulado
  group by (created_at at time zone 'America/Bogota')::date
) r
full outer join (
  select fecha,
         sum(efectivo_entregado + nequi_reportado + daviplata_reportado + datafono_reportado) as total
  from public.cierres_caja
  group by fecha
) c on r.fecha = c.fecha
order by fecha desc;

-- ---------------------------------------------------------
-- 8. Storage: bucket para fotos de evidencia (compartido, separado por
--    carpeta salon_id/... dentro del mismo bucket).
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('evidencias', 'evidencias', false)
on conflict (id) do nothing;

-- Convención de ruta: {salon_id}/{lo-que-sea}. storage.foldername(name)[1]
-- es el primer segmento de la ruta, o sea el salon_id.
create policy "usuarios autenticados suben evidencias de su salon"
  on storage.objects for insert
  with check (
    bucket_id = 'evidencias'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = public.mi_salon()::text
  );

create policy "usuarios autenticados ven evidencias de su salon"
  on storage.objects for select
  using (
    bucket_id = 'evidencias'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = public.mi_salon()::text
  );

-- El admin / superadmin puede borrar fotos (retención automática de 1 mes).
create policy "gestor borra evidencias de su salon"
  on storage.objects for delete
  using (
    bucket_id = 'evidencias'
    and public.es_admin()
    and (storage.foldername(name))[1] = public.mi_salon()::text
  );

-- ---------------------------------------------------------
-- 9. Acceso: la dueña puede cambiar el usuario/correo de acceso y la
--    contraseña de cualquier persona DE SU MISMO SALÓN, sin pasar por el
--    Dashboard de Supabase.
-- ---------------------------------------------------------
create extension if not exists pgcrypto;

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
  v_dominio text;
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
      select dominio_interno into v_dominio from public.salones where id = v_salon_objetivo;
      v_email := v_email || '@' || v_dominio;
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

grant execute on function public.admin_actualizar_acceso(uuid, text, text) to authenticated;

-- ---------------------------------------------------------
-- 10. Notificaciones push a las profesionales cuando se les asigna una cita.
--     salon_id se hereda del perfil (profiles.id = push_subscriptions.user_id)
--     -- lo usa api/send-push.ts (service-role, salta RLS) para no dejar que
--     un admin de un salón le mande notificaciones a personal de otro salón.
-- ---------------------------------------------------------
create table public.push_subscriptions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  salon_id uuid not null references public.salones(id),
  subscription text not null,
  updated_at timestamptz not null default now()
);

create index idx_push_subscriptions_salon on public.push_subscriptions(salon_id);

alter table public.push_subscriptions enable row level security;

create or replace function public.heredar_salon_de_perfil_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select salon_id into new.salon_id from public.profiles where id = new.user_id;
  if new.salon_id is null then
    raise exception 'Perfil no encontrado.';
  end if;
  return new;
end;
$$;

create trigger trg_heredar_salon_push_subscriptions
  before insert on public.push_subscriptions
  for each row execute function public.heredar_salon_de_perfil_push();

-- Cada usuario solo puede leer y escribir su propia suscripción.
create policy "push_own"
  on public.push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------
-- 11. Saldo a favor / reembolsos a clientas.
--     Cuando el abono ya pagado por una cita termina siendo mayor que el
--     total finalmente cobrado (ej: la clienta cambió a un servicio más
--     barato ya con el 100% abonado), queda una diferencia a favor de la
--     clienta. Admin/super decide cómo resolverla al ver la visita en
--     "Cuentas por cobrar": dejarla como crédito para una próxima cita, o
--     devolverla en efectivo/transferencia (eso sí sale de caja, y se
--     refleja en el Cierre de caja del día). Es un ledger inmutable, igual
--     que "cobros": no se edita ni se borra, salvo el campo "usado" cuando
--     el crédito se aplica en una cita futura.
-- ---------------------------------------------------------
create table public.creditos_clientes (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  cliente_id uuid not null references public.profiles(id),
  cita_id uuid references public.citas(id),
  visita_id uuid,
  monto numeric(12,2) not null check (monto > 0),
  resolucion text not null check (resolucion in ('credito', 'reembolso')),
  metodo_pago text check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono')),
  nota text,
  -- Solo aplica al tipo "credito": si ya se descontó en una cita posterior.
  usado boolean not null default false,
  usado_en_cita_id uuid references public.citas(id),
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((resolucion = 'reembolso') = (metodo_pago is not null))
);

create index idx_creditos_clientes_cliente on public.creditos_clientes(cliente_id);
create index idx_creditos_clientes_visita on public.creditos_clientes(visita_id);
create index idx_creditos_clientes_salon on public.creditos_clientes(salon_id);

alter table public.creditos_clientes enable row level security;

-- Devolver dinero (reembolso) es solo de la dueña -- saca plata física de
-- caja. Un admin todavía puede dejarlo como crédito (no mueve caja).
create policy "admin registra creditos de su salon"
  on public.creditos_clientes for insert
  with check (
    public.es_admin()
    and creado_por = auth.uid()
    and salon_id = public.mi_salon()
    and (resolucion = 'credito' or public.es_super())
  );

create policy "admin ve creditos de su salon"
  on public.creditos_clientes for select
  using (public.es_admin() and salon_id = public.mi_salon());

create policy "clienta ve sus propios creditos"
  on public.creditos_clientes for select
  using (cliente_id = auth.uid());

-- El único cambio permitido después de creado es marcarlo como usado
-- (el trigger de abajo bloquea cualquier otro campo).
create policy "admin marca credito como usado en su salon"
  on public.creditos_clientes for update
  using (public.es_admin() and salon_id = public.mi_salon())
  with check (public.es_admin() and salon_id = public.mi_salon());

create or replace function public.bloquear_edicion_credito()
returns trigger
language plpgsql
as $$
begin
  if new.salon_id is distinct from old.salon_id
     or new.cliente_id is distinct from old.cliente_id
     or new.cita_id is distinct from old.cita_id
     or new.visita_id is distinct from old.visita_id
     or new.monto is distinct from old.monto
     or new.resolucion is distinct from old.resolucion
     or new.metodo_pago is distinct from old.metodo_pago
     or new.nota is distinct from old.nota
     or new.creado_por is distinct from old.creado_por
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Un crédito/reembolso ya registrado no se puede modificar; solo marcarse como usado.';
  end if;
  return new;
end;
$$;

create trigger trg_bloquear_edicion_credito
  before update on public.creditos_clientes
  for each row execute function public.bloquear_edicion_credito();

-- ---------------------------------------------------------
-- 11b. Condonaciones: eliminar/perdonar un saldo PENDIENTE por cobrar (la
--      clienta debe, la dueña decide no cobrarlo) SIN que cuente como
--      dinero que entró a caja -- por eso es tabla aparte de "cobros", no
--      una fila más ahí. Ledger inmutable, solo superadmin puede crearlas.
-- ---------------------------------------------------------
create table public.condonaciones (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  visita_id uuid not null,
  monto numeric(12,2) not null check (monto > 0),
  motivo text not null check (length(trim(motivo)) > 0),
  condonado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_condonaciones_visita on public.condonaciones(visita_id);
create index idx_condonaciones_salon on public.condonaciones(salon_id);

alter table public.condonaciones enable row level security;

create policy "super condona saldo de su salon"
  on public.condonaciones for insert
  with check (public.es_super() and condonado_por = auth.uid() and salon_id = public.mi_salon());

create policy "admin ve condonaciones de su salon"
  on public.condonaciones for select
  using (public.es_admin() and salon_id = public.mi_salon());

-- Sin policy de update/delete: queda bloqueado por RLS, es inmutable.

-- ---------------------------------------------------------
-- 12. Consumo interno de insumos (inventario "interno", separado del de
--     vitrina). No es una venta ni un préstamo: no tiene clienta, monto ni
--     medio de pago, solo descuenta stock para llevar el control de lo que
--     hay (ej. "se usó 1 base"). Ledger inmutable, igual que cobros/ventas.
-- ---------------------------------------------------------
create table public.consumos_internos (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  producto_id uuid not null references public.productos(id),
  cantidad integer not null check (cantidad > 0),
  nota text,
  registrado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_consumos_internos_producto on public.consumos_internos(producto_id);
create index idx_consumos_internos_salon on public.consumos_internos(salon_id);

alter table public.consumos_internos enable row level security;

create policy "admin registra consumo interno de su salon"
  on public.consumos_internos for insert
  with check (public.es_admin() and registrado_por = auth.uid() and salon_id = public.mi_salon());

create policy "admin ve consumo interno de su salon"
  on public.consumos_internos for select
  using (public.es_admin() and salon_id = public.mi_salon());

-- Nadie edita ni borra un consumo ya registrado (No se crean policies de UPDATE/DELETE).

-- Descuenta el stock al registrar el consumo (con bloqueo de fila, igual
-- que las ventas y los préstamos de insumo). Valida que el producto sea del
-- mismo salón que el consumo.
create or replace function public.descontar_stock_consumo_interno()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock integer;
  v_salon_producto uuid;
begin
  select stock, salon_id into v_stock, v_salon_producto from public.productos where id = new.producto_id for update;
  if v_stock is null then
    raise exception 'Producto no encontrado.';
  end if;
  if v_salon_producto is distinct from new.salon_id then
    raise exception 'El producto no pertenece al mismo salón que el consumo.';
  end if;
  if v_stock < new.cantidad then
    raise exception 'No hay suficiente stock de este producto (disponible: %).', v_stock;
  end if;
  update public.productos set stock = stock - new.cantidad where id = new.producto_id;
  return new;
end;
$$;

create trigger trg_descontar_stock_consumo_interno
  after insert on public.consumos_internos
  for each row execute function public.descontar_stock_consumo_interno();

-- =========================================================
-- 14. Consola KALLOS: operadores de plataforma (Vulpex)
-- Un "operador" es quien administra la PLATAFORMA (crea salones, suspende,
-- cambia planes) -- transversal a todos los salones. Sus permisos son
-- policies ADITIVAS sobre el RLS por salón: a ningún usuario normal se le
-- abre nada nuevo. Su perfil vive en un salón especial "KALLOS Plataforma"
-- (slug 'plataforma', activo=false) -- ver crear_operador_plataforma.sql.
-- =========================================================

-- 14a. Quién es operador. SIN policies de insert/update/delete: solo se
--      escribe por SQL / service-role.
create table public.plataforma_operadores (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nota text,
  created_at timestamptz not null default now()
);

alter table public.plataforma_operadores enable row level security;

create policy "operador ve su propia fila"
  on public.plataforma_operadores for select
  using (user_id = auth.uid());

create or replace function public.es_operador()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.plataforma_operadores where user_id = auth.uid())
$$;

-- 14b. Datos de la venta por salón (contacto del cliente, notas). Tabla
--      APARTE de salones: la policy pública de salones expone la fila
--      completa (necesaria para resolver slug sin sesión) y los datos del
--      cliente/notas comerciales no pueden vivir ahí.
create table public.salones_detalle_venta (
  salon_id uuid primary key references public.salones(id) on delete cascade,
  contacto_nombre text,
  contacto_telefono text,
  contacto_correo text,
  notas text,
  -- Próximo vencimiento del cobro (manual, sin Stripe) -- alimenta el
  -- semáforo de la Consola. Lo edita el operador directamente; registrar
  -- un pago (salones_pagos, más abajo) no lo mueve solo, a propósito.
  fecha_proximo_vencimiento date,
  updated_at timestamptz not null default now()
);

alter table public.salones_detalle_venta enable row level security;

create policy "operador administra detalle de venta"
  on public.salones_detalle_venta for all
  using (public.es_operador())
  with check (public.es_operador());

-- 14b-2. Ledger de pagos recibidos (organiza el cobro manual). Inmutable en
--        la práctica: la Consola solo inserta: si hay un error se registra
--        un pago corrector, mismo patrón que "cobros".
create table public.salones_pagos (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  monto numeric(12,2) not null check (monto > 0),
  fecha_pago date not null default current_date,
  metodo_pago text,
  nota text,
  registrado_por uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_salones_pagos_salon on public.salones_pagos(salon_id);

alter table public.salones_pagos enable row level security;

create policy "operador administra pagos"
  on public.salones_pagos for all
  using (public.es_operador())
  with check (public.es_operador());

-- 14c. Policies aditivas del operador sobre tablas existentes.
create policy "operador ve todos los salones"
  on public.salones for select
  using (public.es_operador());

-- Corrección: un salón suspendido (activo=false) esconde su propia fila
-- incluso para SU propio superadmin (la única otra policy de select exige
-- activo=true) -- se veía branding genérico mientras estaba suspendido.
-- Cosmético, no de seguridad (solo ve SU salón).
create policy "usuario ve su propio salon aunque este suspendido"
  on public.salones for select
  using (id = public.mi_salon());

create policy "operador crea salones"
  on public.salones for insert
  with check (public.es_operador());

create policy "operador administra salones"
  on public.salones for update
  using (public.es_operador())
  with check (public.es_operador());

create policy "operador ve todos los perfiles"
  on public.profiles for select
  using (public.es_operador());

-- 14d. RPCs de la consola.
-- Promover a superadmin al primer usuario de un salón recién creado. El
-- operador no puede hacerlo por update directo: la policy de update de
-- profiles exige ser admin DEL MISMO salón.
create or replace function public.plataforma_promover_superadmin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_operador() then
    raise exception 'Solo un operador de plataforma puede hacer esto.';
  end if;
  update public.profiles set rol = 'superadmin', activo = true where id = p_user_id;
  if not found then
    raise exception 'Perfil no encontrado.';
  end if;
end;
$$;

-- Alta self-serve (RPC pública, anon): un dueño de salón se registra solo
-- y queda activo de inmediato -- sin aprobación del operador (riesgo de
-- abuso aceptado para v1, sin CAPTCHA/rate-limit; ver CLAUDE.md). El
-- llamante NO está autenticado, así que valida/sanea todo server-side. El
-- primer signUp() contra el salon_id que devuelve queda superadmin solo
-- (ver handle_new_user() más arriba).
create or replace function public.crear_salon_self_serve(
  p_nombre text,
  p_slug text,
  p_duena_nombre text,
  p_contacto_telefono text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text := lower(trim(p_slug));
  v_nombre text := trim(p_nombre);
  v_salon_id uuid;
begin
  if v_nombre = '' or length(v_nombre) > 200 then
    raise exception 'Nombre de salón inválido.';
  end if;
  if coalesce(trim(p_duena_nombre), '') = '' or length(p_duena_nombre) > 200 then
    raise exception 'Nombre de la dueña inválido.';
  end if;
  if v_slug !~ '^[a-z0-9](-?[a-z0-9])*$' or length(v_slug) not between 3 and 40 then
    raise exception 'El slug debe tener 3-40 caracteres: minúsculas, números y guiones.';
  end if;
  if v_slug in ('plataforma', 'admin', 'api', 'www', 'app', 'login', 'portal', 'registro', 'registro-cliente') then
    raise exception 'Ese slug no está disponible.';
  end if;

  insert into public.salones (nombre, slug, dominio_interno, plan, activo)
  values (v_nombre, v_slug, v_slug || '.kallos.app', 'basico', true)
  returning id into v_salon_id;

  insert into public.salones_detalle_venta (salon_id, contacto_nombre, contacto_telefono)
  values (v_salon_id, nullif(trim(p_duena_nombre), ''), nullif(trim(p_contacto_telefono), ''));

  return v_salon_id;
end;
$$;

grant execute on function public.crear_salon_self_serve(text, text, text, text) to anon;

-- Resumen de cartera: cada salón con su detalle de venta y conteo de
-- usuarios por rol (evita traer todos los profiles al navegador).
create or replace function public.plataforma_resumen_salones()
returns table (
  id uuid,
  nombre text,
  slug text,
  dominio_interno text,
  activo boolean,
  plan text,
  color_primario text,
  color_secundario text,
  logo_url text,
  eslogan text,
  created_at timestamptz,
  contacto_nombre text,
  contacto_telefono text,
  contacto_correo text,
  notas text,
  fecha_proximo_vencimiento date,
  total_personal bigint,
  total_clientes bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.es_operador() then
    raise exception 'Solo un operador de plataforma puede hacer esto.';
  end if;
  return query
    select
      s.id, s.nombre, s.slug, s.dominio_interno, s.activo, s.plan,
      s.color_primario, s.color_secundario, s.logo_url, s.eslogan, s.created_at,
      v.contacto_nombre, v.contacto_telefono, v.contacto_correo, v.notas,
      v.fecha_proximo_vencimiento,
      count(p.id) filter (where p.rol in ('superadmin', 'admin', 'personal')) as total_personal,
      count(p.id) filter (where p.rol = 'cliente') as total_clientes
    from public.salones s
    left join public.salones_detalle_venta v on v.salon_id = s.id
    left join public.profiles p on p.salon_id = s.id
    group by s.id, v.salon_id
    order by s.created_at desc;
end;
$$;

-- 14e. Auditoría de "entrar como" (impersonar). La escribe la Edge
--      Function con service-role -- sin policy de insert desde el cliente.
create table public.plataforma_accesos_soporte (
  id uuid primary key default gen_random_uuid(),
  operador_id uuid not null references auth.users(id),
  salon_id uuid not null references public.salones(id),
  superadmin_id uuid not null references public.profiles(id),
  iniciado_at timestamptz not null default now()
);

alter table public.plataforma_accesos_soporte enable row level security;

create policy "operador ve su historial de soporte"
  on public.plataforma_accesos_soporte for select
  using (public.es_operador());

-- 14f. Logo propio del cliente (Pro/Enterprise). Bucket público -- la
-- descarga no pasa por RLS (necesario para mostrarlo en pantallas sin
-- sesión, como el autoregistro de clientas por slug). El gate de "solo
-- Pro/Enterprise ven su logo propio, Básico ve el de KALLOS" vive en el
-- FRONTEND (src/lib/branding.ts) -- acá solo se controla quién puede
-- subir/reemplazar/borrar el archivo (solo el operador).
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

create policy "operador administra logos"
  on storage.objects for all
  using (bucket_id = 'logos' and public.es_operador())
  with check (bucket_id = 'logos' and public.es_operador());

-- ---------------------------------------------------------
-- 15. Permisos finales: cubre todas las tablas/funciones creadas arriba
--     (ver nota en la sección 0a). RLS sigue mandando fila por fila.
-- ---------------------------------------------------------
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
