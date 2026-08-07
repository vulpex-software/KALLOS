-- =========================================================
-- Consola KALLOS: operadores de plataforma (Vulpex)
-- Un "operador" es quien administra la PLATAFORMA (crea salones, suspende,
-- cambia planes) -- transversal a todos los salones. Sus permisos son
-- policies ADITIVAS sobre el RLS por salón existente: a ningún usuario
-- normal se le abre nada nuevo.
-- =========================================================

-- ---------------------------------------------------------
-- 14a. Quién es operador. SIN policies de insert/update/delete: solo se
--      escribe por SQL / service-role (igual de blindado que promover un
--      superadmin). El frontend solo necesita leer su propia fila para
--      saber si mostrar la consola.
-- ---------------------------------------------------------
create table if not exists public.plataforma_operadores (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nota text,
  created_at timestamptz not null default now()
);

alter table public.plataforma_operadores enable row level security;

drop policy if exists "operador ve su propia fila" on public.plataforma_operadores;
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

-- ---------------------------------------------------------
-- 14b. Datos de la venta por salón (contacto del cliente, notas).
--      Tabla APARTE de salones a propósito: la policy pública de salones
--      ("cualquiera lee salones activos", necesaria para resolver el slug
--      sin sesión) expone la fila completa -- los datos personales del
--      cliente y las notas comerciales no pueden vivir ahí.
-- ---------------------------------------------------------
create table if not exists public.salones_detalle_venta (
  salon_id uuid primary key references public.salones(id) on delete cascade,
  contacto_nombre text,
  contacto_telefono text,
  contacto_correo text,
  notas text,
  updated_at timestamptz not null default now()
);

alter table public.salones_detalle_venta enable row level security;

drop policy if exists "operador administra detalle de venta" on public.salones_detalle_venta;
create policy "operador administra detalle de venta"
  on public.salones_detalle_venta for all
  using (public.es_operador())
  with check (public.es_operador());

-- ---------------------------------------------------------
-- 14c. Policies aditivas del operador sobre tablas existentes.
-- ---------------------------------------------------------
drop policy if exists "operador ve todos los salones" on public.salones;
create policy "operador ve todos los salones"
  on public.salones for select
  using (public.es_operador());

drop policy if exists "operador crea salones" on public.salones;
create policy "operador crea salones"
  on public.salones for insert
  with check (public.es_operador());

drop policy if exists "operador administra salones" on public.salones;
create policy "operador administra salones"
  on public.salones for update
  using (public.es_operador())
  with check (public.es_operador());

drop policy if exists "operador ve todos los perfiles" on public.profiles;
create policy "operador ve todos los perfiles"
  on public.profiles for select
  using (public.es_operador());

-- ---------------------------------------------------------
-- 14d. RPCs de la consola.
-- ---------------------------------------------------------
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
  logo_url text,
  created_at timestamptz,
  contacto_nombre text,
  contacto_telefono text,
  contacto_correo text,
  notas text,
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
      s.color_primario, s.logo_url, s.created_at,
      v.contacto_nombre, v.contacto_telefono, v.contacto_correo, v.notas,
      count(p.id) filter (where p.rol in ('superadmin', 'admin', 'personal')) as total_personal,
      count(p.id) filter (where p.rol = 'cliente') as total_clientes
    from public.salones s
    left join public.salones_detalle_venta v on v.salon_id = s.id
    left join public.profiles p on p.salon_id = s.id
    group by s.id, v.salon_id
    order by s.created_at desc;
end;
$$;

-- ---------------------------------------------------------
-- 14e. Grants (los "grant all on all tables" del schema.sql base corrieron
--      antes de que existieran estas tablas/funciones -- ver nota 0a).
-- ---------------------------------------------------------
grant all on public.plataforma_operadores to anon, authenticated, service_role;
grant all on public.salones_detalle_venta to anon, authenticated, service_role;
grant execute on function public.es_operador() to anon, authenticated, service_role;
grant execute on function public.plataforma_promover_superadmin(uuid) to authenticated, service_role;
grant execute on function public.plataforma_resumen_salones() to authenticated, service_role;
