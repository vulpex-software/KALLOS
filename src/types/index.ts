export type Rol = 'superadmin' | 'admin' | 'personal' | 'cliente'

// Un salón ("tenant"): cada uno tiene sus datos completamente aislados por
// RLS vía salon_id. color_primario/color_secundario/logo_url son opcionales
// -- si están vacíos, el frontend usa el negro+dorado por defecto de KALLOS.
export interface Salon {
  id: string
  nombre: string
  slug: string
  dominio_interno: string
  activo: boolean
  plan: 'basico' | 'pro' | 'enterprise'
  color_primario: string | null
  color_secundario: string | null
  logo_url: string | null
  eslogan: string | null
  created_at: string
}

export type Especialidad = 'manicurista' | 'estilista' | 'lashista'

export const ESPECIALIDADES: { valor: Especialidad; etiqueta: string }[] = [
  { valor: 'manicurista', etiqueta: 'Manicurista' },
  { valor: 'estilista', etiqueta: 'Estilista' },
  { valor: 'lashista', etiqueta: 'Lashista' }
]

export type MetodoPago = 'efectivo' | 'nequi' | 'daviplata' | 'datafono' | 'bre_b'

export const METODOS_PAGO: { valor: MetodoPago; etiqueta: string }[] = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'nequi', etiqueta: 'Nequi' },
  { valor: 'daviplata', etiqueta: 'Daviplata' },
  { valor: 'datafono', etiqueta: 'Datáfono' },
  { valor: 'bre_b', etiqueta: 'Bre-B' }
]

export interface Profile {
  id: string
  salon_id: string
  nombre: string
  rol: Rol
  especialidades: Especialidad[]
  telefono: string | null
  apellidos: string | null
  direccion: string | null
  cedula: string | null
  correo: string | null
  fecha_nacimiento: string | null
  fecha_ingreso: string | null
  activo: boolean
  created_at: string
}

// Datos comerciales de un salón (solo visibles para operadores de
// plataforma -- viven en tabla aparte de salones por RLS).
export interface SalonDetalleVenta {
  salon_id: string
  contacto_nombre: string | null
  contacto_telefono: string | null
  contacto_correo: string | null
  notas: string | null
  fecha_proximo_vencimiento: string | null
  updated_at: string
}

// Fila que devuelve el RPC plataforma_resumen_salones() para la Consola.
export interface ResumenSalon {
  id: string
  nombre: string
  slug: string
  dominio_interno: string
  activo: boolean
  plan: 'basico' | 'pro' | 'enterprise'
  color_primario: string | null
  color_secundario: string | null
  logo_url: string | null
  eslogan: string | null
  created_at: string
  contacto_nombre: string | null
  contacto_telefono: string | null
  contacto_correo: string | null
  notas: string | null
  fecha_proximo_vencimiento: string | null
  total_personal: number
  total_clientes: number
}

// Pago registrado a mano por el operador (organiza el cobro, sin Stripe).
export interface SalonPago {
  id: string
  salon_id: string
  monto: number
  fecha_pago: string
  metodo_pago: string | null
  nota: string | null
  registrado_por: string
  created_at: string
}

export type TipoPermiso = 'permiso' | 'descanso'
export type EstadoPermiso = 'pendiente' | 'aprobado' | 'rechazado'

export interface Permiso {
  id: string
  salon_id: string
  persona_id: string
  tipo: TipoPermiso
  fecha_desde: string
  fecha_hasta: string
  hora_desde: string | null
  hora_hasta: string | null
  motivo: string | null
  estado: EstadoPermiso
  creado_por: string
  created_at: string
  persona?: Profile
}

// 'insumo' = insumo fiado (vitrina, con monto y medio de pago, genera deuda).
// 'insumo_interno' = insumo asignado del inventario interno, sin costo (no
// genera deuda; solo queda registrado a quién y qué se le dio).
export type TipoPrestamo = 'dinero' | 'insumo' | 'insumo_interno'

export interface Prestamo {
  id: string
  salon_id: string
  persona_id: string
  tipo: TipoPrestamo
  descripcion: string | null
  monto: number
  metodo_pago: MetodoPago | null
  pagado: boolean
  producto_id: string | null
  cantidad: number | null
  creado_por: string
  created_at: string
  persona?: Profile
  producto?: { nombre: string }
}

// Pago (abono) registrado contra un préstamo: permite pagos parciales,
// cada uno con su medio de pago, para que el cierre de caja los refleje.
export interface PrestamoPago {
  id: string
  // Lo llena el trigger heredar_salon_de_prestamo en la base de datos --
  // no hace falta (ni se debe) mandarlo al insertar.
  salon_id: string
  prestamo_id: string
  monto: number
  metodo_pago: MetodoPago
  nota: string | null
  pagado_por: string
  created_at: string
}

// Pago de comisión (ledger histórico): fecha_desde/fecha_hasta son solo la
// referencia de qué período se calculó para llegar al monto -- el saldo
// pendiente real sale de sumar TODO lo ganado histórico menos la suma de
// estos pagos, no de "cerrar" ese rango puntual.
export interface ComisionPago {
  id: string
  salon_id: string
  persona_id: string
  monto: number
  fecha_desde: string
  fecha_hasta: string
  ajuste: number
  nota: string | null
  pagado_por: string
  created_at: string
}

export type TipoMarcacion = 'entrada' | 'inicio_almuerzo' | 'fin_almuerzo' | 'salida'

export interface Marcacion {
  id: string
  salon_id: string
  personal_id: string
  tipo: TipoMarcacion
  momento: string
  nota: string | null
  created_at: string
  personal?: Profile
}

export interface Servicio {
  id: string
  salon_id: string
  categoria: string
  nombre: string
  precio_base: number
  duracion_minutos: number
  activo: boolean
}

export interface RegistroTrabajo {
  id: string
  salon_id: string
  empleada_id: string
  servicio_id: string
  precio_cobrado: number
  descuento_porcentaje: number
  metodo_pago: MetodoPago | null
  cliente_nombre: string | null
  cliente_telefono: string | null
  foto_url: string | null
  nota: string | null
  visita_id: string | null
  cita_id: string | null
  anulado: boolean
  motivo_anulacion: string | null
  anulado_por: string | null
  anulado_at: string | null
  created_at: string
  servicio?: Servicio
  empleada?: Profile
}

// Cobro registrado por la administradora sobre una visita (cuenta por cobrar).
export interface Cobro {
  id: string
  salon_id: string
  visita_id: string
  monto: number
  metodo_pago: MetodoPago
  foto_url: string | null
  nota: string | null
  cobrado_por: string
  created_at: string
}

export interface CierreCaja {
  id: string
  salon_id: string
  fecha: string
  administradora_id: string
  base: number
  efectivo_entregado: number
  nequi_reportado: number
  daviplata_reportado: number
  datafono_reportado: number
  bre_b_reportado: number
  proveedor_monto: number
  proveedor_metodo_pago: MetodoPago | null
  proveedor_nota: string | null
  observaciones: string | null
  created_at: string
}

export type EstadoCita = 'pendiente' | 'confirmada' | 'completada' | 'cancelada'

export interface Cita {
  id: string
  salon_id: string
  empleada_id: string | null
  servicio_id: string
  servicios_ids: string[]
  cliente_id: string | null
  cliente_nombre: string
  cliente_telefono: string | null
  fecha: string
  hora: string
  hora_fin: string | null
  abono: number
  abono_metodo_pago: MetodoPago | null
  abono_foto_url: string | null
  saldo_pagado: number
  saldo_metodo_pago: MetodoPago | null
  obsequios: string[]
  nota: string | null
  nota_interna: string | null
  adicional_concepto: string | null
  adicional_valor: number | null
  estado: EstadoCita
  motivo_cancelacion: string | null
  reprogramada: boolean
  creado_por: string
  created_at: string
  servicio?: Servicio
  empleada?: Profile
}

// Cortesía/obsequio que se puede ofrecer al agendar o confirmar una cita.
// La superadmin puede agregar más aparte de los predeterminados.
export interface Obsequio {
  id: string
  salon_id: string
  nombre: string
  activo: boolean
  creado_por: string
  created_at: string
}

// "vitrina" se vende/presta (genera un pago); "interno" son insumos de uso
// profesional (bases, esmaltes...) que solo se descuentan por consumo.
export type TipoProducto = 'vitrina' | 'interno'

// Producto de inventario. Se crea "poco a poco" desde la app.
export interface Producto {
  id: string
  salon_id: string
  tipo: TipoProducto
  nombre: string
  descripcion: string | null
  marca: string | null
  proveedor: string | null
  precio_venta: number
  costo: number | null
  stock: number
  activo: boolean
  creado_por: string
  created_at: string
}

// Consumo de un insumo del inventario interno: no es una venta ni un
// préstamo, solo descuenta stock para llevar el control (sin valor ni pago).
export interface ConsumoInterno {
  id: string
  salon_id: string
  producto_id: string
  cantidad: number
  nota: string | null
  registrado_por: string
  created_at: string
  producto?: Producto
}

// Venta de un producto de la vitrina (distinta del préstamo/fiado a empleadas).
// El pago (uno o varios medios) se registra aparte, en VentaPago.
export interface Venta {
  id: string
  salon_id: string
  producto_id: string
  cantidad: number
  precio_unitario: number
  total: number
  cliente_nombre: string | null
  metodo_pago: MetodoPago | null
  foto_url: string | null
  nota: string | null
  vendido_por: string
  anulado: boolean
  motivo_anulacion: string | null
  anulado_por: string | null
  anulado_at: string | null
  created_at: string
  producto?: Producto
  vendedor?: Profile
}

// Pago (uno de posiblemente varios) registrado contra una venta.
export interface VentaPago {
  id: string
  // Lo llena el trigger heredar_salon_de_venta en la base de datos -- no
  // hace falta (ni se debe) mandarlo al insertar.
  salon_id: string
  venta_id: string
  monto: number
  metodo_pago: MetodoPago
  foto_url: string | null
  pagado_por: string
  created_at: string
}

// Saldo a favor o reembolso de una clienta, cuando el abono ya pagado
// termina siendo mayor que el total finalmente cobrado (ej. cambió a un
// servicio más barato). "credito" queda disponible para una próxima cita;
// "reembolso" es dinero devuelto (sale de caja) y requiere metodo_pago.
export type ResolucionCredito = 'credito' | 'reembolso'

export interface CreditoCliente {
  id: string
  salon_id: string
  cliente_id: string
  cita_id: string | null
  visita_id: string | null
  monto: number
  resolucion: ResolucionCredito
  metodo_pago: MetodoPago | null
  nota: string | null
  usado: boolean
  usado_en_cita_id: string | null
  creado_por: string
  created_at: string
}

// Saldo pendiente que la dueña decide NO cobrar (cortesía, clienta que no
// volvió, etc.) -- ledger inmutable, solo superadmin. No cuenta como
// dinero que entró a caja (por eso está separado de "cobros").
export interface Condonacion {
  id: string
  salon_id: string
  visita_id: string
  monto: number
  motivo: string
  condonado_por: string
  created_at: string
}

export interface ComparacionDiaria {
  fecha: string
  total_registrado: number
  total_reportado: number
  diferencia: number
}
