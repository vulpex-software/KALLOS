-- =========================================================
-- MIGRACIÓN Bloque C — Gestión de personal
-- Ejecutar en: Supabase Dashboard > SQL Editor (una sola vez)
--   #8 datos básicos de las especialistas
--   #9 las especialistas ya no crean/gestionan citas
--   #6 solicitud de permisos  /  #7 días de descanso del superadmin
--   #10 préstamos / insumos fiados
-- =========================================================

-- ---- #8 Datos básicos en el perfil ----
alter table public.profiles
  add column if not exists apellidos text,
  add column if not exists direccion text,
  add column if not exists cedula text,
  add column if not exists correo text,
  add column if not exists fecha_nacimiento date,
  add column if not exists fecha_ingreso date;

-- ---- #9 Las especialistas ya NO agendan citas (solo admin/super) ----
drop policy if exists "personal agenda citas" on public.citas;
create policy "staff agenda citas"
  on public.citas for insert
  with check (creado_por = auth.uid() and public.mi_rol() in ('admin', 'superadmin'));
-- (La especialista SÍ puede completar su propia cita al registrar el trabajo:
--  eso es un UPDATE y sigue permitido por la policy "personal actualiza citas".)

-- ---- #6 y #7 Permisos y descansos ----
create table if not exists public.permisos (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.profiles(id),
  tipo text not null default 'permiso' check (tipo in ('permiso', 'descanso')),
  fecha_desde date not null,
  fecha_hasta date not null,
  motivo text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.permisos enable row level security;

create policy "persona solicita su permiso"
  on public.permisos for insert
  with check (persona_id = auth.uid() and creado_por = auth.uid());

create policy "persona ve sus permisos"
  on public.permisos for select
  using (persona_id = auth.uid());

create policy "admin ve todos los permisos"
  on public.permisos for select
  using (public.es_admin());

create policy "admin gestiona permisos"
  on public.permisos for update
  using (public.es_admin())
  with check (public.es_admin());

-- ---- #10 Préstamos / insumos fiados ----
create table if not exists public.prestamos (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.profiles(id),
  tipo text not null default 'dinero' check (tipo in ('dinero', 'insumo')),
  descripcion text,
  monto numeric(12,2) not null default 0,
  pagado boolean not null default false,
  creado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.prestamos enable row level security;

-- El superadmin registra y administra los préstamos.
create policy "super administra prestamos"
  on public.prestamos for all
  using (public.es_super())
  with check (public.es_super());

-- Cada persona ve los suyos (en "Mi perfil").
create policy "persona ve sus prestamos"
  on public.prestamos for select
  using (persona_id = auth.uid());

-- El admin puede verlos (lectura).
create policy "admin ve prestamos"
  on public.prestamos for select
  using (public.es_admin());

-- ---- Auditoría de permisos y préstamos ----
create trigger trg_auditoria_permisos
  after insert or update on public.permisos
  for each row execute function public.registrar_auditoria();

create trigger trg_auditoria_prestamos
  after insert or update on public.prestamos
  for each row execute function public.registrar_auditoria();
