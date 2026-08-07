import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fechaHoy as hoy, haceDias, rangoUTC } from '../lib/fechas'
import type { Profile } from '../types'

interface RegistroAuditoria {
  id: string
  tabla: string
  registro_id: string
  accion: string
  usuario_id: string | null
  detalle: Record<string, unknown> | null
  created_at: string
  usuario?: Profile
}

const TABLAS = [
  'registros_trabajo',
  'citas',
  'cobros',
  'cierres_caja',
  'marcaciones',
  'permisos',
  'prestamos',
  'prestamo_pagos',
  'productos',
  'ventas'
]

const ETIQUETA_TABLA: Record<string, string> = {
  registros_trabajo: 'Trabajo registrado',
  citas: 'Cita',
  cobros: 'Cobro',
  cierres_caja: 'Cierre de caja',
  marcaciones: 'Marcación de jornada',
  permisos: 'Permiso/descanso',
  prestamos: 'Préstamo',
  prestamo_pagos: 'Pago de préstamo',
  productos: 'Producto (inventario)',
  ventas: 'Venta'
}

function formatearFechaHora(iso: string) {
  return new Date(iso).toLocaleString('es-CO', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota'
  })
}

export default function Auditoria() {
  const [desde, setDesde] = useState(haceDias(6))
  const [hasta, setHasta] = useState(hoy())
  const [tabla, setTabla] = useState('')
  const [registros, setRegistros] = useState<RegistroAuditoria[]>([])
  const [expandidoId, setExpandidoId] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCargando(true)
      const rango = rangoUTC(desde, hasta)
      let consulta = supabase
        .from('auditoria')
        .select('*, usuario:profiles!auditoria_usuario_id_fkey(nombre, rol)')
        .gte('created_at', rango.desde)
        .lt('created_at', rango.hasta)
        .order('created_at', { ascending: false })
        .limit(300)
      if (tabla) consulta = consulta.eq('tabla', tabla)
      const { data } = await consulta
      if (!cancelado) {
        setRegistros((data as RegistroAuditoria[]) ?? [])
        setCargando(false)
      }
    }
    cargar()
    return () => { cancelado = true }
  }, [desde, hasta, tabla])

  const conteoTabla = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of registros) m.set(r.tabla, (m.get(r.tabla) ?? 0) + 1)
    return m
  }, [registros])

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Auditoría (log de movimientos)</h1>
      <p className="text-sm text-gray-500 -mt-4">
        Todo lo que se crea o modifica en la app queda registrado aquí: quién, qué, y cuándo.
        Útil para revisar movimientos raros o resolver dudas.
      </p>

      <div className="bg-white rounded-2xl shadow p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Tabla</label>
          <select value={tabla} onChange={(e) => setTabla(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="">Todas</option>
            {TABLAS.map((t) => <option key={t} value={t}>{ETIQUETA_TABLA[t] ?? t}</option>)}
          </select>
        </div>
        <div className="flex gap-2 text-xs">
          <button onClick={() => { setDesde(haceDias(0)); setHasta(hoy()) }} className="px-2 py-1 rounded-lg bg-brand-50 text-brand-700">Hoy</button>
          <button onClick={() => { setDesde(haceDias(6)); setHasta(hoy()) }} className="px-2 py-1 rounded-lg bg-brand-50 text-brand-700">Última semana</button>
        </div>
      </div>

      {!cargando && registros.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {[...conteoTabla.entries()].map(([t, n]) => (
            <span key={t} className="bg-gray-100 text-gray-600 rounded-full px-2 py-1">{ETIQUETA_TABLA[t] ?? t}: {n}</span>
          ))}
        </div>
      )}

      {cargando ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : (
        <ul className="space-y-2">
          {registros.map((r) => (
            <li key={r.id} className="bg-white rounded-xl shadow-sm p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {ETIQUETA_TABLA[r.tabla] ?? r.tabla}
                    <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${r.accion === 'INSERT' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                      {r.accion === 'INSERT' ? 'creado' : 'modificado'}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatearFechaHora(r.created_at)} · {r.usuario?.nombre ?? 'Sistema'}{r.usuario?.rol ? ` (${r.usuario.rol})` : ''}
                  </p>
                </div>
                <button
                  onClick={() => setExpandidoId(expandidoId === r.id ? null : r.id)}
                  className="text-xs text-brand-600 shrink-0"
                >
                  {expandidoId === r.id ? 'Ocultar ▲' : 'Ver detalle ▾'}
                </button>
              </div>
              {expandidoId === r.id && (
                <pre className="mt-2 text-[11px] bg-gray-50 border border-gray-200 rounded-lg p-2 overflow-x-auto max-h-64 overflow-y-auto">
                  {JSON.stringify(r.detalle, null, 2)}
                </pre>
              )}
            </li>
          ))}
          {registros.length === 0 && <li className="text-sm text-gray-400">Sin movimientos en este rango.</li>}
        </ul>
      )}
    </div>
  )
}
