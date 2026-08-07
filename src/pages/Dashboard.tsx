import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fechaHoy as inicioDeHoy, rangoDiaUTC } from '../lib/fechas'
import type { ComparacionDiaria, RegistroTrabajo } from '../types'

export default function Dashboard() {
  const [fecha, setFecha] = useState(inicioDeHoy())
  const [registros, setRegistros] = useState<RegistroTrabajo[]>([])
  const [comparacion, setComparacion] = useState<ComparacionDiaria[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCargando(true)
      const { desde, hasta } = rangoDiaUTC(fecha)
      const [{ data: regs }, { data: comp }] = await Promise.all([
        supabase
          .from('registros_trabajo')
          .select('*, servicio:servicios(*), empleada:profiles!registros_trabajo_empleada_id_fkey(*)')
          .gte('created_at', desde)
          .lt('created_at', hasta)
          .order('created_at', { ascending: false }),
        supabase
          .from('vista_comparacion_diaria')
          .select('*')
          .eq('fecha', fecha)
      ])
      if (!cancelado) {
        setRegistros((regs as RegistroTrabajo[]) ?? [])
        setComparacion((comp as ComparacionDiaria[]) ?? [])
        setCargando(false)
      }
    }
    cargar()
    return () => {
      cancelado = true
    }
  }, [fecha])

  const activos = useMemo(() => registros.filter((r) => !r.anulado), [registros])

  const totalGeneral = useMemo(
    () => activos.reduce((sum, r) => sum + Number(r.precio_cobrado), 0),
    [activos]
  )

  const porEmpleada = useMemo(() => {
    const mapa = new Map<string, { nombre: string; total: number; cantidad: number }>()
    for (const r of activos) {
      const nombre = r.empleada?.nombre ?? 'Sin asignar'
      const actual = mapa.get(nombre) ?? { nombre, total: 0, cantidad: 0 }
      actual.total += Number(r.precio_cobrado)
      actual.cantidad += 1
      mapa.set(nombre, actual)
    }
    return [...mapa.values()].sort((a, b) => b.total - a.total)
  }, [activos])

  const alertas = comparacion.filter((c) => Math.abs(Number(c.diferencia)) > 0.01)

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Panel del día</h1>
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>

      {cargando ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : (
        <>
          {alertas.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-1">
              <h2 className="font-semibold text-amber-800 text-sm">⚠ Diferencia entre lo registrado y el cierre de caja</h2>
              {alertas.map((a) => (
                <p key={a.fecha} className="text-sm text-amber-800">
                  Servicios registrados ${Number(a.total_registrado).toLocaleString('es-CO')} vs
                  {' '}reportado en caja ${Number(a.total_reportado).toLocaleString('es-CO')} → diferencia{' '}
                  <strong>${Number(a.diferencia).toLocaleString('es-CO')}</strong>
                </p>
              ))}
            </div>
          )}

          <div className="bg-white rounded-2xl shadow p-4">
            <p className="text-sm text-gray-500">Total registrado (sin anulados)</p>
            <p className="text-3xl font-bold text-brand-700">${totalGeneral.toLocaleString('es-CO')}</p>
            <p className="text-xs text-gray-400 mt-1">{activos.length} trabajos registrados</p>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-semibold text-sm text-gray-600 mb-3">Por empleada</h2>
            <ul className="space-y-2">
              {porEmpleada.map((e) => (
                <li key={e.nombre} className="flex justify-between text-sm">
                  <span>{e.nombre} <span className="text-gray-400">({e.cantidad})</span></span>
                  <span className="font-medium">${e.total.toLocaleString('es-CO')}</span>
                </li>
              ))}
              {porEmpleada.length === 0 && <li className="text-sm text-gray-400">Sin registros este día.</li>}
            </ul>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-semibold text-sm text-gray-600 mb-3">Detalle de registros</h2>
            <ul className="space-y-2 max-h-96 overflow-y-auto">
              {registros.map((r) => (
                <li key={r.id} className={`text-sm flex justify-between border-b border-gray-100 pb-2 ${r.anulado ? 'opacity-50' : ''}`}>
                  <span>
                    {r.empleada?.nombre} · {r.servicio?.nombre}
                    {r.descuento_porcentaje > 0 && <span className="text-brand-500 ml-1">(-{r.descuento_porcentaje}%)</span>}
                    {r.anulado && <span className="text-red-500 ml-1">(anulado)</span>}
                  </span>
                  <span>${Number(r.precio_cobrado).toLocaleString('es-CO')}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
