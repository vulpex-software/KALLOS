import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy, fechaLocal, haceDias, rangoUTC } from '../lib/fechas'
import type { Prestamo, PrestamoPago, RegistroTrabajo } from '../types'

const PORCENTAJE_COMISION = 0.5 // igual que en ComisionesAbonos.tsx

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

type Periodo = 7 | 15

// Autoconsulta de comisión para el personal: ve lo mismo que ya calcula
// ComisionesAbonos.tsx para la dueña/admin, pero filtrado a sus propios
// registros y con un toggle de período en vez de un rango libre de fechas.
export default function MiComision() {
  const { profile } = useAuth()
  const [periodo, setPeriodo] = useState<Periodo>(15)
  const [registros, setRegistros] = useState<RegistroTrabajo[]>([])
  const [prestamos, setPrestamos] = useState<Prestamo[]>([])
  const [pagos, setPagos] = useState<PrestamoPago[]>([])
  const [cargando, setCargando] = useState(true)

  // Saldo pendiente histórico (todo lo ganado desde siempre menos lo ya
  // pagado) -- independiente del período elegido arriba, que solo sirve
  // para ver el detalle día a día.
  const [saldoPendiente, setSaldoPendiente] = useState(0)
  useEffect(() => {
    if (!profile) return
    const personaId = profile.id
    let cancelado = false
    Promise.all([
      supabase.from('registros_trabajo').select('precio_cobrado').eq('empleada_id', personaId).eq('anulado', false),
      supabase.from('comision_pagos').select('monto').eq('persona_id', personaId)
    ]).then(([{ data: regs }, { data: pagosComision }]) => {
      if (cancelado) return
      const ganado = ((regs as { precio_cobrado: number }[]) ?? []).reduce((s, r) => s + Number(r.precio_cobrado), 0) * PORCENTAJE_COMISION
      const pagado = ((pagosComision as { monto: number }[]) ?? []).reduce((s, p) => s + Number(p.monto), 0)
      setSaldoPendiente(Math.max(0, ganado - pagado))
    })
    return () => { cancelado = true }
  }, [profile])

  useEffect(() => {
    if (!profile) return
    const personaId = profile.id
    let cancelado = false
    async function cargar() {
      setCargando(true)
      const rango = rangoUTC(haceDias(periodo - 1), fechaHoy())
      const [{ data: regs }, { data: prest }, { data: pagosData }] = await Promise.all([
        supabase
          .from('registros_trabajo')
          .select('*, servicio:servicios(*)')
          .eq('empleada_id', personaId)
          .eq('anulado', false)
          .gte('created_at', rango.desde)
          .lt('created_at', rango.hasta)
          .order('created_at', { ascending: false }),
        supabase.from('prestamos').select('*').eq('persona_id', personaId).eq('pagado', false),
        supabase.from('prestamo_pagos').select('*')
      ])
      if (!cancelado) {
        setRegistros((regs as RegistroTrabajo[]) ?? [])
        setPrestamos((prest as Prestamo[]) ?? [])
        setPagos((pagosData as PrestamoPago[]) ?? [])
        setCargando(false)
      }
    }
    cargar()
    return () => { cancelado = true }
  }, [profile, periodo])

  const deuda = useMemo(() => {
    const pagadoPorPrestamo = new Map<string, number>()
    for (const pg of pagos) pagadoPorPrestamo.set(pg.prestamo_id, (pagadoPorPrestamo.get(pg.prestamo_id) ?? 0) + Number(pg.monto))
    return prestamos.reduce((s, p) => s + Math.max(0, Number(p.monto) - (pagadoPorPrestamo.get(p.id) ?? 0)), 0)
  }, [prestamos, pagos])

  // Agrupado por día local (no UTC) -- una cita a las 11pm no debe aparecer
  // acumulada en el día siguiente solo porque cruzó medianoche en UTC.
  const porDia = useMemo(() => {
    const mapa = new Map<string, { fecha: string; cantidad: number; total: number }>()
    for (const r of registros) {
      const fecha = fechaLocal(new Date(r.created_at))
      const d = mapa.get(fecha) ?? { fecha, cantidad: 0, total: 0 }
      d.cantidad += 1
      d.total += Number(r.precio_cobrado)
      mapa.set(fecha, d)
    }
    return [...mapa.values()].sort((a, b) => b.fecha.localeCompare(a.fecha))
  }, [registros])

  const totalFacturado = porDia.reduce((s, d) => s + d.total, 0)
  const totalComision = totalFacturado * PORCENTAJE_COMISION
  const netoAcobrar = Math.max(0, totalComision - deuda)

  if (!profile) return null

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <h1 className="text-lg font-semibold">Mi comisión</h1>

      {saldoPendiente > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4">
          <p className="text-xs text-amber-700">Saldo pendiente por pagarte (histórico)</p>
          <p className="text-2xl font-bold text-amber-800">{pesos(saldoPendiente)}</p>
        </div>
      )}

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        <button
          onClick={() => setPeriodo(7)}
          className={`flex-1 text-sm font-medium rounded-lg py-2 transition ${periodo === 7 ? 'bg-white shadow text-brand-700' : 'text-gray-500'}`}
        >
          Últimos 7 días
        </button>
        <button
          onClick={() => setPeriodo(15)}
          className={`flex-1 text-sm font-medium rounded-lg py-2 transition ${periodo === 15 ? 'bg-white shadow text-brand-700' : 'text-gray-500'}`}
        >
          Últimos 15 días
        </button>
      </div>

      {cargando ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow p-4 grid grid-cols-2 gap-3 text-center">
            <div>
              <p className="text-xs text-gray-400">Facturado</p>
              <p className="text-lg font-bold">{pesos(totalFacturado)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Tu comisión (50%)</p>
              <p className="text-lg font-bold text-brand-700">{pesos(totalComision)}</p>
            </div>
            {deuda > 0 && (
              <>
                <div>
                  <p className="text-xs text-gray-400">Debes (préstamos)</p>
                  <p className="text-sm font-semibold text-red-600">-{pesos(deuda)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Te queda</p>
                  <p className="text-sm font-semibold text-green-700">{pesos(netoAcobrar)}</p>
                </div>
              </>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="text-sm font-semibold text-gray-600 mb-2">Por día</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="py-2 pr-2">Fecha</th>
                    <th className="py-2 px-1 text-right">Serv.</th>
                    <th className="py-2 px-1 text-right">Facturado</th>
                    <th className="py-2 pl-1 text-right">Comisión</th>
                  </tr>
                </thead>
                <tbody>
                  {porDia.map((d) => (
                    <tr key={d.fecha} className="border-b border-gray-50">
                      <td className="py-2 pr-2">{d.fecha}</td>
                      <td className="py-2 px-1 text-right">{d.cantidad}</td>
                      <td className="py-2 px-1 text-right">{pesos(d.total)}</td>
                      <td className="py-2 pl-1 text-right font-medium text-brand-700">{pesos(d.total * PORCENTAJE_COMISION)}</td>
                    </tr>
                  ))}
                  {porDia.length === 0 && (
                    <tr><td colSpan={4} className="py-3 text-gray-400">Sin servicios en este período.</td></tr>
                  )}
                </tbody>
                {porDia.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-gray-200 font-semibold">
                      <td className="py-2 pr-2">Total</td>
                      <td className="py-2 px-1 text-right">{porDia.reduce((s, d) => s + d.cantidad, 0)}</td>
                      <td className="py-2 px-1 text-right">{pesos(totalFacturado)}</td>
                      <td className="py-2 pl-1 text-right text-brand-700">{pesos(totalComision)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
