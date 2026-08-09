-- =========================================================
-- Personal puede ver sus propios pagos de préstamo (antes solo admin/
-- superadmin tenían SELECT en prestamo_pagos -- por eso "Mi perfil" nunca
-- reflejaba los abonos parciales que ya se le habían registrado).
-- =========================================================
create policy "personal ve pagos de sus prestamos"
  on public.prestamo_pagos for select
  using (
    exists (
      select 1 from public.prestamos pr
      where pr.id = prestamo_pagos.prestamo_id
      and pr.persona_id = auth.uid()
    )
  );

-- =========================================================
-- Nuevo medio de pago Bre-B en todo el esquema.
-- =========================================================
alter table public.registros_trabajo drop constraint registros_trabajo_metodo_pago_check;
alter table public.registros_trabajo add constraint registros_trabajo_metodo_pago_check
  check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.citas drop constraint citas_abono_metodo_pago_check;
alter table public.citas add constraint citas_abono_metodo_pago_check
  check (abono_metodo_pago is null or abono_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.citas drop constraint citas_saldo_metodo_pago_check;
alter table public.citas add constraint citas_saldo_metodo_pago_check
  check (saldo_metodo_pago is null or saldo_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.cobros drop constraint cobros_metodo_pago_check;
alter table public.cobros add constraint cobros_metodo_pago_check
  check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.cierres_caja drop constraint cierres_caja_proveedor_metodo_pago_check;
alter table public.cierres_caja add constraint cierres_caja_proveedor_metodo_pago_check
  check (proveedor_metodo_pago is null or proveedor_metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.prestamos drop constraint prestamos_metodo_pago_check;
alter table public.prestamos add constraint prestamos_metodo_pago_check
  check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.prestamo_pagos drop constraint prestamo_pagos_metodo_pago_check;
alter table public.prestamo_pagos add constraint prestamo_pagos_metodo_pago_check
  check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.ventas drop constraint ventas_metodo_pago_check;
alter table public.ventas add constraint ventas_metodo_pago_check
  check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.venta_pagos drop constraint venta_pagos_metodo_pago_check;
alter table public.venta_pagos add constraint venta_pagos_metodo_pago_check
  check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.creditos_clientes drop constraint creditos_clientes_metodo_pago_check;
alter table public.creditos_clientes add constraint creditos_clientes_metodo_pago_check
  check (metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

-- Cierre de caja reporta cada medio en su propia columna -- Bre-B necesita la quinta.
alter table public.cierres_caja add column bre_b_reportado numeric(12,2) not null default 0;
