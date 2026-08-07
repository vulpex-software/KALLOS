-- =========================================================
-- Consola KALLOS: pagos, alta self-serve, impersonar (soporte)
-- =========================================================

-- ---------------------------------------------------------
-- A1. Ledger de pagos + próximo vencimiento (organiza el cobro manual,
--     sin Stripe -- reemplaza el campo de notas libre de antes).
-- ---------------------------------------------------------
alter table public.salones_detalle_venta
  add column if not exists fecha_proximo_vencimiento date;

create table if not exists public.salones_pagos (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  monto numeric(12,2) not null check (monto > 0),
  fecha_pago date not null default current_date,
  metodo_pago text,
  nota text,
  registrado_por uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.salones_pagos enable row level security;

drop policy if exists "operador administra pagos" on public.salones_pagos;
create policy "operador administra pagos"
  on public.salones_pagos for all
  using (public.es_operador())
  with check (public.es_operador());

create index if not exists idx_salones_pagos_salon on public.salones_pagos(salon_id);

-- ---------------------------------------------------------
-- A2. Auto-superadmin al primer usuario de un salón nuevo (necesario para
--     el alta self-serve: nadie promueve manualmente al dueño). Lock de
--     fila para que dos signUp() concurrentes contra el mismo salón nuevo
--     no queden AMBOS como superadmin (condición de carrera real).
-- ---------------------------------------------------------
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

-- ---------------------------------------------------------
-- A2b. Alta self-serve (RPC pública, anon). El llamante no está
--      autenticado -- valida/sanea todo server-side.
-- ---------------------------------------------------------
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

-- ---------------------------------------------------------
-- A3. Auditoría de "entrar como" (impersonar). La escribe la Edge
--     Function con service-role -- sin policy de insert desde el cliente.
-- ---------------------------------------------------------
create table if not exists public.plataforma_accesos_soporte (
  id uuid primary key default gen_random_uuid(),
  operador_id uuid not null references auth.users(id),
  salon_id uuid not null references public.salones(id),
  superadmin_id uuid not null references public.profiles(id),
  iniciado_at timestamptz not null default now()
);

alter table public.plataforma_accesos_soporte enable row level security;

drop policy if exists "operador ve su historial de soporte" on public.plataforma_accesos_soporte;
create policy "operador ve su historial de soporte"
  on public.plataforma_accesos_soporte for select
  using (public.es_operador());

-- ---------------------------------------------------------
-- A4. Corrección menor: un salón suspendido (activo=false) hoy esconde su
--     propia fila incluso para SU propio superadmin (la única policy de
--     select aparte de la del operador exige activo=true) -- se veía
--     branding genérico mientras estaba suspendido. Cosmético, no fuga.
-- ---------------------------------------------------------
drop policy if exists "usuario ve su propio salon aunque este suspendido" on public.salones;
create policy "usuario ve su propio salon aunque este suspendido"
  on public.salones for select
  using (id = public.mi_salon());

-- ---------------------------------------------------------
-- A5. plataforma_resumen_salones() gana fecha_proximo_vencimiento (para el
--     semáforo). Postgres no deja cambiar el "returns table" con create or
--     replace -- hay que dropearla primero.
-- ---------------------------------------------------------
drop function if exists public.plataforma_resumen_salones();
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
      s.color_primario, s.logo_url, s.created_at,
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

-- ---------------------------------------------------------
-- Grants (ver nota 0a de schema.sql: el runner de migraciones local no
-- hereda los default privileges del schema base).
-- ---------------------------------------------------------
grant all on public.salones_pagos to anon, authenticated, service_role;
grant all on public.plataforma_accesos_soporte to anon, authenticated, service_role;
grant execute on function public.crear_salon_self_serve(text, text, text, text) to anon, authenticated, service_role;
