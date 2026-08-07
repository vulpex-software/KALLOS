import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { RegistroTrabajo } from '../types'

const UN_MES_MS = 30 * 24 * 60 * 60 * 1000

function fechaCorta(iso: string) {
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function Historial() {
  const [registros, setRegistros] = useState<RegistroTrabajo[]>([])
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState('')

  // Borra las fotos de más de 1 mes (deja el registro sin foto).
  async function limpiarFotosViejas() {
    const corte = new Date(Date.now() - UN_MES_MS).toISOString()
    const { data } = await supabase
      .from('registros_trabajo')
      .select('id, foto_url')
      .not('foto_url', 'is', null)
      .lt('created_at', corte)
    const viejos = (data as { id: string; foto_url: string }[]) ?? []
    if (viejos.length === 0) return
    const paths = viejos.map((r) => r.foto_url).filter(Boolean)
    if (paths.length) await supabase.storage.from('evidencias').remove(paths)
    await supabase.from('registros_trabajo').update({ foto_url: null }).in('id', viejos.map((r) => r.id))
  }

  async function cargar() {
    setCargando(true)
    await limpiarFotosViejas()
    const { data } = await supabase
      .from('registros_trabajo')
      .select('*, servicio:servicios(*), empleada:profiles!registros_trabajo_empleada_id_fkey(*)')
      .order('created_at', { ascending: false })
      .limit(300)
    setRegistros((data as RegistroTrabajo[]) ?? [])
    setCargando(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  async function verFoto(path: string) {
    const { data } = await supabase.storage.from('evidencias').createSignedUrl(path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const visibles = registros.filter((r) => {
    const f = filtro.trim().toLowerCase()
    if (!f) return true
    return (r.cliente_nombre ?? '').toLowerCase().includes(f) || (r.servicio?.nombre ?? '').toLowerCase().includes(f)
  })

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <h1 className="text-lg font-semibold">Historial de atendidas</h1>
      <p className="text-sm text-gray-500 -mt-2">
        Las fotos se conservan <b>1 mes</b>; después queda el registro de la atención sin foto.
      </p>

      <input
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Buscar por clienta o servicio…"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />

      {cargando ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : (
        <ul className="space-y-2">
          {visibles.map((r) => (
            <li key={r.id} className={`bg-white rounded-xl shadow-sm p-3 text-sm flex items-center justify-between gap-2 ${r.anulado ? 'opacity-50' : ''}`}>
              <div className="min-w-0">
                <p className="font-medium truncate">{r.cliente_nombre || 'Sin nombre'}</p>
                <p className="text-xs text-gray-400 truncate">
                  {r.servicio?.nombre} · {r.empleada?.nombre} · {fechaCorta(r.created_at)}
                  {r.anulado && <span className="text-red-500"> (anulado)</span>}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-medium">${Number(r.precio_cobrado).toLocaleString('es-CO')}</span>
                {r.foto_url ? (
                  <button onClick={() => verFoto(r.foto_url!)} className="text-xs bg-brand-100 text-brand-700 rounded-lg px-2 py-1">Ver foto</button>
                ) : (
                  <span className="text-xs text-gray-300">sin foto</span>
                )}
              </div>
            </li>
          ))}
          {visibles.length === 0 && <li className="text-sm text-gray-400">Sin atenciones registradas.</li>}
        </ul>
      )}
    </div>
  )
}
