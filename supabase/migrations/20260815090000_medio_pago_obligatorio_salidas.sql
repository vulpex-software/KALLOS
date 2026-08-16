-- Toda salida de plata tiene que decir POR QUÉ MEDIO salió, o la cuenta del
-- efectivo nunca es exacta: una salida sin medio puede haber sido efectivo
-- (y entonces al cajón le falta esa plata) o transferencia (y no le falta
-- nada), y no hay forma de saberlo mirando el registro.
--
-- Estado antes de esto, salida por salida:
--   gastos              -> metodo_pago not null. Ya estaba bien.
--   creditos_clientes   -> ya tenía el check "reembolso <=> metodo_pago
--                          not null". Ya estaba bien.
--   comision_pagos      -> NO TENÍA la columna. Se agrega.
--   prestamos           -> nullable a propósito (un insumo asignado no mueve
--                          plata), pero tampoco lo exigía para 'dinero'.
--   cierres_caja        -> el pago a proveedores lo exigía solo la pantalla.
--
-- Los checks van NOT VALID: las filas viejas sin medio quedan como están
-- (no hay forma de adivinar por dónde salió esa plata hace semanas), pero
-- de acá en adelante no entra ninguna sin medio.

alter table public.comision_pagos
  add column if not exists metodo_pago text;

alter table public.comision_pagos
  drop constraint if exists comision_pagos_metodo_pago_check;
alter table public.comision_pagos
  add constraint comision_pagos_metodo_pago_check
  check (metodo_pago is null or metodo_pago in ('efectivo', 'nequi', 'daviplata', 'datafono', 'bre_b'));

alter table public.comision_pagos
  drop constraint if exists comision_pagos_medio_obligatorio;
alter table public.comision_pagos
  add constraint comision_pagos_medio_obligatorio
  check (metodo_pago is not null) not valid;

-- Un préstamo de DINERO sale de la caja y tiene que decir por dónde. Un
-- insumo fiado o asignado no mueve plata (es inventario), así que ahí
-- metodo_pago sigue siendo null a propósito.
alter table public.prestamos
  drop constraint if exists prestamos_medio_obligatorio_si_dinero;
alter table public.prestamos
  add constraint prestamos_medio_obligatorio_si_dinero
  check (tipo <> 'dinero' or metodo_pago is not null) not valid;

-- El pago a proveedores del cierre: si hay monto, hay medio.
alter table public.cierres_caja
  drop constraint if exists cierres_caja_medio_proveedor_obligatorio;
alter table public.cierres_caja
  add constraint cierres_caja_medio_proveedor_obligatorio
  check (proveedor_monto = 0 or proveedor_metodo_pago is not null) not valid;
