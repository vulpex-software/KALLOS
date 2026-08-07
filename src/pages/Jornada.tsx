import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy, rangoDiaUTC } from '../lib/fechas'
import type { Marcacion, TipoMarcacion } from '../types'

const ETIQUETA: Record<TipoMarcacion, string> = {
  entrada: 'Entrada',
  inicio_almuerzo: 'Salgo a almorzar',
  fin_almuerzo: 'Vuelvo del almuerzo',
  salida: 'Salida'
}

function horaCorta(iso: string) {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

export default function Jornada() {
  const { profile } = useAuth()
  const [marcas, setMarcas] = useState<Marcacion[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cargar() {
    if (!profile) return
    const { desde, hasta } = rangoDiaUTC(fechaHoy())
    const { data } = await supabase
      .from('marcaciones')
      .select('*')
      .eq('personal_id', profile.id)
      .gte('momento', desde)
      .lt('momento', hasta)
      .order('momento')
    setMarcas((data as Marcacion[]) ?? [])
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  const hechas = useMemo(() => new Set(marcas.map((m) => m.tipo)), [marcas])

  // Orden lógico de la jornada y cuándo se habilita cada botón.
  const habilitado: Record<TipoMarcacion, boolean> = {
    entrada: !hechas.has('entrada'),
    inicio_almuerzo: hechas.has('entrada') && !hechas.has('inicio_almuerzo') && !hechas.has('salida'),
    fin_almuerzo: hechas.has('inicio_almuerzo') && !hechas.has('fin_almuerzo') && !hechas.has('salida'),
    salida: hechas.has('entrada') && !hechas.has('salida') &&
      (!hechas.has('inicio_almuerzo') || hechas.has('fin_almuerzo'))
  }

  async function marcar(tipo: TipoMarcacion) {
    if (!profile) return
    setError(null)
    setGuardando(true)
    const { error } = await supabase.from('marcaciones').insert({
      salon_id: profile.salon_id,
      personal_id: profile.id,
      tipo
    })
    setGuardando(false)
    if (error) {
      setError('No se pudo registrar. Intenta de nuevo.')
      return
    }
    cargar()
  }

  const orden: TipoMarcacion[] = ['entrada', 'inicio_almuerzo', 'fin_almuerzo', 'salida']

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Mi jornada de hoy</h1>
        <p className="text-sm text-gray-500">Marca tu entrada, tu almuerzo y tu salida.</p>
      </div>

      {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}

      <div className="grid grid-cols-2 gap-3">
        {orden.map((tipo) => {
          const marca = marcas.find((m) => m.tipo === tipo)
          return (
            <button
              key={tipo}
              onClick={() => marcar(tipo)}
              disabled={!habilitado[tipo] || guardando}
              className={`rounded-2xl p-4 text-left border transition ${
                marca
                  ? 'bg-brand-50 border-brand-200'
                  : habilitado[tipo]
                  ? 'bg-brand-600 border-brand-600 text-white hover:bg-brand-700'
                  : 'bg-gray-100 border-gray-200 text-gray-400'
              }`}
            >
              <p className="text-sm font-medium">{ETIQUETA[tipo]}</p>
              <p className={`text-lg font-bold ${marca ? 'text-brand-700' : ''}`}>
                {marca ? horaCorta(marca.momento) : '—'}
              </p>
            </button>
          )
        })}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-gray-500 mb-2">Registro del día</h2>
        <ul className="space-y-2">
          {marcas.map((m) => (
            <li key={m.id} className="bg-white rounded-xl shadow-sm p-3 text-sm flex justify-between">
              <span>{ETIQUETA[m.tipo]}</span>
              <span className="font-medium">{horaCorta(m.momento)}</span>
            </li>
          ))}
          {marcas.length === 0 && <li className="text-sm text-gray-400">Aún no has marcado nada hoy.</li>}
        </ul>
      </div>
    </div>
  )
}
