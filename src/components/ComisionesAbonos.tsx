import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fechaHoy as hoy, haceDias, rangoUTC } from '../lib/fechas'
import type { Cita, RegistroTrabajo } from '../types'

const PORCENTAJE_COMISION = 0.5 // a las especialistas se les paga el 50%

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

// Comisiones por especialista + abonos registrados, en un rango de fechas.
// Se usa tanto en Reportes (admin) como en la subpestaña de Contabilidad
// (superadmin), para no repetir la misma información en dos pantallas.
export default function ComisionesAbonos() {
  const [desde, setDesde] = useState(haceDias(14))
  const [hasta, setHasta] = useState(hoy())
  const [registros, setRegistros] = useState<RegistroTrabajo[]>([])
  const [abonos, setAbonos] = useState<Cita[]>([])
  const [deudas, setDeudas] = useState<Map<string, number>>(new Map())
  const [cargando, setCargando] = useState(true)

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

      {cargando ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : (
        <>
          {/* Comisiones */}
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
