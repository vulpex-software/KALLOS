-- =========================================================
-- Eslogan propio por salón (Pro/Enterprise). Mismo patrón que
-- color_primario / logo_url: el campo vive siempre en la tabla, pero el
-- frontend (src/lib/branding.ts) solo lo muestra si plan != 'basico'.
-- =========================================================

alter table public.salones
  add column eslogan text;

-- plataforma_resumen_salones() ya devuelve color_primario/logo_url para
-- que la Consola los edite -- se agrega eslogan al mismo select. El tipo
-- de retorno cambia (nueva columna OUT), así que hay que dropearla antes.
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
      s.color_primario, s.logo_url, s.eslogan, s.created_at,
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

grant execute on function public.plataforma_resumen_salones() to authenticated;
