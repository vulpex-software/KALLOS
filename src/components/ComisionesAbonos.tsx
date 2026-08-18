import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy as hoy, haceDias, rangoUTC } from '../lib/fechas'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import { METODOS_PAGO, type Cita, type ComisionPago, type RegistroTrabajo } from '../types'

const PORCENTAJE_COMISION = 0.5 // a las especialistas se les paga el 50%

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

// Comisiones por especialista + abonos registrados, en un rango de fechas.
// Se usa tanto en Reportes (admin) como en la subpestaña de Contabilidad
// (superadmin), para no repetir la misma información en dos pantallas.
// ocultarComisiones: el sueldo/comisión de cada especialista es información
// que solo debe ver la dueña -- un admin (Reportes) solo ve los abonos.
export default function ComisionesAbonos({ ocultarComisiones = false }: { ocultarComisiones?: boolean }) {
  const { profile } = useAuth()
  const [desde, setDesde] = useState(haceDias(14))
  const [hasta, setHasta] = useState(hoy())
  const [registros, setRegistros] = useState<RegistroTrabajo[]>([])
  const [abonos, setAbonos] = useState<Cita[]>([])
  const [deudas, setDeudas] = useState<Map<string, number>>(new Map())
  const [cargando, setCargando] = useState(true)

  // Saldo pendiente de comisión: histórico completo (todo lo ganado desde
  // siempre, 50% de sus registros de trabajo) menos todo lo ya pagado --
  // no depende del rango de fechas de arriba, que es solo para las otras
  // tablas de este componente.
  const [historicoGanado, setHistoricoGanado] = useState<Map<string, number>>(new Map())
  const [historicoPagado, setHistoricoPagado] = useState<Map<string, number>>(new Map())
  const [pagosPorPersona, setPagosPorPersona] = useState<Map<string, ComisionPago[]>>(new Map())
  const [nombrePorPersona, setNombrePorPersona] = useState<Map<string, string>>(new Map())

  async function cargarHistorico() {
    const [{ data: regsAll }, { data: pagosAll }] = await Promise.all([
      supabase
        .from('registros_trabajo')
        .select('*, empleada:profiles!registros_trabajo_empleada_id_fkey(*)')
        .eq('anulado', false),
      supabase.from('comision_pagos').select('*').order('created_at', { ascending: false })
    ])
    const ganado = new Map<string, number>()
    const nombres = new Map<string, string>()
    for (const r of (regsAll as RegistroTrabajo[]) ?? []) {
      ganado.set(r.empleada_id, (ganado.get(r.empleada_id) ?? 0) + Number(r.precio_cobrado) * PORCENTAJE_COMISION)
      if (r.empleada?.nombre) nombres.set(r.empleada_id, r.empleada.nombre)
    }
    const pagos = (pagosAll as ComisionPago[]) ?? []
    const pagado = new Map<string, number>()
    const porPersona = new Map<string, ComisionPago[]>()
    for (const p of pagos) {
      pagado.set(p.persona_id, (pagado.get(p.persona_id) ?? 0) + Number(p.monto))
      porPersona.set(p.persona_id, [...(porPersona.get(p.persona_id) ?? []), p])
    }
    setHistoricoGanado(ganado)
    setHistoricoPagado(pagado)
    setPagosPorPersona(porPersona)
    setNombrePorPersona(nombres)
  }

  useEffect(() => {
    if (!ocultarComisiones) cargarHistorico()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saldosPendientes = useMemo(() => {
    const ids = new Set([...historicoGanado.keys(), ...historicoPagado.keys()])
    return [...ids]
      .map((id) => ({
        id,
        nombre: nombrePorPersona.get(id) ?? 'Sin nombre',
        pendiente: Math.max(0, (historicoGanado.get(id) ?? 0) - (historicoPagado.get(id) ?? 0))
      }))
      .filter((s) => s.pendiente > 0)
      .sort((a, b) => b.pendiente - a.pendiente)
  }, [historicoGanado, historicoPagado, nombrePorPersona])

  // --- Formulario "Confirmar valor y pagar" ---
  const [pagandoId, setPagandoId] = useState<string | null>(null)
  const [pagoDesde, setPagoDesde] = useState(haceDias(14))
  const [pagoHasta, setPagoHasta] = useState(hoy())
  const [pagoRangoTotal, setPagoRangoTotal] = useState(0)
  const [pagoCalculando, setPagoCalculando] = useState(false)
  const [pagoAjusteSigno, setPagoAjusteSigno] = useState<'+' | '-'>('+')
  // Pagar la comisión es una salida de plata: sin el medio, el cuadre del
  // efectivo del día queda impreciso (no se sabe si salió del cajón o por
  // transferencia). La base de datos también lo exige.
  const [pagoMetodo, setPagoMetodo] = useState<string>('')

  // Ajuste de saldo: baja el pendiente SIN registrar una salida de plata.
  // Es para los saldos de apertura -- comisión que se pagó por fuera antes
  // de que el salón entrara al sistema, o un saldo que quedó mal de arranque
  // mientras se alinea con lo real. Ni anular el trabajo (borraría ingreso
  // que sí ocurrió) ni registrar un pago (inventaría una salida de hoy y
  // descuadraría la caja) sirven para eso.
  const [ajustandoId, setAjustandoId] = useState<string | null>(null)
  const [ajusteMonto, setAjusteMonto] = useState('')
  const [ajusteMotivo, setAjusteMotivo] = useState('')
  const [guardandoAjuste, setGuardandoAjuste] = useState(false)
  const [ajusteError, setAjusteError] = useState<string | null>(null)

  function abrirAjuste(personaId: string, pendiente: number) {
    setAjustandoId(personaId)
    setPagandoId(null)
    setAjusteError(null)
    // Pre-llenado con el saldo completo, que es el caso normal (dejarlo en
    // cero). Si le habían pagado solo una parte por fuera, se baja el monto.
    setAjusteMonto(String(Math.round(pendiente)))
    setAjusteMotivo('')
  }

  async function confirmarAjuste(pendiente: number) {
    if (!ajustandoId || !profile) return
    setAjusteError(null)
    const monto = Number(ajusteMonto || 0)
    if (monto <= 0) { setAjusteError('El monto del ajuste debe ser mayor a $0.'); return }
    if (monto > pendiente + 0.01) { setAjusteError(`No puede ser mayor al saldo pendiente (${pesos(pendiente)}).`); return }
    if (!ajusteMotivo.trim()) { setAjusteError('Escribe por qué se ajusta este saldo.'); return }
    setGuardandoAjuste(true)
    const { error } = await supabase.from('comision_pagos').insert({
      salon_id: profile.salon_id,
      persona_id: ajustandoId,
      tipo: 'ajuste',
      monto,
      // Un ajuste no mueve caja: sin medio de pago a propósito (la base de
      // datos lo exige así, para que no se cuele como salida en los cuadres).
      metodo_pago: null,
      fecha_desde: hoy(),
      fecha_hasta: hoy(),
      ajuste: 0,
      nota: ajusteMotivo.trim(),
      pagado_por: profile.id
    })
    setGuardandoAjuste(false)
    if (error) { setAjusteError('No se pudo guardar el ajuste: ' + error.message); return }
    setPagoMensaje(`Se ajustó el saldo en ${pesos(monto)}.`)
    setAjustandoId(null)
    cargarHistorico()
  }
  const [pagoAjusteMonto, setPagoAjusteMonto] = useState('')
  const [pagoNota, setPagoNota] = useState('')
  const [guardandoPago, setGuardandoPago] = useState(false)
  const [pagoError, setPagoError] = useState<string | null>(null)
  const [pagoMensaje, setPagoMensaje] = useState<string | null>(null)
  const [historialAbiertoId, setHistorialAbiertoId] = useState<string | null>(null)

  async function calcularRangoParaPago(personaId: string, d: string, h: string) {
    setPagoCalculando(true)
    const rango = rangoUTC(d, h)
    const { data } = await supabase
      .from('registros_trabajo')
      .select('precio_cobrado')
      .eq('empleada_id', personaId)
      .eq('anulado', false)
      .gte('created_at', rango.desde)
      .lt('created_at', rango.hasta)
    const total = ((data as { precio_cobrado: number }[]) ?? []).reduce((s, r) => s + Number(r.precio_cobrado), 0) * PORCENTAJE_COMISION
    setPagoRangoTotal(total)
    setPagoCalculando(false)
  }

  function abrirPago(personaId: string) {
    setPagandoId(personaId)
    setPagoDesde(haceDias(14))
    setPagoHasta(hoy())
    setPagoAjusteSigno('+')
    setPagoAjusteMonto('')
    setPagoNota('')
    setPagoError(null)
    setPagoMensaje(null)
    calcularRangoParaPago(personaId, haceDias(14), hoy())
  }

  function cambiarRangoPago(d: string, h: string) {
    setPagoDesde(d)
    setPagoHasta(h)
    if (pagandoId) calcularRangoParaPago(pagandoId, d, h)
  }

  const pagoAjusteNum = Number(pagoAjusteMonto || 0) * (pagoAjusteSigno === '+' ? 1 : -1)
  const pagoTotal = pagoRangoTotal + pagoAjusteNum
  const pagoSaldoPersona = pagandoId ? (saldosPendientes.find((s) => s.id === pagandoId)?.pendiente ?? 0) : 0

  async function confirmarPago() {
    if (!pagandoId || !profile) return
    setPagoError(null)
    if (pagoTotal <= 0) { setPagoError('El total a pagar debe quedar por encima de $0.'); return }
    if (pagoTotal > pagoSaldoPersona + 0.01) { setPagoError(`No puede ser mayor al saldo pendiente (${pesos(pagoSaldoPersona)}).`); return }
    if (!pagoMetodo) { setPagoError('Elige por qué medio se le paga.'); return }
    setGuardandoPago(true)
    const { error } = await supabase.from('comision_pagos').insert({
      salon_id: profile.salon_id,
      persona_id: pagandoId,
      tipo: 'pago',
      monto: pagoTotal,
      metodo_pago: pagoMetodo,
      fecha_desde: pagoDesde,
      fecha_hasta: pagoHasta,
      ajuste: pagoAjusteNum,
      nota: pagoNota.trim() || null,
      pagado_por: profile.id
    })
    setGuardandoPago(false)
    if (error) { setPagoError('No se pudo registrar el pago: ' + error.message); return }
    setPagoMensaje(`Se registró el pago de ${pesos(pagoTotal)}.`)
    setPagoMetodo('')
    setPagandoId(null)
    cargarHistorico()
  }

  async function borrarPago(p: ComisionPago) {
    if (!confirm(`¿Borrar este pago de ${pesos(Number(p.monto))}? No se puede deshacer.`)) return
    await supabase.from('comision_pagos').delete().eq('id', p.id)
    cargarHistorico()
  }

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCargando(true)
      const rango = rangoUTC(desde, hasta)
      const [{ data: regs }, { data: cits }, { data: prest }, { data: pagosPrest }] = await Promise.all([
        supabase
          .from('registros_trabajo')
          .select('*, servicio:servicios(*), empleada:profiles!registros_trabajo_empleada_id_fkey(*)')
          .gte('created_at', rango.desde)
          .lt('created_at', rango.hasta)
          .eq('anulado', false)
          .order('created_at', { ascending: false }),
        supabase
          .from('citas')
          .select('*, servicio:servicios(*), empleada:profiles!citas_empleada_id_fkey(*)')
          .gt('abono', 0)
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .order('fecha', { ascending: false }),
        // Préstamos NO saldados manualmente (deuda actual), sin importar el rango de fechas.
        supabase.from('prestamos').select('id, persona_id, monto').eq('pagado', false),
        // Pagos ya recibidos de esos préstamos, para descontarlos del saldo.
        supabase.from('prestamo_pagos').select('prestamo_id, monto')
      ])
      if (!cancelado) {
        setRegistros((regs as RegistroTrabajo[]) ?? [])
        setAbonos((cits as Cita[]) ?? [])
        const pagadoPorPrestamo = new Map<string, number>()
        for (const pg of (pagosPrest as { prestamo_id: string; monto: number }[]) ?? []) {
          pagadoPorPrestamo.set(pg.prestamo_id, (pagadoPorPrestamo.get(pg.prestamo_id) ?? 0) + Number(pg.monto))
        }
        const m = new Map<string, number>()
        for (const p of (prest as { id: string; persona_id: string; monto: number }[]) ?? []) {
          const pendiente = Math.max(0, Number(p.monto) - (pagadoPorPrestamo.get(p.id) ?? 0))
          if (pendiente <= 0) continue
          m.set(p.persona_id, (m.get(p.persona_id) ?? 0) + pendiente)
        }
        setDeudas(m)
        setCargando(false)
      }
    }
    cargar()
    return () => {
      cancelado = true
    }
  }, [desde, hasta])

  const comisiones = useMemo(() => {
    const mapa = new Map<string, { id: string; nombre: string; cantidad: number; total: number }>()
    for (const r of registros) {
      const id = r.empleada?.id ?? 'sin'
      const nombre = r.empleada?.nombre ?? 'Sin asignar'
      const a = mapa.get(id) ?? { id, nombre, cantidad: 0, total: 0 }
      a.cantidad += 1
      a.total += Number(r.precio_cobrado)
      mapa.set(id, a)
    }
    return [...mapa.values()].sort((a, b) => b.total - a.total)
  }, [registros])

  const totalServicios = comisiones.reduce((s, c) => s + c.total, 0)
  const totalComision = totalServicios * PORCENTAJE_COMISION
  const totalDeuda = comisiones.reduce((s, c) => s + (deudas.get(c.id) ?? 0), 0)
  const totalNeto = comisiones.reduce((s, c) => s + Math.max(0, c.total * PORCENTAJE_COMISION - (deudas.get(c.id) ?? 0)), 0)
  const totalAbonos = abonos.reduce((s, c) => s + Number(c.abono), 0)

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div className="flex gap-2 text-xs">
          <button onClick={() => { setDesde(haceDias(6)); setHasta(hoy()) }} className="px-2 py-1 rounded-lg bg-brand-50 text-brand-700">Última semana</button>
          <button onClick={() => { setDesde(haceDias(14)); setHasta(hoy()) }} className="px-2 py-1 rounded-lg bg-brand-50 text-brand-700">Última quincena</button>
        </div>
      </div>

      {!ocultarComisiones && saldosPendientes.length > 0 && (
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="font-semibold text-sm text-gray-600 mb-1">Comisión pendiente por pagar</h2>
          <p className="text-xs text-gray-400 mb-3">Histórico completo -- todo lo ganado desde siempre menos lo ya pagado, sin importar el rango de arriba.</p>
          <ul className="divide-y divide-gray-100">
            {saldosPendientes.map((s) => (
              <li key={s.id} className="py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{s.nombre}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-semibold text-amber-700">{pesos(s.pendiente)}</span>
                    {pagandoId !== s.id && ajustandoId !== s.id && (
                      <>
                        <button onClick={() => abrirPago(s.id)} className="text-xs bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg px-3 py-1.5">
                          Confirmar valor y pagar
                        </button>
                        <button
                          onClick={() => abrirAjuste(s.id, s.pendiente)}
                          title="Bajar el saldo sin registrar un pago (saldo de apertura, ya pagado por fuera)"
                          className="text-xs border border-purple-300 text-purple-700 font-medium rounded-lg px-3 py-1.5"
                        >
                          Ajustar saldo
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {(pagosPorPersona.get(s.id)?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => setHistorialAbiertoId(historialAbiertoId === s.id ? null : s.id)}
                    className="text-xs text-brand-600 font-medium"
                  >
                    {historialAbiertoId === s.id ? 'Ocultar pagos ▲' : `Ver pagos anteriores (${pagosPorPersona.get(s.id)?.length}) ▾`}
                  </button>
                )}
                {historialAbiertoId === s.id && (
                  <ul className="text-xs text-gray-500 space-y-1 pl-1">
                    {(pagosPorPersona.get(s.id) ?? []).map((p) => (
                      <li key={p.id} className={`flex items-center justify-between gap-2 ${p.tipo === 'ajuste' ? 'text-purple-700' : ''}`}>
                        <span>
                          {new Date(p.created_at).toLocaleDateString('es-CO')} · {pesos(Number(p.monto))}
                          {p.tipo === 'ajuste' ? (
                            <> · <b>AJUSTE</b> (no movió plata)</>
                          ) : (
                            <>
                              {' '}(del {p.fecha_desde} al {p.fecha_hasta}{Number(p.ajuste) !== 0 ? `, ${Number(p.ajuste) > 0 ? '+' : ''}${pesos(Number(p.ajuste))} ajuste` : ''})
                              {p.metodo_pago ? ` · ${p.metodo_pago}` : ''}
                            </>
                          )}
                          {p.nota ? ` · ${p.nota}` : ''}
                        </span>
                        <button onClick={() => borrarPago(p)} className="text-red-500 shrink-0">Borrar</button>
                      </li>
                    ))}
                  </ul>
                )}

                {ajustandoId === s.id && (
                  <div className="border border-purple-200 bg-purple-50/60 rounded-xl p-3 space-y-2">
                    {ajusteError && <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{ajusteError}</div>}
                    <p className="text-xs text-purple-800">
                      Baja el saldo <b>sin registrar un pago</b>: no mueve plata ni entra a la contabilidad. Es para un
                      saldo que ya se pagó por fuera antes de arrancar el sistema, o uno que quedó mal de arranque.
                    </p>
                    <div>
                      <label className="block text-xs font-medium mb-1">Monto a descontar del saldo</label>
                      <input
                        type="text" inputMode="numeric"
                        value={formatearPesosInput(ajusteMonto)}
                        onChange={(e) => setAjusteMonto(soloDigitos(e.target.value))}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      />
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        Viene con el saldo completo ({pesos(s.pendiente)}) para dejarlo en cero. Si solo le pagaron una
                        parte por fuera, baja el monto.
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">¿Por qué se ajusta? (obligatorio)</label>
                      <input
                        value={ajusteMotivo}
                        onChange={(e) => setAjusteMotivo(e.target.value)}
                        placeholder="Ej. ya se le había pagado antes de entrar al sistema"
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => confirmarAjuste(s.pendiente)}
                        disabled={guardandoAjuste}
                        className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg py-1.5"
                      >
                        {guardandoAjuste ? 'Guardando…' : 'Ajustar saldo'}
                      </button>
                      <button type="button" onClick={() => setAjustandoId(null)} className="px-3 text-sm text-gray-500">Cancelar</button>
                    </div>
                  </div>
                )}

                {pagandoId === s.id && (
                  <div className="border border-brand-200 bg-brand-50/50 rounded-xl p-3 space-y-2">
                    {pagoError && <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{pagoError}</div>}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium mb-1">Desde</label>
                        <input type="date" value={pagoDesde} onChange={(e) => cambiarRangoPago(e.target.value, pagoHasta)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Hasta</label>
                        <input type="date" value={pagoHasta} onChange={(e) => cambiarRangoPago(pagoDesde, e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500">
                      Comisión de ese rango: <b>{pagoCalculando ? 'calculando…' : pesos(pagoRangoTotal)}</b>
                    </p>
                    <div>
                      <label className="block text-xs font-medium mb-1">Adicional (opcional) -- para pagarle algo de más o restarle algo</label>
                      <div className="flex gap-2">
                        <div className="flex rounded-lg border border-gray-300 overflow-hidden shrink-0">
                          <button
                            type="button"
                            onClick={() => setPagoAjusteSigno('+')}
                            className={`px-3 text-sm font-bold ${pagoAjusteSigno === '+' ? 'bg-green-600 text-white' : 'bg-white text-gray-400'}`}
                          >
                            +
                          </button>
                          <button
                            type="button"
                            onClick={() => setPagoAjusteSigno('-')}
                            className={`px-3 text-sm font-bold border-l border-gray-300 ${pagoAjusteSigno === '-' ? 'bg-red-600 text-white' : 'bg-white text-gray-400'}`}
                          >
                            −
                          </button>
                        </div>
                        <input
                          type="text" inputMode="numeric"
                          value={formatearPesosInput(pagoAjusteMonto)}
                          onChange={(e) => setPagoAjusteMonto(soloDigitos(e.target.value))}
                          placeholder="0"
                          className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                        />
                      </div>
                    </div>
                    <input
                      value={pagoNota}
                      onChange={(e) => setPagoNota(e.target.value)}
                      placeholder="Nota (opcional, ej. bono por puntualidad)"
                      className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <div>
                      <label className="block text-xs font-medium mb-1">¿Por qué medio se le paga?</label>
                      <select
                        value={pagoMetodo}
                        onChange={(e) => setPagoMetodo(e.target.value)}
                        required
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">Selecciona…</option>
                        {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                      </select>
                    </div>
                    <p className="text-sm font-semibold text-brand-700">Total a pagar: {pesos(pagoTotal)}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={confirmarPago}
                        disabled={guardandoPago || pagoCalculando}
                        className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg py-1.5"
                      >
                        {guardandoPago ? 'Guardando…' : 'Confirmar valor y pagar'}
                      </button>
                      <button type="button" onClick={() => setPagandoId(null)} className="px-3 text-sm text-gray-500">Cancelar</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {pagoMensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{pagoMensaje}</div>}

      {cargando ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : (
        <>
          {/* Comisiones -- solo la dueña ve cuánto se le paga a cada especialista */}
          {!ocultarComisiones && (
          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-semibold text-sm text-gray-600 mb-1">Comisiones por especialista (50%)</h2>
            <p className="text-xs text-gray-400 mb-3">Del {desde} al {hasta}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="py-2 pr-2">Especialista</th>
                    <th className="py-2 px-1 text-right">Serv.</th>
                    <th className="py-2 px-1 text-right">50%</th>
                    <th className="py-2 px-1 text-right">Debe</th>
                    <th className="py-2 pl-1 text-right">Le pagas</th>
                  </tr>
                </thead>
                <tbody>
                  {comisiones.map((c) => {
                    const comision = c.total * PORCENTAJE_COMISION
                    const debe = deudas.get(c.id) ?? 0
                    const neto = Math.max(0, comision - debe)
                    return (
                      <tr key={c.id} className="border-b border-gray-50">
                        <td className="py-2 pr-2 font-medium">{c.nombre}</td>
                        <td className="py-2 px-1 text-right">{c.cantidad}</td>
                        <td className="py-2 px-1 text-right">{pesos(comision)}</td>
                        <td className="py-2 px-1 text-right text-red-600">{debe > 0 ? '-' + pesos(debe) : '—'}</td>
                        <td className="py-2 pl-1 text-right font-semibold text-brand-700">{pesos(neto)}</td>
                      </tr>
                    )
                  })}
                  {comisiones.length === 0 && (
                    <tr><td colSpan={5} className="py-3 text-gray-400">Sin servicios en este rango.</td></tr>
                  )}
                </tbody>
                {comisiones.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-gray-200 font-semibold">
                      <td className="py-2 pr-2">Total</td>
                      <td className="py-2 px-1 text-right">{comisiones.reduce((s, c) => s + c.cantidad, 0)}</td>
                      <td className="py-2 px-1 text-right">{pesos(totalComision)}</td>
                      <td className="py-2 px-1 text-right text-red-600">{totalDeuda > 0 ? '-' + pesos(totalDeuda) : '—'}</td>
                      <td className="py-2 pl-1 text-right text-brand-700">{pesos(totalNeto)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
          )}

          {/* Abonos */}
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm text-gray-600">Abonos registrados</h2>
              <span className="text-sm font-semibold text-brand-700">Total: {pesos(totalAbonos)}</span>
            </div>
            <ul className="space-y-2">
              {abonos.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm border-b border-gray-50 pb-2">
                  <div>
                    <p className="font-medium">{c.cliente_nombre} <span className="text-gray-400 font-normal">· {c.servicio?.nombre}</span></p>
                    <p className="text-xs text-gray-400">
                      {c.fecha} · {c.abono_metodo_pago ?? 'sin medio'} · {c.estado}
                    </p>
                  </div>
                  <span className="font-semibold">{pesos(Number(c.abono))}</span>
                </li>
              ))}
              {abonos.length === 0 && <li className="text-sm text-gray-400">Sin abonos en este rango.</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
