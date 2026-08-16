import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy as inicioDeHoy, rangoDiaUTC } from '../lib/fechas'
import { calcularRangoEfectivo, type RangoEfectivo } from '../lib/cierreDia'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import { comprimirImagen } from '../lib/comprimirImagen'
import {
  METODOS_PAGO,
  type Cita,
  type CierreCaja as CierreCajaTipo,
  type Cobro,
  type Condonacion,
  type Consignacion,
  type CreditoCliente,
  type Gasto,
  type MetodoPago,
  type Prestamo,
  type PrestamoPago,
  type RegistroTrabajo,
  type TipoCierreCaja
} from '../types'

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

function horaLocal(iso: string) {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })
}

// Texto corto de comparación (sin explicar la causa) para el contraste en
// vivo por medio de pago -- se usa tanto antes de guardar (contra lo que se
// va escribiendo) como en el reporte ya guardado (contra lo reportado).
function textoDiferencia(a: number, b: number): { texto: string; clase: string } {
  const diff = a - b
  if (Math.abs(diff) <= 1) return { texto: 'coincide ✓', clase: 'text-green-600' }
  return diff > 0
    ? { texto: `sobran ${pesos(diff)}`, clase: 'text-amber-600' }
    : { texto: `faltan ${pesos(-diff)}`, clase: 'text-amber-600' }
}

const CERO_POR_METODO: Record<MetodoPago, number> = { efectivo: 0, nequi: 0, daviplata: 0, datafono: 0, bre_b: 0 }

function sumaPorMetodo<T>(items: T[], metodo: (t: T) => MetodoPago | null, monto: (t: T) => number): Record<MetodoPago, number> {
  const mapa: Record<MetodoPago, number> = { ...CERO_POR_METODO }
  for (const item of items) {
    const m = metodo(item)
    if (m) mapa[m] += monto(item)
  }
  return mapa
}

// El cierre reporta cada medio en su propia columna (no en una tabla de
// líneas), así que hace falta este mapeo para leer/sumar por medio.
function campoReportado(c: CierreCajaTipo, metodo: MetodoPago): number {
  switch (metodo) {
    case 'efectivo': return Number(c.efectivo_entregado)
    case 'nequi': return Number(c.nequi_reportado)
    case 'daviplata': return Number(c.daviplata_reportado)
    case 'datafono': return Number(c.datafono_reportado)
    case 'bre_b': return Number(c.bre_b_reportado)
  }
}

interface CierreConAdmin extends CierreCajaTipo {
  administradora?: { nombre: string }
}

// Una venta de vitrina con sus pagos. Las ventas nuevas registran el pago en
// venta_pagos (permite varios medios); las viejas, de antes de esa tabla,
// solo tienen ventas.metodo_pago -- por eso el fallback, o las ventas
// históricas desaparecerían del cuadre.
interface VentaConPagos {
  id: string
  total: number
  metodo_pago: MetodoPago | null
  pagos: { monto: number; metodo_pago: MetodoPago }[]
}

function pagosDeVenta(v: VentaConPagos): { monto: number; metodo_pago: MetodoPago }[] {
  if (v.pagos.length > 0) return v.pagos
  return v.metodo_pago ? [{ monto: Number(v.total), metodo_pago: v.metodo_pago }] : []
}

export default function CierreCaja() {
  const { profile } = useAuth()
  const esSuperadmin = profile?.rol === 'superadmin'
  const [fecha, setFecha] = useState(inicioDeHoy())

  // Dos cuadres totalmente independientes por día: "servicios" (cobros,
  // ventas de vitrina, préstamos, reembolsos, pago a proveedores) y "abonos"
  // (solo los abonos de citas). Antes se sumaban en un solo número y era
  // imposible saber cuál de los dos fallaba cuando no cuadraba.
  const [tab, setTab] = useState<TipoCierreCaja>('servicios')
  function cambiarTab(t: TipoCierreCaja) {
    setTab(t)
    setMensaje(null)
    setError(null)
  }

  // Formulario del cuadre de servicios
  const [base, setBase] = useState('')
  const [efectivo, setEfectivo] = useState('')
  const [nequi, setNequi] = useState('')
  const [daviplata, setDaviplata] = useState('')
  const [datafono, setDatafono] = useState('')
  const [breB, setBreB] = useState('')
  const [proveedorMonto, setProveedorMonto] = useState('')
  const [proveedorMetodo, setProveedorMetodo] = useState('')
  const [proveedorNota, setProveedorNota] = useState('')
  const [observaciones, setObservaciones] = useState('')

  // Formulario del cuadre de abonos -- mismos 5 medios, sin base ni
  // proveedores (no aplican a abonos).
  const [aboEfectivo, setAboEfectivo] = useState('')
  const [aboNequi, setAboNequi] = useState('')
  const [aboDaviplata, setAboDaviplata] = useState('')
  const [aboDatafono, setAboDatafono] = useState('')
  const [aboBreB, setAboBreB] = useState('')
  const [aboObservaciones, setAboObservaciones] = useState('')

  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Resumen del día seleccionado
  const [trabajos, setTrabajos] = useState<RegistroTrabajo[]>([])
  const [cobros, setCobros] = useState<Cobro[]>([])
  const [ventasHoy, setVentasHoy] = useState<VentaConPagos[]>([])
  const [citasConAbono, setCitasConAbono] = useState<Cita[]>([])
  const [prestamosHoy, setPrestamosHoy] = useState<Prestamo[]>([])
  const [pagosPrestamoHoy, setPagosPrestamoHoy] = useState<PrestamoPago[]>([])
  const [reembolsosHoy, setReembolsosHoy] = useState<CreditoCliente[]>([])
  // Gastos de "caja menor" del día (una copia, unos vasos, un domicilio),
  // cada uno con foto de la factura. Es otra cosa que el pago a proveedores
  // de abajo, que es el proveedor de producto de vitrina.
  const [gastosHoy, setGastosHoy] = useState<Gasto[]>([])
  const [consignacionesHoy, setConsignacionesHoy] = useState<Consignacion[]>([])
  const [cierresServiciosDelDia, setCierresServiciosDelDia] = useState<CierreConAdmin[]>([])
  const [cierresAbonosDelDia, setCierresAbonosDelDia] = useState<CierreConAdmin[]>([])

  // Rango efectivo del "día de caja" (ver src/lib/cierreDia.ts), uno por
  // cuadre: cerrar servicios no corta abonos ni al revés.
  const [rangoServicios, setRangoServicios] = useState<RangoEfectivo | null>(null)
  const [rangoAbonos, setRangoAbonos] = useState<RangoEfectivo | null>(null)
  useEffect(() => {
    let cancelado = false
    Promise.all([calcularRangoEfectivo(fecha, 'servicios'), calcularRangoEfectivo(fecha, 'abonos')])
      .then(([serv, abo]) => {
        if (cancelado) return
        setRangoServicios(serv)
        setRangoAbonos(abo)
      })
    return () => { cancelado = true }
  }, [fecha])

  // Proveedores ya guardados en productos de vitrina, para sugerirlos como
  // autocompletar en "Pago a proveedores" -- sigue aceptando texto libre,
  // por si el pago no es de un producto (ej. servicio de aseo, arriendo).
  const [proveedoresSugeridos, setProveedoresSugeridos] = useState<string[]>([])

  // Prestado pendiente TOTAL (como la Base: siempre visible, sin importar la fecha)
  const [prestamosPendientes, setPrestamosPendientes] = useState<Prestamo[]>([])
  const [pagosPrestamoTodos, setPagosPrestamoTodos] = useState<PrestamoPago[]>([])

  // Desglose de lo trabajado en el día calendario: cuánto quedó cubierto por
  // abono (separando el pagado hoy del pagado otro día, porque el abono se
  // cuadra en la pestaña «Abonos» DEL DÍA EN QUE SE PAGÓ), cuánto sigue
  // pendiente, cuánto se eliminó, y cuánto debe estar cobrado acá.
  const [resumenVisitas, setResumenVisitas] = useState<{
    cobradoServicios: number
    abonoDeHoy: number
    abonoDeOtroDia: number
    pendiente: number
    condonado: number
    detalleOtroDia: { clienteNombre: string; monto: number; detalle: string }[]
  }>({ cobradoServicios: 0, abonoDeHoy: 0, abonoDeOtroDia: 0, pendiente: 0, condonado: 0, detalleOtroDia: [] })

  // Lo trabajado no es un movimiento de caja, así que va por el día
  // calendario puro -- el corte de caja solo mueve dinero, no trabajos.
  useEffect(() => {
    const { desde, hasta } = rangoDiaUTC(fecha)
    supabase
      .from('registros_trabajo')
      .select('*, servicio:servicios(*), empleada:profiles!registros_trabajo_empleada_id_fkey(*)')
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .eq('anulado', false)
      .order('created_at')
      .then(({ data }) => setTrabajos((data as RegistroTrabajo[]) ?? []))
    supabase
      .from('cierres_caja')
      .select('*, administradora:profiles!cierres_caja_administradora_id_fkey(nombre)')
      .eq('fecha', fecha)
      .then(({ data }) => {
        const todos = (data as CierreConAdmin[]) ?? []
        setCierresServiciosDelDia(todos.filter((c) => c.tipo === 'servicios'))
        setCierresAbonosDelDia(todos.filter((c) => c.tipo === 'abonos'))
      })
  }, [fecha])

  useEffect(() => {
    if (!rangoServicios) return
    const { desde, hasta } = rangoServicios
    supabase
      .from('cobros')
      .select('*')
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .then(({ data }) => setCobros((data as Cobro[]) ?? []))
    // Las ventas de vitrina son plata que entra al cajón igual que un cobro
    // de servicio: antes no se consultaban en ningún lado y el "esperado"
    // quedaba corto por lo vendido, apareciendo como dinero que "sobra".
    supabase
      .from('ventas')
      .select('id, total, metodo_pago, pagos:venta_pagos(monto, metodo_pago)')
      .eq('anulado', false)
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .then(({ data }) => setVentasHoy((data as VentaConPagos[]) ?? []))
    // SOLO préstamos de dinero: un insumo fiado o asignado no saca plata del
    // cajón (sale producto de la vitrina, y la deuda se cobra después). Antes
    // se traían todos, y como el insumo no lleva medio de pago aparecía como
    // una salida "sin medio" que inflaba el Salido y descuadraba el efectivo.
    supabase
      .from('prestamos')
      .select('*, persona:profiles!prestamos_persona_id_fkey(nombre)')
      .eq('tipo', 'dinero')
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .then(({ data }) => setPrestamosHoy((data as Prestamo[]) ?? []))
    supabase
      .from('prestamo_pagos')
      .select('*')
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .then(({ data }) => setPagosPrestamoHoy((data as PrestamoPago[]) ?? []))
    supabase
      .from('creditos_clientes')
      .select('*')
      .eq('resolucion', 'reembolso')
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .then(({ data }) => setReembolsosHoy((data as CreditoCliente[]) ?? []))
    supabase
      .from('gastos')
      .select('*')
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .order('created_at')
      .then(({ data }) => setGastosHoy((data as Gasto[]) ?? []))
  }, [rangoServicios])

  // Las consignaciones se guardan contra el DÍA DE CAJA (columna fecha), no
  // contra la hora en que se fue al banco: se puede consignar mañana lo de
  // hoy y sigue perteneciendo al cierre de hoy.
  useEffect(() => {
    supabase
      .from('consignaciones')
      .select('*')
      .eq('fecha', fecha)
      .order('created_at')
      .then(({ data }) => setConsignacionesHoy((data as Consignacion[]) ?? []))
  }, [fecha])

  useEffect(() => {
    if (!rangoAbonos) return
    supabase
      .from('citas')
      .select('*')
      .gte('created_at', rangoAbonos.desde)
      .lt('created_at', rangoAbonos.hasta)
      .gt('abono', 0)
      .neq('estado', 'cancelada')
      .order('created_at', { ascending: false })
      .then(({ data }) => setCitasConAbono((data as Cita[]) ?? []))
  }, [rangoAbonos])

  useEffect(() => {
    supabase.from('prestamos').select('*').eq('pagado', false)
      .then(({ data }) => setPrestamosPendientes((data as Prestamo[]) ?? []))
    supabase.from('prestamo_pagos').select('prestamo_id, monto')
      .then(({ data }) => setPagosPrestamoTodos((data as PrestamoPago[]) ?? []))
    supabase.from('productos').select('proveedor').eq('tipo', 'vitrina').not('proveedor', 'is', null)
      .then(({ data }) => {
        const nombres = (data as { proveedor: string | null }[] ?? []).map((p) => p.proveedor).filter(Boolean) as string[]
        setProveedoresSugeridos([...new Set(nombres)].sort())
      })
  }, [])

  // Para las visitas del día (agrupando trabajos por visita_id, igual que en
  // Cuentas por cobrar), busca sus cobros/abono/condonaciones sin importar
  // qué día se registraron -- así se sabe cuánto de lo trabajado hoy sigue
  // pendiente de verdad, y cuánto ya se cuadró en otra pestaña u otro día.
  useEffect(() => {
    let cancelado = false
    async function calcular() {
      if (trabajos.length === 0 || !rangoServicios || !rangoAbonos) {
        setResumenVisitas({ cobradoServicios: 0, abonoDeHoy: 0, abonoDeOtroDia: 0, pendiente: 0, condonado: 0, detalleOtroDia: [] })
        return
      }
      const cobroEsDeHoy = (iso: string) => iso >= rangoServicios.desde && iso < rangoServicios.hasta
      const abonoEsDeHoy = (iso: string) => iso >= rangoAbonos.desde && iso < rangoAbonos.hasta

      const grupos = new Map<string, RegistroTrabajo[]>()
      for (const r of trabajos) {
        const clave = r.visita_id ?? r.id
        grupos.set(clave, [...(grupos.get(clave) ?? []), r])
      }
      const visitaIds = [...grupos.keys()]
      const citaIds = [...new Set(trabajos.map((r) => r.cita_id).filter(Boolean))] as string[]

      const [{ data: cobrosData }, { data: citasData }, { data: condonacionesData }] = await Promise.all([
        supabase.from('cobros').select('*').in('visita_id', visitaIds),
        citaIds.length > 0 ? supabase.from('citas').select('*').in('id', citaIds) : Promise.resolve({ data: [] as Cita[] }),
        supabase.from('condonaciones').select('*').in('visita_id', visitaIds)
      ])
      if (cancelado) return
      const cobrosPorVisita = (cobrosData as Cobro[]) ?? []
      const citasPorId = (citasData as Cita[]) ?? []
      const condonacionesPorVisita = (condonacionesData as Condonacion[]) ?? []

      let cobradoServicios = 0, abonoDeHoy = 0, abonoDeOtroDia = 0, pendiente = 0, condonado = 0
      const detalleOtroDia: { clienteNombre: string; monto: number; detalle: string }[] = []
      for (const [visitaId, regs] of grupos) {
        const total = regs.reduce((s, r) => s + Number(r.precio_cobrado), 0)
        const clienteNombre = regs[0].cliente_nombre || 'Sin nombre'
        const cita = citasPorId.find((c) => c.id === regs[0].cita_id)
        const abono = cita ? Number(cita.abono) : 0
        const cobrosVisita = cobrosPorVisita.filter((c) => c.visita_id === visitaId)
        const cobradoVisita = cobrosVisita.reduce((s, c) => s + Number(c.monto), 0)
        const condonadoVisita = condonacionesPorVisita.filter((c) => c.visita_id === visitaId).reduce((s, c) => s + Number(c.monto), 0)

        cobradoServicios += cobradoVisita
        condonado += condonadoVisita
        pendiente += Math.max(0, total - abono - cobradoVisita - condonadoVisita)

        // El abono se paga al CREAR la cita: si esa cita no se creó hoy, ese
        // dinero se cuadró en la pestaña «Abonos» de OTRO día, no la de hoy.
        if (abono > 0 && cita) {
          if (abonoEsDeHoy(cita.created_at)) {
            abonoDeHoy += abono
          } else {
            abonoDeOtroDia += abono
            detalleOtroDia.push({ clienteNombre, monto: abono, detalle: `abono del ${cita.created_at.slice(0, 10)}` })
          }
        }
        for (const cb of cobrosVisita) {
          if (!cobroEsDeHoy(cb.created_at)) {
            detalleOtroDia.push({ clienteNombre, monto: Number(cb.monto), detalle: 'cobro registrado otro día' })
          }
        }
      }
      setResumenVisitas({ cobradoServicios, abonoDeHoy, abonoDeOtroDia, pendiente, condonado, detalleOtroDia })
    }
    calcular()
    return () => { cancelado = true }
  }, [trabajos, rangoServicios, rangoAbonos])

  const totalTrabajos = trabajos.reduce((s, t) => s + Number(t.precio_cobrado), 0)

  // Cobrado del día por medio de pago, SEPARADO por cuadre. Cobros de
  // servicios y ventas de vitrina son dos cosas distintas que caen en el
  // mismo cajón: se muestran por separado (para poder auditar cada una) pero
  // se suman para el esperado por medio de pago.
  const pagosDeVentas = ventasHoy.flatMap(pagosDeVenta)
  const porMetodoCobros = sumaPorMetodo(cobros, (c) => c.metodo_pago, (c) => Number(c.monto))
  const porMetodoVentas = sumaPorMetodo(pagosDeVentas, (p) => p.metodo_pago, (p) => Number(p.monto))
  const totalCobrosServicios = cobros.reduce((s, c) => s + Number(c.monto), 0)
  const totalVentasProductos = pagosDeVentas.reduce((s, p) => s + Number(p.monto), 0)
  const porMetodoServicios: Record<MetodoPago, number> = { ...CERO_POR_METODO }
  for (const m of METODOS_PAGO) porMetodoServicios[m.valor] = porMetodoCobros[m.valor] + porMetodoVentas[m.valor]
  const totalCobradoServicios = totalCobrosServicios + totalVentasProductos

  const porMetodoAbonos = sumaPorMetodo(citasConAbono, (c) => c.abono_metodo_pago, (c) => Number(c.abono))
  // El total sale de la lista completa, NO de sumar los 5 medios: un abono
  // guardado sin medio de pago (datos viejos, o una cita creada antes de que
  // el medio fuera obligatorio) no cae en ninguna columna y desaparecería
  // del total, dejando un descuadre imposible de rastrear.
  const totalCobradoAbonos = citasConAbono.reduce((s, c) => s + Number(c.abono), 0)
  const abonosSinMedio = citasConAbono.filter((c) => !c.abono_metodo_pago).reduce((s, c) => s + Number(c.abono), 0)

  // Préstamos del día: lo dado (sale de caja) y lo pagado/recibido (entra a
  // caja). Son movimientos del cuadre de servicios.
  const prestadoHoyPorMetodo: Record<MetodoPago, number> = { ...CERO_POR_METODO }
  let prestadoHoySinMedio = 0
  for (const p of prestamosHoy) {
    if (p.metodo_pago) prestadoHoyPorMetodo[p.metodo_pago] += Number(p.monto)
    else prestadoHoySinMedio += Number(p.monto)
  }
  const totalPrestadoHoy = prestamosHoy.reduce((s, p) => s + Number(p.monto), 0)
  const pagoPrestamoHoyPorMetodo = sumaPorMetodo(pagosPrestamoHoy, (pg) => pg.metodo_pago, (pg) => Number(pg.monto))
  const totalPagoPrestamoHoy = pagosPrestamoHoy.reduce((s, pg) => s + Number(pg.monto), 0)

  // Reembolsos a clientas hoy (sale de caja): saldo a favor que se devolvió
  // en efectivo/transferencia en vez de dejarse como crédito.
  const reembolsadoHoyPorMetodo = sumaPorMetodo(reembolsosHoy, (r) => r.metodo_pago, (r) => Number(r.monto))
  const totalReembolsadoHoy = reembolsosHoy.reduce((s, r) => s + Number(r.monto), 0)

  const gastosPorMetodo = sumaPorMetodo(gastosHoy, (g) => g.metodo_pago, (g) => Number(g.monto))
  const totalGastos = gastosHoy.reduce((s, g) => s + Number(g.monto), 0)

  // Esperado neto por medio del cuadre de SERVICIOS, ANTES de guardar: lo
  // cobrado, más lo que entró por pagos de préstamo, menos lo prestado, lo
  // devuelto a clientas y el pago a proveedores en ese mismo medio.
  const proveedorMontoNum = Number(proveedorMonto || 0)
  const esperadoServiciosPorMetodo: Record<MetodoPago, number> = { ...CERO_POR_METODO }
  for (const m of METODOS_PAGO) {
    esperadoServiciosPorMetodo[m.valor] =
      porMetodoServicios[m.valor]
      + pagoPrestamoHoyPorMetodo[m.valor]
      - prestadoHoyPorMetodo[m.valor]
      - reembolsadoHoyPorMetodo[m.valor]
      - gastosPorMetodo[m.valor]
      - (proveedorMetodo === m.valor ? proveedorMontoNum : 0)
  }

  // Efectivo neto que entró hoy a la caja: es lo que hay para llevar al
  // banco. La base no entra -- se queda para abrir mañana.
  const efectivoAConsignar = esperadoServiciosPorMetodo.efectivo + porMetodoAbonos.efectivo
  const yaConsignado = consignacionesHoy.reduce((s, c) => s + Number(c.monto), 0)
  const faltaPorConsignar = efectivoAConsignar - yaConsignado

  // Reportado ya guardado por medio, sumando TODOS los cierres de esa fecha
  // y ese tipo -- comparado contra lo cobrado simple del día (sin restar
  // salidas, a diferencia del esperado de arriba).
  function reportadoPorMetodoDe(cierres: CierreConAdmin[]): Record<MetodoPago, number> {
    const mapa: Record<MetodoPago, number> = { ...CERO_POR_METODO }
    for (const c of cierres) {
      for (const m of METODOS_PAGO) mapa[m.valor] += campoReportado(c, m.valor)
    }
    return mapa
  }
  const reportadoServiciosPorMetodo = reportadoPorMetodoDe(cierresServiciosDelDia)
  const reportadoAbonosPorMetodo = reportadoPorMetodoDe(cierresAbonosDelDia)

  // Prestado pendiente total (persistente, como la Base).
  const totalPrestadoPendiente = useMemo(() => {
    const pagadoPorPrestamo = new Map<string, number>()
    for (const pg of pagosPrestamoTodos) {
      pagadoPorPrestamo.set(pg.prestamo_id, (pagadoPorPrestamo.get(pg.prestamo_id) ?? 0) + Number(pg.monto))
    }
    return prestamosPendientes.reduce(
      (s, p) => s + Math.max(0, Number(p.monto) - (pagadoPorPrestamo.get(p.id) ?? 0)),
      0
    )
  }, [prestamosPendientes, pagosPrestamoTodos])

  // Resumen del cuadre de servicios: entrado, salido y base.
  const totalEntradoServicios = totalCobradoServicios + totalPagoPrestamoHoy
  const totalSalidoServicios = proveedorMontoNum + totalPrestadoHoy + totalReembolsadoHoy + totalGastos

  // Abre una foto (factura o comprobante) en una pestaña nueva. URL firmada
  // de 5 min, igual que en Cuentas por cobrar.
  async function verFoto(path: string) {
    const { data } = await supabase.storage.from('evidencias').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  // --- Gastos de caja menor (foto de la factura obligatoria) ---
  const [gastoMonto, setGastoMonto] = useState('')
  const [gastoMetodo, setGastoMetodo] = useState<string>('efectivo')
  const [gastoConcepto, setGastoConcepto] = useState('')
  const [gastoFoto, setGastoFoto] = useState<File | null>(null)
  const [guardandoGasto, setGuardandoGasto] = useState(false)
  const [errorGasto, setErrorGasto] = useState<string | null>(null)

  async function registrarGasto() {
    if (!profile) return
    setErrorGasto(null)
    const monto = Number(gastoMonto || 0)
    if (monto <= 0) { setErrorGasto('Escribe el monto del gasto.'); return }
    if (!gastoConcepto.trim()) { setErrorGasto('Escribe en qué se gastó (ej. copia de llave, vasos).'); return }
    if (!gastoFoto) { setErrorGasto('Sube la foto de la factura: es obligatoria para registrar un gasto.'); return }
    setGuardandoGasto(true)
    try {
      const comprimida = await comprimirImagen(gastoFoto)
      const path = `${profile.salon_id}/gastos/${profile.id}/${Date.now()}_${comprimida.name}`
      const { error: upErr } = await supabase.storage.from('evidencias').upload(path, comprimida)
      if (upErr) throw upErr
      const { error } = await supabase.from('gastos').insert({
        salon_id: profile.salon_id,
        monto,
        metodo_pago: gastoMetodo,
        concepto: gastoConcepto.trim(),
        foto_url: path,
        registrado_por: profile.id
      })
      if (error) throw error
      setGastoMonto('')
      setGastoConcepto('')
      setGastoFoto(null)
      if (rangoServicios) {
        const { data } = await supabase.from('gastos').select('*')
          .gte('created_at', rangoServicios.desde).lt('created_at', rangoServicios.hasta).order('created_at')
        setGastosHoy((data as Gasto[]) ?? [])
      }
    } catch (e) {
      setErrorGasto('No se pudo registrar el gasto: ' + (e as Error).message)
    }
    setGuardandoGasto(false)
  }

  async function borrarGasto(g: Gasto) {
    if (!confirm(`¿Borrar el gasto de ${pesos(Number(g.monto))} (${g.concepto})?`)) return
    await supabase.from('gastos').delete().eq('id', g.id)
    setGastosHoy((prev) => prev.filter((x) => x.id !== g.id))
  }

  // --- Consignación del efectivo (comprobante obligatorio) ---
  const [consigMonto, setConsigMonto] = useState('')
  const [consigBanco, setConsigBanco] = useState('')
  const [consigFoto, setConsigFoto] = useState<File | null>(null)
  const [guardandoConsig, setGuardandoConsig] = useState(false)
  const [errorConsig, setErrorConsig] = useState<string | null>(null)
  const [mostrarConsig, setMostrarConsig] = useState(false)

  async function registrarConsignacion() {
    if (!profile) return
    setErrorConsig(null)
    const monto = Number(consigMonto || 0)
    if (monto <= 0) { setErrorConsig('Escribe cuánto se consignó.'); return }
    if (!consigFoto) { setErrorConsig('Sube el comprobante de la consignación: es obligatorio.'); return }
    setGuardandoConsig(true)
    try {
      const comprimida = await comprimirImagen(consigFoto)
      const path = `${profile.salon_id}/consignaciones/${profile.id}/${Date.now()}_${comprimida.name}`
      const { error: upErr } = await supabase.storage.from('evidencias').upload(path, comprimida)
      if (upErr) throw upErr
      const { error } = await supabase.from('consignaciones').insert({
        salon_id: profile.salon_id,
        monto,
        fecha,
        banco: consigBanco.trim() || null,
        foto_url: path,
        registrado_por: profile.id
      })
      if (error) throw error
      setConsigMonto('')
      setConsigBanco('')
      setConsigFoto(null)
      setMostrarConsig(false)
      const { data } = await supabase.from('consignaciones').select('*').eq('fecha', fecha).order('created_at')
      setConsignacionesHoy((data as Consignacion[]) ?? [])
    } catch (e) {
      setErrorConsig('No se pudo registrar la consignación: ' + (e as Error).message)
    }
    setGuardandoConsig(false)
  }

  function recargarCierresDelDia() {
    supabase
      .from('cierres_caja')
      .select('*, administradora:profiles!cierres_caja_administradora_id_fkey(nombre)')
      .eq('fecha', fecha)
      .then(({ data }) => {
        const todos = (data as CierreConAdmin[]) ?? []
        setCierresServiciosDelDia(todos.filter((c) => c.tipo === 'servicios'))
        setCierresAbonosDelDia(todos.filter((c) => c.tipo === 'abonos'))
      })
  }

  async function handleSubmitServicios(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    setMensaje(null)
    if (proveedorMontoNum > 0 && !proveedorMetodo) {
      setError('Elige el medio de pago del pago a proveedores.')
      return
    }
    setGuardando(true)

    const { error } = await supabase.from('cierres_caja').insert({
      salon_id: profile.salon_id,
      fecha,
      administradora_id: profile.id,
      tipo: 'servicios',
      base: Number(base || 0),
      efectivo_entregado: Number(efectivo || 0),
      nequi_reportado: Number(nequi || 0),
      daviplata_reportado: Number(daviplata || 0),
      datafono_reportado: Number(datafono || 0),
      bre_b_reportado: Number(breB || 0),
      proveedor_monto: proveedorMontoNum,
      proveedor_metodo_pago: proveedorMontoNum > 0 ? proveedorMetodo : null,
      proveedor_nota: proveedorNota || null,
      observaciones: observaciones || null
    })

    setGuardando(false)
    if (error) {
      setError(
        error.message.includes('duplicate')
          ? 'Ya existe un cierre de servicios tuyo para esta fecha.'
          : 'No se pudo guardar el cierre de servicios: ' + error.message
      )
    } else {
      setMensaje('Cierre de servicios guardado.')
      setBase('')
      setEfectivo('')
      setNequi('')
      setDaviplata('')
      setDatafono('')
      setBreB('')
      setProveedorMonto('')
      setProveedorMetodo('')
      setProveedorNota('')
      setObservaciones('')
      recargarCierresDelDia()
      // Este cierre puede ser el primero del día (corta el día en dos) --
      // recalcula el rango de servicios para reflejarlo de inmediato.
      calcularRangoEfectivo(fecha, 'servicios').then(setRangoServicios)
    }
  }

  async function handleSubmitAbonos(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    setMensaje(null)
    setGuardando(true)

    const { error } = await supabase.from('cierres_caja').insert({
      salon_id: profile.salon_id,
      fecha,
      administradora_id: profile.id,
      tipo: 'abonos',
      efectivo_entregado: Number(aboEfectivo || 0),
      nequi_reportado: Number(aboNequi || 0),
      daviplata_reportado: Number(aboDaviplata || 0),
      datafono_reportado: Number(aboDatafono || 0),
      bre_b_reportado: Number(aboBreB || 0),
      observaciones: aboObservaciones || null
    })

    setGuardando(false)
    if (error) {
      setError(
        error.message.includes('duplicate')
          ? 'Ya existe un cierre de abonos tuyo para esta fecha.'
          : 'No se pudo guardar el cierre de abonos: ' + error.message
      )
    } else {
      setMensaje('Cierre de abonos guardado.')
      setAboEfectivo('')
      setAboNequi('')
      setAboDaviplata('')
      setAboDatafono('')
      setAboBreB('')
      setAboObservaciones('')
      recargarCierresDelDia()
      calcularRangoEfectivo(fecha, 'abonos').then(setRangoAbonos)
    }
  }

  // Contraste en vivo bajo cada input, contra lo que se va escribiendo --
  // antes de guardar, no después.
  function contrasteInline(escritoStr: string, esperado: number) {
    const texto = `esperado ${pesos(esperado)}`
    if (escritoStr.trim() === '') return <p className="text-[11px] text-gray-400 mt-0.5">{texto}</p>
    const escrito = Number(escritoStr || 0)
    const diff = textoDiferencia(escrito, esperado)
    const extra = diff.texto === 'coincide ✓' ? '· coincide ✓' : `· escribiste ${pesos(escrito)} → ${diff.texto}`
    return <p className={`text-[11px] mt-0.5 ${diff.clase}`}>{texto} {extra}</p>
  }

  // Aviso del corte de caja de cada cuadre. Con la lógica corregida, un
  // corte de AYER significa que hoy INCLUYE la cola de ayer (lo que entró
  // cuando esa caja ya estaba cerrada), no que le falte nada.
  function avisosDeCorte(rango: RangoEfectivo | null, queEs: string) {
    if (!rango) return null
    return (
      <>
        {rango.arrastreDeAyer && (
          <p className="text-xs text-amber-700 mt-1">
            Incluye lo movido ayer después de las {horaLocal(rango.arrastreDeAyer)} — entró cuando {queEs} de ayer ya estaba cerrado.
          </p>
        )}
        {rango.corteDeHoy && (
          <p className="text-xs text-amber-700 mt-1">
            No incluye lo movido después de las {horaLocal(rango.corteDeHoy)} de hoy — como ya se cerró, eso cuenta para el cierre de mañana.
          </p>
        )}
      </>
    )
  }

  function desfasePorMetodo(reportado: Record<MetodoPago, number>, esperado: Record<MetodoPago, number>) {
    const desfases = METODOS_PAGO
      .map((m) => ({ ...m, reportado: reportado[m.valor], esperado: esperado[m.valor], diferencia: reportado[m.valor] - esperado[m.valor] }))
      .filter((d) => Math.abs(d.diferencia) > 1)
    if (desfases.length === 0) {
      return (
        <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg p-2">
          ✓ Lo reportado coincide con lo de ese día, medio por medio.
        </p>
      )
    }
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-1">
        <p className="text-xs font-medium text-amber-800">Desfase por medio de pago:</p>
        {desfases.map((d) => (
          <p key={d.valor} className="text-xs text-amber-700">
            {d.etiqueta}: reportado {pesos(d.reportado)}, esperado {pesos(d.esperado)} →{' '}
            <b>{d.diferencia > 0 ? `sobran ${pesos(d.diferencia)}` : `faltan ${pesos(-d.diferencia)}`}</b>
          </p>
        ))}
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Cierre de caja</h1>
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        <button
          type="button"
          onClick={() => cambiarTab('servicios')}
          className={`flex-1 text-sm font-medium rounded-lg py-2 transition ${tab === 'servicios' ? 'bg-white shadow text-brand-700' : 'text-gray-500'}`}
        >
          Servicios y productos
        </button>
        <button
          type="button"
          onClick={() => cambiarTab('abonos')}
          className={`flex-1 text-sm font-medium rounded-lg py-2 transition ${tab === 'abonos' ? 'bg-white shadow text-brand-700' : 'text-gray-500'}`}
        >
          Abonos
        </button>
      </div>

      {totalPrestadoPendiente > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4">
          <p className="text-xs text-amber-700">Prestado (pendiente de pago)</p>
          <p className="text-2xl font-bold text-amber-800">{pesos(totalPrestadoPendiente)}</p>
        </div>
      )}

      {tab === 'servicios' ? (
        <>
          {/* Resumen: todos los trabajos completados del día */}
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-600">Trabajos completados del día</h2>
              <span className="text-sm font-semibold text-brand-700">Total: {pesos(totalTrabajos)}</span>
            </div>
            <ul className="space-y-1 max-h-56 overflow-y-auto">
              {trabajos.map((t) => (
                <li key={t.id} className="flex justify-between text-sm border-b border-gray-50 pb-1">
                  <span className="min-w-0 truncate">{t.empleada?.nombre} · {t.servicio?.nombre} · {t.cliente_nombre || 'Sin nombre'}</span>
                  <span className="font-medium shrink-0">{pesos(Number(t.precio_cobrado))}</span>
                </li>
              ))}
              {trabajos.length === 0 && <li className="text-sm text-gray-400">Sin trabajos registrados este día.</li>}
            </ul>
            {/* El valor de los trabajos NO es la plata que entró hoy. Este
                cuadre va restando paso a paso lo que se cuadra en otro lado
                (abonos) o lo que no es plata (pendiente, eliminado), hasta
                llegar a una cifra que sí debe coincidir con los cobros. */}
            {trabajos.length > 0 && (
              <dl className="text-xs border-t border-gray-100 mt-2 pt-2 space-y-1">
                <div className="flex justify-between text-gray-500">
                  <dt>Valor de los trabajos</dt>
                  <dd>{pesos(totalTrabajos)}</dd>
                </div>
                {resumenVisitas.abonoDeHoy > 0 && (
                  <div className="flex justify-between text-purple-700">
                    <dt>− Abono pagado hoy <span className="text-purple-400">(cuadra en «Abonos» de hoy)</span></dt>
                    <dd>−{pesos(resumenVisitas.abonoDeHoy)}</dd>
                  </div>
                )}
                {resumenVisitas.abonoDeOtroDia > 0 && (
                  <div className="flex justify-between text-purple-700">
                    <dt>− Abono pagado otro día <span className="text-purple-400">(cuadró en «Abonos» de ese día)</span></dt>
                    <dd>−{pesos(resumenVisitas.abonoDeOtroDia)}</dd>
                  </div>
                )}
                {resumenVisitas.pendiente > 0 && (
                  <div className="flex justify-between text-amber-700 font-medium">
                    <dt>− Pendiente por cobrar</dt>
                    <dd>−{pesos(resumenVisitas.pendiente)}</dd>
                  </div>
                )}
                {resumenVisitas.condonado > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <dt>− Eliminado (no se cobra)</dt>
                    <dd>−{pesos(resumenVisitas.condonado)}</dd>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-gray-700 border-t border-gray-100 pt-1">
                  <dt>= Debe estar cobrado acá</dt>
                  <dd>{pesos(resumenVisitas.cobradoServicios)}</dd>
                </div>
              </dl>
            )}
            {resumenVisitas.detalleOtroDia.length > 0 && (
              <ul className="text-[11px] text-gray-400 pl-3 mt-1 space-y-0.5">
                {resumenVisitas.detalleOtroDia.map((d, i) => (
                  <li key={i}>{d.clienteNombre}: {pesos(d.monto)} ({d.detalle})</li>
                ))}
              </ul>
            )}
          </div>

          {/* Lo cobrado del día por cada medio: cobros de servicios + ventas de vitrina */}
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-600">Cobrado de servicios y productos</h2>
              <span className="text-sm font-semibold text-brand-700">{pesos(totalCobradoServicios)}</span>
            </div>
            <ul className="grid grid-cols-2 gap-2">
              {METODOS_PAGO.map((m) => (
                <li key={m.valor} className="flex justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                  <span>{m.etiqueta}</span>
                  <span className="font-medium">{pesos(porMetodoServicios[m.valor])}</span>
                </li>
              ))}
            </ul>
            <dl className="text-xs mt-2 pt-2 border-t border-gray-100 space-y-1">
              <div className="flex justify-between text-gray-500">
                <dt>Cobros de servicios</dt>
                <dd>{pesos(totalCobrosServicios)}</dd>
              </div>
              <div className="flex justify-between text-gray-500">
                <dt>Ventas de productos (vitrina)</dt>
                <dd>{pesos(totalVentasProductos)}</dd>
              </div>
            </dl>
            {/* La comprobación que cierra el círculo: lo que los trabajos de
                hoy dicen que debió cobrarse acá vs. lo que de verdad se
                cobró. Se compara solo contra COBROS -- las ventas de vitrina
                no vienen de trabajos. */}
            {(() => {
              const diferencia = totalCobrosServicios - resumenVisitas.cobradoServicios
              if (Math.abs(diferencia) < 1) {
                return trabajos.length > 0 ? (
                  <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg p-2 mt-2">
                    ✓ Los {pesos(totalCobrosServicios)} de cobros cuadran con los trabajos del día.
                  </p>
                ) : null
              }
              return (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
                  Los trabajos de hoy dan {pesos(resumenVisitas.cobradoServicios)} cobrados, pero hoy se registraron {pesos(totalCobrosServicios)} en cobros
                  — <b>{diferencia > 0 ? `${pesos(diferencia)} de más` : `${pesos(-diferencia)} de menos`}</b>. Suele ser un saldo de una visita de otro día que se cobró hoy (o al revés).
                </p>
              )
            })()}
            <p className="text-xs text-gray-400 mt-2">
              Cobros de «Cuentas por cobrar» + ventas de vitrina — los abonos de citas están en la pestaña «Abonos».
            </p>
            {avisosDeCorte(rangoServicios, 'la caja')}
          </div>

          {/* Alarma de consignación: cuánto efectivo hay para llevar al banco
              y el registro del comprobante. Se calcula sobre el efectivo NETO
              del día (lo cobrado y abonado en efectivo, menos lo que salió en
              efectivo); la base no entra porque se queda para abrir mañana. */}
          {(faltaPorConsignar > 0 || consignacionesHoy.length > 0) && (
            <div className={`rounded-2xl p-4 space-y-2 border ${faltaPorConsignar > 0 ? 'bg-amber-50 border-amber-300' : 'bg-green-50 border-green-200'}`}>
              <div className="flex items-center justify-between">
                <h2 className={`text-sm font-semibold ${faltaPorConsignar > 0 ? 'text-amber-800' : 'text-green-800'}`}>
                  {faltaPorConsignar > 0 ? '🔔 Falta consignar' : '✓ Consignación registrada'}
                </h2>
                <span className={`text-lg font-bold ${faltaPorConsignar > 0 ? 'text-amber-800' : 'text-green-800'}`}>
                  {pesos(Math.abs(faltaPorConsignar))}
                </span>
              </div>
              <p className="text-xs text-gray-600">
                Efectivo del día: <b>{pesos(efectivoAConsignar)}</b>
                {yaConsignado > 0 && <> · ya consignado: <b>{pesos(yaConsignado)}</b></>}
                {Number(base || 0) > 0 && <> · la base de {pesos(Number(base || 0))} se queda en caja.</>}
              </p>
              {consignacionesHoy.length > 0 && (
                <ul className="space-y-1">
                  {consignacionesHoy.map((c) => (
                    <li key={c.id} className="flex justify-between items-center text-xs bg-white/70 rounded-lg px-2 py-1">
                      <span>{pesos(Number(c.monto))}{c.banco ? ` · ${c.banco}` : ''}</span>
                      <button onClick={() => verFoto(c.foto_url)} className="text-brand-600 underline">Ver comprobante</button>
                    </li>
                  ))}
                </ul>
              )}
              {faltaPorConsignar < -1 && (
                <p className="text-xs text-amber-700">
                  Se consignó {pesos(-faltaPorConsignar)} más que el efectivo del día — revisa si incluye efectivo de días anteriores.
                </p>
              )}
              {!mostrarConsig ? (
                <button
                  onClick={() => { setMostrarConsig(true); setConsigMonto(faltaPorConsignar > 0 ? String(Math.round(faltaPorConsignar)) : '') }}
                  className="text-xs font-medium text-brand-700 underline"
                >
                  Registrar consignación
                </button>
              ) : (
                <div className="space-y-2 bg-white rounded-xl p-3">
                  {errorConsig && <p className="text-xs text-red-600">{errorConsig}</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium mb-1">Monto consignado</label>
                      <input
                        type="text" inputMode="numeric"
                        value={formatearPesosInput(consigMonto)}
                        onChange={(e) => setConsigMonto(soloDigitos(e.target.value))}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Banco (opcional)</label>
                      <input
                        value={consigBanco}
                        onChange={(e) => setConsigBanco(e.target.value)}
                        placeholder="Bancolombia…"
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Comprobante (obligatorio)</label>
                    <input
                      type="file" accept="image/*"
                      onChange={(e) => setConsigFoto(e.target.files?.[0] ?? null)}
                      className="w-full text-xs"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={registrarConsignacion}
                      disabled={guardandoConsig}
                      className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg py-1.5"
                    >
                      {guardandoConsig ? 'Guardando…' : 'Guardar consignación'}
                    </button>
                    <button
                      onClick={() => { setMostrarConsig(false); setErrorConsig(null) }}
                      className="px-3 text-sm border border-gray-300 rounded-lg"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Gastos de caja menor: lo que se compra afuera en el día. La foto
              de la factura es obligatoria (la exige también la base de datos). */}
          <div className="bg-white rounded-2xl shadow p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-600">Gastos del día (caja menor)</h2>
              {totalGastos > 0 && <span className="text-sm font-semibold text-red-600">−{pesos(totalGastos)}</span>}
            </div>
            <p className="text-xs text-gray-400">
              Lo que se compra afuera: una copia, unos vasos, un domicilio. Distinto del pago a proveedores de abajo,
              que es el proveedor de producto de vitrina. Sale del esperado del medio con que se pagó.
            </p>
            {gastosHoy.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {gastosHoy.map((g) => (
                  <li key={g.id} className="py-1.5 flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate">{g.concepto}</span>
                      <span className="block text-xs text-gray-400">
                        {METODOS_PAGO.find((m) => m.valor === g.metodo_pago)?.etiqueta}
                        {' · '}
                        <button onClick={() => verFoto(g.foto_url)} className="text-brand-600 underline">Ver factura</button>
                        {esSuperadmin && (
                          <> · <button onClick={() => borrarGasto(g)} className="text-red-500 underline">Borrar</button></>
                        )}
                      </span>
                    </span>
                    <span className="font-medium shrink-0 text-red-600">−{pesos(Number(g.monto))}</span>
                  </li>
                ))}
              </ul>
            )}
            {errorGasto && <p className="text-xs text-red-600">{errorGasto}</p>}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Monto</label>
                <input
                  type="text" inputMode="numeric"
                  value={formatearPesosInput(gastoMonto)}
                  onChange={(e) => setGastoMonto(soloDigitos(e.target.value))}
                  placeholder="0"
                  className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Medio de pago</label>
                <select
                  value={gastoMetodo}
                  onChange={(e) => setGastoMetodo(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                </select>
              </div>
            </div>
            <input
              value={gastoConcepto}
              onChange={(e) => setGastoConcepto(e.target.value)}
              placeholder="¿En qué se gastó? (ej. copia de llave)"
              className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
            <div>
              <label className="block text-xs font-medium mb-1">Foto de la factura (obligatoria)</label>
              <input
                type="file" accept="image/*"
                onChange={(e) => setGastoFoto(e.target.files?.[0] ?? null)}
                className="w-full text-xs"
              />
            </div>
            <button
              onClick={registrarGasto}
              disabled={guardandoGasto}
              className="w-full border border-brand-300 text-brand-700 disabled:opacity-50 text-sm font-medium rounded-lg py-1.5"
            >
              {guardandoGasto ? 'Guardando…' : 'Registrar gasto'}
            </button>
          </div>

          {/* Préstamos del día: lo dado y lo recibido de vuelta */}
          {(totalPrestadoHoy > 0 || totalPagoPrestamoHoy > 0) && (
            <div className="bg-white rounded-2xl shadow p-4 space-y-2">
              <h2 className="text-sm font-semibold text-gray-600">Préstamos del día</h2>
              {totalPrestadoHoy > 0 && (
                <div>
                  <p className="text-xs text-gray-500">Dado hoy (sale de caja): <b className="text-red-600">{pesos(totalPrestadoHoy)}</b></p>
                  <ul className="grid grid-cols-2 gap-1 mt-1">
                    {METODOS_PAGO.map((m) => prestadoHoyPorMetodo[m.valor] > 0 && (
                      <li key={m.valor} className="flex justify-between text-xs bg-red-50 rounded-lg px-2 py-1">
                        <span>{m.etiqueta}</span><span className="font-medium">{pesos(prestadoHoyPorMetodo[m.valor])}</span>
                      </li>
                    ))}
                    {prestadoHoySinMedio > 0 && (
                      <li className="flex justify-between text-xs bg-red-50 rounded-lg px-2 py-1">
                        <span>Sin medio</span><span className="font-medium">{pesos(prestadoHoySinMedio)}</span>
                      </li>
                    )}
                  </ul>
                </div>
              )}
              {totalPagoPrestamoHoy > 0 && (
                <div>
                  <p className="text-xs text-gray-500">Pagado/recibido hoy (entra a caja): <b className="text-green-600">{pesos(totalPagoPrestamoHoy)}</b></p>
                  <ul className="grid grid-cols-2 gap-1 mt-1">
                    {METODOS_PAGO.map((m) => pagoPrestamoHoyPorMetodo[m.valor] > 0 && (
                      <li key={m.valor} className="flex justify-between text-xs bg-green-50 rounded-lg px-2 py-1">
                        <span>{m.etiqueta}</span><span className="font-medium">{pesos(pagoPrestamoHoyPorMetodo[m.valor])}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Reembolsos a clientas: saldo a favor que se devolvió en vez de dejarse como crédito */}
          {totalReembolsadoHoy > 0 && (
            <div className="bg-white rounded-2xl shadow p-4 space-y-2">
              <h2 className="text-sm font-semibold text-gray-600">Reembolsos a clientas hoy</h2>
              <p className="text-xs text-gray-500">Sale de caja: <b className="text-red-600">{pesos(totalReembolsadoHoy)}</b></p>
              <ul className="grid grid-cols-2 gap-1">
                {METODOS_PAGO.map((m) => reembolsadoHoyPorMetodo[m.valor] > 0 && (
                  <li key={m.valor} className="flex justify-between text-xs bg-red-50 rounded-lg px-2 py-1">
                    <span>{m.etiqueta}</span><span className="font-medium">{pesos(reembolsadoHoyPorMetodo[m.valor])}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-gray-400">Saldo a favor de una clienta (abonó más de lo que terminó costando el servicio) que se devolvió en vez de dejarse como crédito. Se resuelve en «Cuentas por cobrar».</p>
            </div>
          )}

          {esSuperadmin && (
            <div className="bg-white rounded-2xl shadow p-4 space-y-3">
              <h2 className="text-sm font-semibold text-gray-600">Reporte del día — servicios</h2>
              {cierresServiciosDelDia.length === 0 ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  Aún no se ha hecho el cierre de servicios de este día.
                </p>
              ) : (
                <>
                {cierresServiciosDelDia.length > 1 && (
                  <p className="text-xs text-gray-400">Hay {cierresServiciosDelDia.length} cierres de servicios este día — se suman todos en la comparación de abajo.</p>
                )}
                {cierresServiciosDelDia.map((c) => (
                  <div key={c.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                    <p className="text-xs text-gray-400">Cerrado por {c.administradora?.nombre ?? 'admin'}</p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-gray-50 rounded-lg py-2">
                        <p className="text-[11px] text-gray-500">Base</p>
                        <p className="text-sm font-semibold">{pesos(Number(c.base))}</p>
                      </div>
                      <div className="bg-green-50 rounded-lg py-2">
                        <p className="text-[11px] text-green-700">Entrado</p>
                        <p className="text-sm font-semibold text-green-700">
                          {pesos(METODOS_PAGO.reduce((s, m) => s + campoReportado(c, m.valor), 0))}
                        </p>
                      </div>
                      <div className="bg-red-50 rounded-lg py-2">
                        <p className="text-[11px] text-red-700">Salido</p>
                        <p className="text-sm font-semibold text-red-700">
                          {pesos(Number(c.proveedor_monto) + totalPrestadoHoy + totalReembolsadoHoy + totalGastos)}
                        </p>
                      </div>
                    </div>
                    <ul className="grid grid-cols-2 gap-1 text-xs">
                      {METODOS_PAGO.map((m) => (
                        <li key={m.valor} className="flex justify-between bg-gray-50 rounded-lg px-2 py-1">
                          <span>{m.etiqueta}</span>
                          <span className="font-medium">{pesos(campoReportado(c, m.valor))}</span>
                        </li>
                      ))}
                    </ul>
                    {Number(c.proveedor_monto) > 0 && (
                      <p className="text-xs text-gray-500">
                        Pago a proveedores: {pesos(Number(c.proveedor_monto))}
                        {c.proveedor_metodo_pago ? ` (${c.proveedor_metodo_pago})` : ''}
                        {c.proveedor_nota ? ` · ${c.proveedor_nota}` : ''}
                      </p>
                    )}
                    {c.observaciones && <p className="text-xs text-gray-500">Obs: {c.observaciones}</p>}
                    <p className="text-sm font-semibold text-brand-700 text-center pt-1">
                      Cierre registrado correctamente ✓
                    </p>
                  </div>
                ))}
                {desfasePorMetodo(reportadoServiciosPorMetodo, porMetodoServicios)}
                </>
              )}
            </div>
          )}

          <form onSubmit={handleSubmitServicios} className="bg-white rounded-2xl shadow p-4 space-y-4">
              {esSuperadmin && (
                <p className="text-xs text-gray-400">
                  Como dueña también puedes registrar tu propio cierre de servicios (de este día o de una fecha atrasada,
                  cambiando el selector de arriba) — por ejemplo si tomaste la caja tú misma, o para corregir uno mal
                  hecho. Queda como un registro nuevo aparte; el original no se edita ni se borra.
                </p>
              )}
              {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
              {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

              <div>
                <label className="block text-sm font-medium mb-1">Base (efectivo inicial)</label>
                <input
                  type="text" inputMode="numeric"
                  value={formatearPesosInput(base)}
                  onChange={(e) => setBase(soloDigitos(e.target.value))}
                  placeholder="0"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Efectivo</label>
                  <input
                    type="text" inputMode="numeric" required
                    value={formatearPesosInput(efectivo)}
                    onChange={(e) => setEfectivo(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                  {contrasteInline(efectivo, esperadoServiciosPorMetodo.efectivo)}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Nequi</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(nequi)}
                    onChange={(e) => setNequi(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                  {contrasteInline(nequi, esperadoServiciosPorMetodo.nequi)}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Daviplata</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(daviplata)}
                    onChange={(e) => setDaviplata(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                  {contrasteInline(daviplata, esperadoServiciosPorMetodo.daviplata)}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Datáfono</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(datafono)}
                    onChange={(e) => setDatafono(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                  {contrasteInline(datafono, esperadoServiciosPorMetodo.datafono)}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Bre-B</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(breB)}
                    onChange={(e) => setBreB(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                  {contrasteInline(breB, esperadoServiciosPorMetodo.bre_b)}
                </div>
              </div>

              <p className="text-sm font-medium text-brand-700">
                Total reportado: {pesos(Number(efectivo || 0) + Number(nequi || 0) + Number(daviplata || 0) + Number(datafono || 0) + Number(breB || 0))}
              </p>

              <div className="border-t border-gray-100 pt-3 space-y-3">
                <h3 className="text-sm font-semibold text-gray-600">Pago a proveedores (opcional)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Monto pagado</label>
                    <input
                      type="text" inputMode="numeric"
                      value={formatearPesosInput(proveedorMonto)}
                      onChange={(e) => setProveedorMonto(soloDigitos(e.target.value))}
                      placeholder="0"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Medio de pago</label>
                    <select
                      value={proveedorMetodo}
                      onChange={(e) => setProveedorMetodo(e.target.value)}
                      disabled={!(proveedorMontoNum > 0)}
                      required={proveedorMontoNum > 0}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-400"
                    >
                      <option value="">{proveedorMontoNum > 0 ? 'Selecciona…' : '(sin pago)'}</option>
                      {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                    </select>
                  </div>
                </div>
                {proveedorMontoNum > 0 && (
                  <>
                    <input
                      list="proveedores-sugeridos"
                      value={proveedorNota}
                      onChange={(e) => setProveedorNota(e.target.value)}
                      placeholder="¿A quién / por qué? (opcional)"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <datalist id="proveedores-sugeridos">
                      {proveedoresSugeridos.map((p) => <option key={p} value={p} />)}
                    </datalist>
                  </>
                )}
              </div>

              <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[11px] text-gray-500">Base</p>
                  <p className="text-sm font-semibold">{pesos(Number(base || 0))}</p>
                </div>
                <div>
                  <p className="text-[11px] text-green-700">Entrado</p>
                  <p className="text-sm font-semibold text-green-700">{pesos(totalEntradoServicios)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-red-700">Salido</p>
                  <p className="text-sm font-semibold text-red-700">{pesos(totalSalidoServicios)}</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Observaciones</label>
                <textarea
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  rows={3}
                />
              </div>

              <p className="text-xs text-gray-400">
                Este cierre no se puede editar ni borrar después de guardado. Si te equivocaste, crea uno nuevo
                explicando el motivo en observaciones — la dueña verá ambos.
              </p>

              <button
                type="submit"
                disabled={guardando}
                className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition"
              >
                {guardando ? 'Guardando…' : 'Guardar cierre de servicios'}
              </button>
          </form>
        </>
      ) : (
        <>
          {/* Abonos de citas cobrados este día, itemizados, para poder
              cruzarlos uno por uno contra lo que se anota aparte. */}
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-600">Abonos de citas cobrados hoy</h2>
              <span className="text-sm font-semibold text-brand-700">{pesos(totalCobradoAbonos)}</span>
            </div>
            <ul className="grid grid-cols-2 gap-2 mb-3">
              {METODOS_PAGO.map((m) => (
                <li key={m.valor} className="flex justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                  <span>{m.etiqueta}</span>
                  <span className="font-medium">{pesos(porMetodoAbonos[m.valor])}</span>
                </li>
              ))}
              {abonosSinMedio > 0 && (
                <li className="flex justify-between text-sm bg-amber-50 rounded-lg px-3 py-2">
                  <span className="text-amber-800">Sin medio</span>
                  <span className="font-medium text-amber-800">{pesos(abonosSinMedio)}</span>
                </li>
              )}
            </ul>
            {abonosSinMedio > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-2">
                Hay {pesos(abonosSinMedio)} en abonos guardados sin medio de pago. Están dentro del total de arriba,
                pero no caen en ninguna columna — hay que corregir esas citas para poder cuadrar medio por medio.
              </p>
            )}
            <ul className="space-y-1 max-h-56 overflow-y-auto border-t border-gray-100 pt-2">
              {citasConAbono.map((c) => (
                <li key={c.id} className="flex justify-between text-sm border-b border-gray-50 pb-1">
                  <span className="min-w-0 truncate">
                    {c.cliente_nombre || 'Sin nombre'}
                    {c.abono_metodo_pago ? ` · ${METODOS_PAGO.find((m) => m.valor === c.abono_metodo_pago)?.etiqueta}` : ' · sin medio'}
                    {c.fecha !== fecha && <span className="text-gray-400"> (cita del {c.fecha})</span>}
                  </span>
                  <span className="font-medium shrink-0">{pesos(Number(c.abono))}</span>
                </li>
              ))}
              {citasConAbono.length === 0 && <li className="text-sm text-gray-400">Sin abonos este día.</li>}
            </ul>
            <p className="text-xs text-gray-400 mt-2">
              Solo abonos de citas — lo cobrado en servicios y productos está en la pestaña «Servicios y productos».
            </p>
            {avisosDeCorte(rangoAbonos, 'el cuadre de abonos')}
          </div>

          {esSuperadmin && (
            <div className="bg-white rounded-2xl shadow p-4 space-y-3">
              <h2 className="text-sm font-semibold text-gray-600">Reporte del día — abonos</h2>
              {cierresAbonosDelDia.length === 0 ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  Aún no se ha hecho el cierre de abonos de este día.
                </p>
              ) : (
                <>
                {cierresAbonosDelDia.length > 1 && (
                  <p className="text-xs text-gray-400">Hay {cierresAbonosDelDia.length} cierres de abonos este día — se suman todos en la comparación de abajo.</p>
                )}
                {cierresAbonosDelDia.map((c) => (
                  <div key={c.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                    <p className="text-xs text-gray-400">Cerrado por {c.administradora?.nombre ?? 'admin'}</p>
                    <p className="text-center text-sm font-semibold text-brand-700">
                      Reportado: {pesos(METODOS_PAGO.reduce((s, m) => s + campoReportado(c, m.valor), 0))}
                    </p>
                    <ul className="grid grid-cols-2 gap-1 text-xs">
                      {METODOS_PAGO.map((m) => (
                        <li key={m.valor} className="flex justify-between bg-gray-50 rounded-lg px-2 py-1">
                          <span>{m.etiqueta}</span>
                          <span className="font-medium">{pesos(campoReportado(c, m.valor))}</span>
                        </li>
                      ))}
                    </ul>
                    {c.observaciones && <p className="text-xs text-gray-500">Obs: {c.observaciones}</p>}
                    <p className="text-sm font-semibold text-brand-700 text-center pt-1">
                      Cierre registrado correctamente ✓
                    </p>
                  </div>
                ))}
                {desfasePorMetodo(reportadoAbonosPorMetodo, porMetodoAbonos)}
                </>
              )}
            </div>
          )}

          <form onSubmit={handleSubmitAbonos} className="bg-white rounded-2xl shadow p-4 space-y-4">
              {esSuperadmin && (
                <p className="text-xs text-gray-400">
                  Como dueña también puedes registrar tu propio cierre de abonos de cualquier fecha, o corregir uno mal
                  hecho — queda como un registro nuevo aparte; el original no se edita ni se borra.
                </p>
              )}
              {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
              {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Efectivo</label>
                  <input
                    type="text" inputMode="numeric" required
                    value={formatearPesosInput(aboEfectivo)}
                    onChange={(e) => setAboEfectivo(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                  {contrasteInline(aboEfectivo, porMetodoAbonos.efectivo)}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Nequi</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(aboNequi)}
                    onChange={(e) => setAboNequi(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                  {contrasteInline(aboNequi, porMetodoAbonos.nequi)}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Daviplata</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(aboDaviplata)}
                    onChange={(e) => setAboDaviplata(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                  {contrasteInline(aboDaviplata, porMetodoAbonos.daviplata)}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Datáfono</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(aboDatafono)}
                    onChange={(e) => setAboDatafono(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                  {contrasteInline(aboDatafono, porMetodoAbonos.datafono)}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Bre-B</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(aboBreB)}
                    onChange={(e) => setAboBreB(soloDigitos(e.target.value))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                  {contrasteInline(aboBreB, porMetodoAbonos.bre_b)}
                </div>
              </div>

              <p className="text-sm font-medium text-brand-700">
                Total reportado: {pesos(Number(aboEfectivo || 0) + Number(aboNequi || 0) + Number(aboDaviplata || 0) + Number(aboDatafono || 0) + Number(aboBreB || 0))}
              </p>

              <div>
                <label className="block text-sm font-medium mb-1">Observaciones</label>
                <textarea
                  value={aboObservaciones}
                  onChange={(e) => setAboObservaciones(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  rows={3}
                />
              </div>

              <p className="text-xs text-gray-400">
                Este cierre no se puede editar ni borrar después de guardado. Si te equivocaste, crea uno nuevo
                explicando el motivo en observaciones — la dueña verá ambos.
              </p>

              <button
                type="submit"
                disabled={guardando}
                className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition"
              >
                {guardando ? 'Guardando…' : 'Guardar cierre de abonos'}
              </button>
          </form>
        </>
      )}
    </div>
  )
}
