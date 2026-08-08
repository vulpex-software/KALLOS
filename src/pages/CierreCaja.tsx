import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy as inicioDeHoy, rangoDiaUTC } from '../lib/fechas'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import {
  METODOS_PAGO,
  type Cita,
  type CierreCaja as CierreCajaTipo,
  type Cobro,
  type Condonacion,
  type CreditoCliente,
  type MetodoPago,
  type Prestamo,
  type PrestamoPago,
  type RegistroTrabajo
} from '../types'

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
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

interface CierreConAdmin extends CierreCajaTipo {
  administradora?: { nombre: string }
}

export default function CierreCaja() {
  const { profile } = useAuth()
  const esSuperadmin = profile?.rol === 'superadmin'
  const [fecha, setFecha] = useState(inicioDeHoy())
  const [base, setBase] = useState('')
  const [efectivo, setEfectivo] = useState('')
  const [nequi, setNequi] = useState('')
  const [daviplata, setDaviplata] = useState('')
  const [datafono, setDatafono] = useState('')
  const [proveedorMonto, setProveedorMonto] = useState('')
  const [proveedorMetodo, setProveedorMetodo] = useState('')
  const [proveedorNota, setProveedorNota] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Resumen del día seleccionado
  const [trabajos, setTrabajos] = useState<RegistroTrabajo[]>([])
  const [cobros, setCobros] = useState<Cobro[]>([])
  const [citasConAbono, setCitasConAbono] = useState<Cita[]>([])
  const [prestamosHoy, setPrestamosHoy] = useState<Prestamo[]>([])
  const [pagosPrestamoHoy, setPagosPrestamoHoy] = useState<PrestamoPago[]>([])
  const [reembolsosHoy, setReembolsosHoy] = useState<CreditoCliente[]>([])
  const [cierresDelDia, setCierresDelDia] = useState<CierreConAdmin[]>([])

  // Prestado pendiente TOTAL (como la Base: siempre visible, sin importar la fecha)
  const [prestamosPendientes, setPrestamosPendientes] = useState<Prestamo[]>([])
  const [pagosPrestamoTodos, setPagosPrestamoTodos] = useState<PrestamoPago[]>([])

  // Desglose de lo trabajado HOY: cobrado/pendiente/eliminado por visita,
  // sin importar en qué día se registró el cobro/condonación (a diferencia
  // de "Cobrado del día por medio de pago", que es de dinero que entró hoy
  // sin importar de qué visita). Mismo patrón de agrupar por visita_id que
  // Cuentas por cobrar.
  const [resumenVisitasHoy, setResumenVisitasHoy] = useState({ cobrado: 0, pendiente: 0, condonado: 0 })

  useEffect(() => {
    async function calcular() {
      if (trabajos.length === 0) {
        setResumenVisitasHoy({ cobrado: 0, pendiente: 0, condonado: 0 })
        return
      }
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
      const cobrosPorVisita = (cobrosData as Cobro[]) ?? []
      const citasPorId = (citasData as Cita[]) ?? []
      const condonacionesPorVisita = (condonacionesData as Condonacion[]) ?? []

      let cobrado = 0, pendiente = 0, condonado = 0
      for (const [visitaId, regs] of grupos) {
        const total = regs.reduce((s, r) => s + Number(r.precio_cobrado), 0)
        const cita = citasPorId.find((c) => c.id === regs[0].cita_id)
        const abono = cita ? Number(cita.abono) : 0
        const cobradoVisita = cobrosPorVisita.filter((c) => c.visita_id === visitaId).reduce((s, c) => s + Number(c.monto), 0)
        const condonadoVisita = condonacionesPorVisita.filter((c) => c.visita_id === visitaId).reduce((s, c) => s + Number(c.monto), 0)
        cobrado += cobradoVisita
        condonado += condonadoVisita
        pendiente += Math.max(0, total - abono - cobradoVisita - condonadoVisita)
      }
      setResumenVisitasHoy({ cobrado, pendiente, condonado })
    }
    calcular()
  }, [trabajos])

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
      .from('cobros')
      .select('*')
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .then(({ data }) => setCobros((data as Cobro[]) ?? []))
    supabase
      .from('citas')
      .select('*')
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .gt('abono', 0)
      .neq('estado', 'cancelada')
      .then(({ data }) => setCitasConAbono((data as Cita[]) ?? []))
    supabase
      .from('prestamos')
      .select('*, persona:profiles!prestamos_persona_id_fkey(nombre)')
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
      .from('cierres_caja')
      .select('*, administradora:profiles!cierres_caja_administradora_id_fkey(nombre)')
      .eq('fecha', fecha)
      .then(({ data }) => setCierresDelDia((data as CierreConAdmin[]) ?? []))
  }, [fecha])

  useEffect(() => {
    supabase.from('prestamos').select('*').eq('pagado', false)
      .then(({ data }) => setPrestamosPendientes((data as Prestamo[]) ?? []))
    supabase.from('prestamo_pagos').select('prestamo_id, monto')
      .then(({ data }) => setPagosPrestamoTodos((data as PrestamoPago[]) ?? []))
  }, [])

  const totalTrabajos = trabajos.reduce((s, t) => s + Number(t.precio_cobrado), 0)

  // Total esperado por cada medio de pago: cobros del día + abonos pagados ese día.
  const porMetodo: Record<MetodoPago, number> = { efectivo: 0, nequi: 0, daviplata: 0, datafono: 0 }
  for (const c of cobros) porMetodo[c.metodo_pago] += Number(c.monto)
  for (const c of citasConAbono) {
    if (c.abono_metodo_pago) porMetodo[c.abono_metodo_pago] += Number(c.abono)
  }
  const totalEsperado = Object.values(porMetodo).reduce((s, v) => s + v, 0)

  // Préstamos del día: lo dado (sale de caja) y lo pagado/recibido (entra a caja).
  const prestadoHoyPorMetodo: Record<MetodoPago, number> = { efectivo: 0, nequi: 0, daviplata: 0, datafono: 0 }
  let prestadoHoySinMedio = 0
  for (const p of prestamosHoy) {
    if (p.metodo_pago) prestadoHoyPorMetodo[p.metodo_pago] += Number(p.monto)
    else prestadoHoySinMedio += Number(p.monto)
  }
  const totalPrestadoHoy = prestamosHoy.reduce((s, p) => s + Number(p.monto), 0)
  const pagoPrestamoHoyPorMetodo: Record<MetodoPago, number> = { efectivo: 0, nequi: 0, daviplata: 0, datafono: 0 }
  for (const pg of pagosPrestamoHoy) pagoPrestamoHoyPorMetodo[pg.metodo_pago] += Number(pg.monto)
  const totalPagoPrestamoHoy = pagosPrestamoHoy.reduce((s, pg) => s + Number(pg.monto), 0)

  // Reembolsos a clientas hoy (sale de caja): saldo a favor que se devolvió
  // en efectivo/transferencia en vez de dejarse como crédito.
  const reembolsadoHoyPorMetodo: Record<MetodoPago, number> = { efectivo: 0, nequi: 0, daviplata: 0, datafono: 0 }
  for (const r of reembolsosHoy) {
    if (r.metodo_pago) reembolsadoHoyPorMetodo[r.metodo_pago] += Number(r.monto)
  }
  const totalReembolsadoHoy = reembolsosHoy.reduce((s, r) => s + Number(r.monto), 0)

  // Esperado por medio de pago ANTES de guardar (Cambio 4): lo cobrado hoy
  // en ese medio, más lo que entró/salió hoy por préstamos y reembolsos, y
  // menos el pago a proveedores si fue en ese medio -- para contrastar en
  // vivo contra lo que se va escribiendo en el formulario.
  const proveedorMontoNum = Number(proveedorMonto || 0)
  const esperadoPorMetodo: Record<MetodoPago, number> = { efectivo: 0, nequi: 0, daviplata: 0, datafono: 0 }
  for (const m of METODOS_PAGO) {
    esperadoPorMetodo[m.valor] =
      porMetodo[m.valor]
      + pagoPrestamoHoyPorMetodo[m.valor]
      - prestadoHoyPorMetodo[m.valor]
      - reembolsadoHoyPorMetodo[m.valor]
      - (proveedorMetodo === m.valor ? proveedorMontoNum : 0)
  }

  // Reportado ya guardado por medio, sumando TODOS los cierres de esta
  // fecha (Cambio 5) -- comparado contra lo cobrado simple del día (sin
  // restar salidas, a diferencia del esperado de arriba).
  const reportadoPorMetodo: Record<MetodoPago, number> = { efectivo: 0, nequi: 0, daviplata: 0, datafono: 0 }
  for (const c of cierresDelDia) {
    reportadoPorMetodo.efectivo += Number(c.efectivo_entregado)
    reportadoPorMetodo.nequi += Number(c.nequi_reportado)
    reportadoPorMetodo.daviplata += Number(c.daviplata_reportado)
    reportadoPorMetodo.datafono += Number(c.datafono_reportado)
  }

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

  // Resumen del día: entrado, salido y base (lo que pide superadmin para verificar).
  const totalEntradoDia = totalEsperado + totalPagoPrestamoHoy
  const totalSalidoDia = Number(proveedorMonto || 0) + totalPrestadoHoy + totalReembolsadoHoy

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    setMensaje(null)
    if (Number(proveedorMonto || 0) > 0 && !proveedorMetodo) {
      setError('Elige el medio de pago del pago a proveedores.')
      return
    }
    setGuardando(true)

    const { error } = await supabase.from('cierres_caja').insert({
      salon_id: profile.salon_id,
      fecha,
      administradora_id: profile.id,
      base: Number(base || 0),
      efectivo_entregado: Number(efectivo || 0),
      nequi_reportado: Number(nequi || 0),
      daviplata_reportado: Number(daviplata || 0),
      datafono_reportado: Number(datafono || 0),
      proveedor_monto: Number(proveedorMonto || 0),
      proveedor_metodo_pago: Number(proveedorMonto || 0) > 0 ? proveedorMetodo : null,
      proveedor_nota: proveedorNota || null,
      observaciones: observaciones || null
    })

    setGuardando(false)
    if (error) {
      setError(
        error.message.includes('duplicate')
          ? 'Ya existe un cierre de caja para esta fecha.'
          : 'No se pudo guardar el cierre de caja.'
      )
    } else {
      setMensaje('Cierre de caja guardado.')
      setBase('')
      setEfectivo('')
      setNequi('')
      setDaviplata('')
      setDatafono('')
      setProveedorMonto('')
      setProveedorMetodo('')
      setProveedorNota('')
      setObservaciones('')
      supabase
        .from('cierres_caja')
        .select('*, administradora:profiles!cierres_caja_administradora_id_fkey(nombre)')
        .eq('fecha', fecha)
        .then(({ data }) => setCierresDelDia((data as CierreConAdmin[]) ?? []))
    }
  }

  // Cambio 4: contraste en vivo bajo cada input, contra lo que se va
  // escribiendo -- antes de guardar, no después.
  function contrasteInline(escritoStr: string, esperado: number) {
    const base = `esperado ${pesos(esperado)}`
    if (escritoStr.trim() === '') return <p className="text-[11px] text-gray-400 mt-0.5">{base}</p>
    const escrito = Number(escritoStr || 0)
    const diff = textoDiferencia(escrito, esperado)
    const extra = diff.texto === 'coincide ✓' ? '· coincide ✓' : `· escribiste ${pesos(escrito)} → ${diff.texto}`
    return <p className={`text-[11px] mt-0.5 ${diff.clase}`}>{base} {extra}</p>
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

      {totalPrestadoPendiente > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4">
          <p className="text-xs text-amber-700">Prestado (pendiente de pago)</p>
          <p className="text-2xl font-bold text-amber-800">{pesos(totalPrestadoPendiente)}</p>
        </div>
      )}

      {/* Resumen: todos los trabajos completados del día */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-600">Trabajos completados del día</h2>
          <span className="text-sm font-semibold text-brand-700">Total: {pesos(totalTrabajos)}</span>
        </div>
        {trabajos.length > 0 && (
          <p className="text-xs text-gray-500 mb-2">
            Cobrado {pesos(resumenVisitasHoy.cobrado)}
            {resumenVisitasHoy.pendiente > 0 && <> · pendiente {pesos(resumenVisitasHoy.pendiente)}</>}
            {resumenVisitasHoy.condonado > 0 && <> · eliminado {pesos(resumenVisitasHoy.condonado)}</>}
          </p>
        )}
        <ul className="space-y-1 max-h-56 overflow-y-auto">
          {trabajos.map((t) => (
            <li key={t.id} className="flex justify-between text-sm border-b border-gray-50 pb-1">
              <span className="min-w-0 truncate">{t.empleada?.nombre} · {t.servicio?.nombre} · {t.cliente_nombre || 'Sin nombre'}</span>
              <span className="font-medium shrink-0">{pesos(Number(t.precio_cobrado))}</span>
            </li>
          ))}
          {trabajos.length === 0 && <li className="text-sm text-gray-400">Sin trabajos registrados este día.</li>}
        </ul>
      </div>

      {/* Lo cobrado del día por cada medio (cobros registrados + abonos de citas) */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-600">Cobrado del día por medio de pago</h2>
          <span className="text-sm font-semibold text-brand-700">{pesos(totalEsperado)}</span>
        </div>
        <ul className="grid grid-cols-2 gap-2">
          {METODOS_PAGO.map((m) => (
            <li key={m.valor} className="flex justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
              <span>{m.etiqueta}</span>
              <span className="font-medium">{pesos(porMetodo[m.valor])}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-400 mt-2">
          Suma los cobros registrados en «Cuentas por cobrar» más los abonos de citas pagados este día.
        </p>
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
          <h2 className="text-sm font-semibold text-gray-600">Reporte del día</h2>
          {cierresDelDia.length === 0 ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
              Aún no se ha hecho el cierre de caja de este día.
            </p>
          ) : (
            <>
            {cierresDelDia.length > 1 && (
              <p className="text-xs text-gray-400">Hay {cierresDelDia.length} cierres guardados este día — se suman todos en la comparación de abajo.</p>
            )}
            {cierresDelDia.map((c) => (
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
                      {pesos(Number(c.efectivo_entregado) + Number(c.nequi_reportado) + Number(c.daviplata_reportado) + Number(c.datafono_reportado))}
                    </p>
                  </div>
                  <div className="bg-red-50 rounded-lg py-2">
                    <p className="text-[11px] text-red-700">Salido</p>
                    <p className="text-sm font-semibold text-red-700">
                      {pesos(Number(c.proveedor_monto) + totalPrestadoHoy + totalReembolsadoHoy)}
                    </p>
                  </div>
                </div>
                <ul className="grid grid-cols-2 gap-1 text-xs">
                  {METODOS_PAGO.map((m) => (
                    <li key={m.valor} className="flex justify-between bg-gray-50 rounded-lg px-2 py-1">
                      <span>{m.etiqueta}</span>
                      <span className="font-medium">
                        {pesos(Number(c[
                          m.valor === 'efectivo' ? 'efectivo_entregado'
                          : m.valor === 'nequi' ? 'nequi_reportado'
                          : m.valor === 'daviplata' ? 'daviplata_reportado'
                          : 'datafono_reportado'
                        ]))}
                      </span>
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

            {/* Cambio 5: desfase por medio de pago, sumando todos los cierres del día */}
            <div className="border-t border-gray-100 pt-2 space-y-1">
              {METODOS_PAGO.some((m) => Math.abs(reportadoPorMetodo[m.valor] - porMetodo[m.valor]) > 1) ? (
                METODOS_PAGO.map((m) => {
                  const diff = textoDiferencia(reportadoPorMetodo[m.valor], porMetodo[m.valor])
                  if (diff.texto === 'coincide ✓') return null
                  return (
                    <p key={m.valor} className={`text-xs ${diff.clase}`}>
                      {m.etiqueta}: reportado {pesos(reportadoPorMetodo[m.valor])}, esperado {pesos(porMetodo[m.valor])} → {diff.texto}
                    </p>
                  )
                })
              ) : (
                <p className="text-xs text-green-600">Todos los medios coinciden con lo cobrado del día ✓</p>
              )}
            </div>
            </>
          )}
        </div>
      )}

      {esSuperadmin && (
        <p className="text-xs text-gray-400 -mt-2">
          Como dueña también puedes registrar tu propio cierre abajo (de este día o de una fecha atrasada, cambiando el selector de arriba) — por ejemplo si tomaste la caja tú misma, o para corregir uno mal hecho. Queda como un registro nuevo aparte; el original no se edita ni se borra.
        </p>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow p-4 space-y-4">
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
              {contrasteInline(efectivo, esperadoPorMetodo.efectivo)}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Nequi</label>
              <input
                type="text" inputMode="numeric"
                value={formatearPesosInput(nequi)}
                onChange={(e) => setNequi(soloDigitos(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
              {contrasteInline(nequi, esperadoPorMetodo.nequi)}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Daviplata</label>
              <input
                type="text" inputMode="numeric"
                value={formatearPesosInput(daviplata)}
                onChange={(e) => setDaviplata(soloDigitos(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
              {contrasteInline(daviplata, esperadoPorMetodo.daviplata)}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Datáfono</label>
              <input
                type="text" inputMode="numeric"
                value={formatearPesosInput(datafono)}
                onChange={(e) => setDatafono(soloDigitos(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
              {contrasteInline(datafono, esperadoPorMetodo.datafono)}
            </div>
          </div>

          <p className="text-sm font-medium text-brand-700">
            Total reportado: {pesos(Number(efectivo || 0) + Number(nequi || 0) + Number(daviplata || 0) + Number(datafono || 0))}
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
                  disabled={!(Number(proveedorMonto || 0) > 0)}
                  required={Number(proveedorMonto || 0) > 0}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="">{Number(proveedorMonto || 0) > 0 ? 'Selecciona…' : '(sin pago)'}</option>
                  {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                </select>
              </div>
            </div>
            {Number(proveedorMonto || 0) > 0 && (
              <input
                value={proveedorNota}
                onChange={(e) => setProveedorNota(e.target.value)}
                placeholder="¿A quién / por qué? (opcional)"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            )}
          </div>

          <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[11px] text-gray-500">Base</p>
              <p className="text-sm font-semibold">{pesos(Number(base || 0))}</p>
            </div>
            <div>
              <p className="text-[11px] text-green-700">Entrado</p>
              <p className="text-sm font-semibold text-green-700">{pesos(totalEntradoDia)}</p>
            </div>
            <div>
              <p className="text-[11px] text-red-700">Salido</p>
              <p className="text-sm font-semibold text-red-700">{pesos(totalSalidoDia)}</p>
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
            {guardando ? 'Guardando…' : 'Guardar cierre de caja'}
          </button>
      </form>
    </div>
  )
}
