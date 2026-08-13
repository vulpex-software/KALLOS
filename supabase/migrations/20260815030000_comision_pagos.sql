-- Ledger histórico de pagos de comisión. El "saldo pendiente" de cada
-- especialista es todo lo ganado históricamente (50% de sus registros de
-- trabajo) menos la suma de esta tabla -- no hay concepto de "rango
-- cerrado", fecha_desde/fecha_hasta son solo la referencia de qué período
-- se calculó para llegar al monto, y ajuste anota el bono/descuento manual.
create table public.comision_pagos (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salones(id),
  persona_id uuid not null references public.profiles(id),
  monto numeric(12,2) not null check (monto > 0),
  fecha_desde date not null,
  fecha_hasta date not null,
  ajuste numeric(12,2) not null default 0,
  nota text,
  pagado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index idx_comision_pagos_salon on public.comision_pagos(salon_id);
create index idx_comision_pagos_persona on public.comision_pagos(persona_id);

alter table public.comision_pagos enable row level security;

create policy "super administra pagos de comision de su salon"
  on public.comision_pagos for all
  using (public.es_super() and salon_id = public.mi_salon())
  with check (public.es_super() and salon_id = public.mi_salon());

create policy "personal ve sus pagos de comision"
  on public.comision_pagos for select
  using (persona_id = auth.uid());

grant all on public.comision_pagos to anon, authenticated, service_role;
