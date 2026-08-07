import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fechaHoy, rangoDiaUTC } from '../lib/fechas'
import type { Marcacion, TipoMarcacion } from '../types'

function horaCorta(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

interface FilaPersona {
  nombre: string
  marcas: Partial<Record<TipoMarcacion, string>>
}

export default function Asistencia() {
  const [fecha, setFecha] = useState(fechaHoy())
  const [marcaciones, setMarcaciones] = useState<Marcacion[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCargando(true)
      const { desde, hasta } = rangoDiaUTC(fecha)
      const { data } = await supabase
        .from('marcaciones')
        .select('*, personal:profiles!marcaciones_personal_id_fkey(nombre)')
        .gte('momento', desde)
        .lt('momento', hasta)
        .order('momento')
      if (!cancelado) {
        setMarcaciones((data as Marcacion[]) ?? [])
        setCargando(false)
      }
    }
    cargar()
    return () => {
      cancelado = true
    }
  }, [fecha])

  const filas = useMemo(() => {
    const mapa = new Map<string, FilaPersona>()
    for (const m of marcaciones) {
      const nombre = m.personal?.nombre ?? 'Sin nombre'
      const fila = mapa.get(m.personal_id) ?? { nombre, marcas: {} }
      // La primera marca de cada tipo en el día es la que vale.
      if (!fila.marcas[m.tipo]) fila.marcas[m.tipo] = m.momento
      mapa.set(m.personal_id, fila)
    }
    return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [marcaciones])

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Asistencia del personal</h1>
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
        <div className="bg-white rounded-2xl shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="p-3">Profesional</th>
                <th className="p-3">Entrada</th>
                <th className="p-3">Almuerzo</th>
                <th className="p-3">Regreso</th>
                <th className="p-3">Salida</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.nombre} className="border-b border-gray-50">
                  <td className="p-3 font-medium">{f.nombre}</td>
                  <td className="p-3">{horaCorta(f.marcas.entrada)}</td>
                  <td className="p-3">{horaCorta(f.marcas.inicio_almuerzo)}</td>
                  <td className="p-3">{horaCorta(f.marcas.fin_almuerzo)}</td>
                  <td className="p-3">{horaCorta(f.marcas.salida)}</td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-3 text-gray-400">Nadie marcó jornada este día.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
