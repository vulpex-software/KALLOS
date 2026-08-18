-- Ajuste de saldo de comisión: para los saldos de APERTURA, la comisión que
-- se pagó por fuera antes de que el salón entrara al sistema. El trabajo sí
-- se hizo y la clienta sí pagó, así que anular el registro de trabajo sería
-- un error (borraría ingreso real y bajaría el recaudado). Y registrarlo
-- como un pago normal inventaría una salida de plata que hoy no ocurre, lo
-- que descuadraría el efectivo. Por eso es un tipo aparte que NO mueve caja:
-- solo baja el saldo pendiente de comisión.
alter table public.comision_pagos
  add column if not exists tipo text not null default 'pago'
  check (tipo in ('pago', 'ajuste'));

-- El check de medio obligatorio (20260815090000) daba por hecho que toda
-- fila era un pago real. Un ajuste no mueve plata, así que NO puede llevar
-- medio de pago -- si lo llevara, se colaría como salida en los cuadres.
alter table public.comision_pagos
  drop constraint if exists comision_pagos_medio_obligatorio;
alter table public.comision_pagos
  drop constraint if exists comision_pagos_medio_segun_tipo;
alter table public.comision_pagos
  add constraint comision_pagos_medio_segun_tipo
  check (
    (tipo = 'pago'   and metodo_pago is not null) or
    (tipo = 'ajuste' and metodo_pago is null)
  ) not valid;

-- Un ajuste sin explicación es indistinguible de un error: el motivo va en
-- `nota` y es obligatorio para este tipo (para un pago normal sigue siendo
-- opcional). Queda además en auditoría por el trigger de la tabla.
alter table public.comision_pagos
  drop constraint if exists comision_pagos_ajuste_con_motivo;
alter table public.comision_pagos
  add constraint comision_pagos_ajuste_con_motivo
  check (tipo <> 'ajuste' or (nota is not null and length(btrim(nota)) > 0)) not valid;
