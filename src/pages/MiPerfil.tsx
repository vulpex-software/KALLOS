import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { ESPECIALIDADES, type Prestamo } from '../types'

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

export default function MiPerfil() {
  const { profile } = useAuth()
  const [prestamos, setPrestamos] = useState<Prestamo[]>([])

  useEffect(() => {
    if (!profile) return
    supabase.from('prestamos').select('*').eq('persona_id', profile.id).order('created_at', { ascending: false })
      .then(({ data }) => setPrestamos((data as Prestamo[]) ?? []))
  }, [profile])

  const pendiente = useMemo(
    () => prestamos.filter((p) => !p.pagado).reduce((s, p) => s + Number(p.monto), 0),
    [prestamos]
  )

  if (!profile) return null

  const dato = (label: string, valor: string | null) => (
    <div className="flex justify-between text-sm py-1.5 border-b border-gray-50">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-right">{valor || '—'}</span>
    </div>
  )

  const especialidadesTexto = (profile.especialidades ?? [])
    .map((e) => ESPECIALIDADES.find((x) => x.valor === e)?.etiqueta ?? e)
    .join(', ')

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Mi perfil</h1>

      <div className="bg-white rounded-2xl shadow p-4">
        <p className="font-semibold text-brand-700 mb-2">{profile.nombre} {profile.apellidos ?? ''}</p>
        {dato('Especialidades', especialidadesTexto || '—')}
        {dato('Cédula', profile.cedula)}
        {dato('Teléfono', profile.telefono)}
        {dato('Correo', profile.correo)}
        {dato('Dirección', profile.direccion)}
        {dato('Fecha de nacimiento', profile.fecha_nacimiento)}
        {dato('Ingreso al spa', profile.fecha_ingreso)}
        <p className="text-xs text-gray-400 mt-2">Si algún dato está mal, avísale a la administración para corregirlo.</p>
      </div>

      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-600">Mis préstamos / fiados</h2>
          {pendiente > 0 && <span className="text-sm font-semibold text-red-600">Debes {pesos(pendiente)}</span>}
        </div>
        <ul className="space-y-2">
          {prestamos.map((p) => (
            <li key={p.id} className="flex items-center justify-between text-sm border-b border-gray-50 pb-2">
              <div>
                <p className="font-medium">{p.tipo === 'insumo' ? 'Insumo' : 'Dinero'}{p.descripcion ? ` · ${p.descripcion}` : ''}</p>
                <p className="text-xs text-gray-400">{p.created_at.slice(0, 10)}</p>
              </div>
              <span className={`font-semibold ${p.pagado ? 'line-through text-gray-400' : 'text-red-600'}`}>{pesos(Number(p.monto))}</span>
            </li>
          ))}
          {prestamos.length === 0 && <li className="text-sm text-gray-400">No tienes préstamos registrados.</li>}
        </ul>
      </div>
    </div>
  )
}
