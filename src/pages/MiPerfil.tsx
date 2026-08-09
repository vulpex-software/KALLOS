import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { ESPECIALIDADES, type Prestamo, type PrestamoPago } from '../types'

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

export default function MiPerfil() {
  const { profile } = useAuth()
  const [prestamos, setPrestamos] = useState<Prestamo[]>([])
  const [pagos, setPagos] = useState<PrestamoPago[]>([])

  useEffect(() => {
    if (!profile) return
    Promise.all([
      supabase.from('prestamos').select('*').eq('persona_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('prestamo_pagos').select('*').order('created_at', { ascending: false })
    ]).then(([{ data: prest }, { data: pagosData }]) => {
      setPrestamos((prest as Prestamo[]) ?? [])
      setPagos((pagosData as PrestamoPago[]) ?? [])
    })
  }, [profile])

  // Los abonos parciales (prestamo_pagos) hay que restarlos del monto -- si
  // solo se mira "pagado" (que únicamente se marca true al saldar del todo),
  // un préstamo con abonos pero no saldado se veía como si debiera el total.
  const pagosPorPrestamo = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of pagos) m.set(p.prestamo_id, (m.get(p.prestamo_id) ?? 0) + Number(p.monto))
    return m
  }, [pagos])

  function pendienteDe(p: Prestamo): number {
    if (p.pagado) return 0
    return Math.max(0, Number(p.monto) - (pagosPorPrestamo.get(p.id) ?? 0))
  }

  const pendiente = useMemo(
    () => prestamos.reduce((s, p) => s + pendienteDe(p), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prestamos, pagosPorPrestamo]
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
          {prestamos.map((p) => {
            const pend = pendienteDe(p)
            const pagosDeEste = pagos.filter((pg) => pg.prestamo_id === p.id)
            return (
              <li key={p.id} className="border-b border-gray-50 pb-2 space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium">
                      {p.tipo === 'insumo' ? 'Insumo' : p.tipo === 'insumo_interno' ? 'Insumo interno' : 'Dinero'}
                      {p.descripcion ? ` · ${p.descripcion}` : ''}
                    </p>
                    <p className="text-xs text-gray-400">{p.created_at.slice(0, 10)}</p>
                  </div>
                  <span className={`font-semibold ${pend <= 0 ? 'line-through text-gray-400' : 'text-red-600'}`}>
                    {pend > 0 && pend < Number(p.monto) ? `Debe ${pesos(pend)} de ` : ''}{pesos(Number(p.monto))}
                  </span>
                </div>
                {pagosDeEste.length > 0 && (
                  <ul className="text-xs text-green-700 space-y-0.5 pl-1">
                    {pagosDeEste.map((pg) => (
                      <li key={pg.id}>✓ {pesos(Number(pg.monto))} el {pg.created_at.slice(0, 10)}{pg.nota ? ` · ${pg.nota}` : ''}</li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
          {prestamos.length === 0 && <li className="text-sm text-gray-400">No tienes préstamos registrados.</li>}
        </ul>
      </div>
    </div>
  )
}
