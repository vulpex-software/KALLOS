import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy, rangoDiaUTC } from '../lib/fechas'
import type { RegistroTrabajo } from '../types'

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

// Antes esta pantalla era "Mi comisión": mostraba el 50%, el acumulado de 7
// o 15 días y el saldo histórico pendiente por pagarle. Por decisión de la
// dueña la profesional ya no ve nada de eso -- solo lo que trabajó en el
// día, con el valor de cada servicio. La comisión se sigue calculando y
// pagando desde Contabilidad, que es de la dueña.
export default function MiDia() {
  const { profile } = useAuth()
  const [fecha, setFecha] = useState(fechaHoy())
  const [registros, setRegistros] = useState<RegistroTrabajo[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!profile) return
    const personaId = profile.id
    let cancelado = false
    setCargando(true)
    const rango = rangoDiaUTC(fecha)
    supabase
      .from('registros_trabajo')
      .select('*, servicio:servicios(*)')
      .eq('empleada_id', personaId)
      .eq('anulado', false)
      .gte('created_at', rango.desde)
      .lt('created_at', rango.hasta)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (cancelado) return
        setRegistros((data as RegistroTrabajo[]) ?? [])
        setCargando(false)
      })
    return () => { cancelado = true }
  }, [profile, fecha])

  const total = useMemo(
    () => registros.reduce((s, r) => s + Number(r.precio_cobrado), 0),
    [registros]
  )

  function hora(iso: string) {
    return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })
  }

  if (!profile) return null

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Mi día</h1>
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
          <div className="bg-white rounded-2xl shadow p-4 grid grid-cols-2 gap-3 text-center">
            <div>
              <p className="text-xs text-gray-400">Servicios</p>
              <p className="text-lg font-bold">{registros.length}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Valor del día</p>
              <p className="text-lg font-bold text-brand-700">{pesos(total)}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="text-sm font-semibold text-gray-600 mb-2">Lo que hiciste</h2>
            <ul className="divide-y divide-gray-100">
              {registros.map((r) => (
                <li key={r.id} className="py-2 flex justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{r.servicio?.nombre ?? 'Servicio'}</span>
                    <span className="block text-xs text-gray-400">
                      {hora(r.created_at)} · {r.cliente_nombre || 'Sin nombre'}
                      {r.nota ? ` · ${r.nota}` : ''}
                    </span>
                  </span>
                  <span className="font-medium shrink-0">{pesos(Number(r.precio_cobrado))}</span>
                </li>
              ))}
              {registros.length === 0 && (
                <li className="py-3 text-sm text-gray-400">No registraste servicios este día.</li>
              )}
            </ul>
          </div>

          <p className="text-xs text-gray-400">
            Es el valor de los servicios que registraste, no lo que se te paga. Lo que te corresponde lo liquida la
            dueña; si tienes dudas de un pago, háblalo con ella.
          </p>
        </>
      )}
    </div>
  )
}
