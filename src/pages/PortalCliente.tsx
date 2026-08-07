import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { METODOS_PAGO, type Cita, type EstadoCita, type Profile, type Servicio } from '../types'

import { fechaHoy as hoy } from '../lib/fechas'
import { calcularHoraFin } from '../lib/horas'
import { comprimirImagen } from '../lib/comprimirImagen'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import { logoParaSalon } from '../lib/branding'

// Horario de atención del salón: no se aceptan solicitudes fuera de este rango.
const HORA_APERTURA = '09:00'
const HORA_CIERRE = '20:00'

const ESTADO_TEXTO: Record<EstadoCita, string> = {
  pendiente: 'En espera de confirmación',
  confirmada: 'Confirmada',
  completada: 'Completada',
  cancelada: 'Cancelada'
}

const ESTADO_ESTILOS: Record<EstadoCita, string> = {
  pendiente: 'bg-amber-100 text-amber-700',
  confirmada: 'bg-blue-100 text-blue-700',
  completada: 'bg-green-100 text-green-700',
  cancelada: 'bg-gray-200 text-gray-500'
}

export default function PortalCliente() {
  const { profile, salon, signOut } = useAuth()
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [serviciosIds, setServiciosIds] = useState<string[]>([])
  const [servicioTemp, setServicioTemp] = useState('')
  // Cuando se elige el servicio "Adicional" (monto y concepto libre), se
  // piden estos dos datos: qué es (ej. "Mariposa") y cuánto vale (ej. 15.000).
  const [adicionalConcepto, setAdicionalConcepto] = useState('')
  const [adicionalValor, setAdicionalValor] = useState('')
  const [fecha, setFecha] = useState(hoy())
  const [hora, setHora] = useState('')
  const [nota, setNota] = useState('')
  const [profesionales, setProfesionales] = useState<Profile[]>([])
  const [profesionalId, setProfesionalId] = useState('')
  // Abono obligatorio para apartar la cita
  const [abono, setAbono] = useState('')
  const [abonoMetodo, setAbonoMetodo] = useState('')
  const [abonoFoto, setAbonoFoto] = useState<File | null>(null)
  const [alternativas, setAlternativas] = useState<{ id: string; nombre: string }[]>([])
  const [misCitas, setMisCitas] = useState<Cita[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('servicios').select('*').eq('activo', true).order('categoria').order('nombre')
      .then(({ data }) => setServicios(data ?? []))
    supabase.from('profiles').select('*').eq('rol', 'personal').eq('activo', true).order('nombre')
      .then(({ data }) => setProfesionales((data as Profile[]) ?? []))
  }, [])

  async function cargarMisCitas() {
    if (!profile) return
    // Columnas explícitas (no "*"): nota_interna es una nota privada de la
    // dueña para la profesional y nunca debe llegarle a la clienta, ni
    // siquiera oculta en la respuesta de red.
    const { data } = await supabase
      .from('citas')
      .select('id, fecha, hora, hora_fin, estado, servicio_id, servicios_ids, adicional_concepto, adicional_valor, empleada_id, servicio:servicios(*), empleada:profiles!citas_empleada_id_fkey(*)')
      .eq('cliente_id', profile.id)
      .order('fecha', { ascending: false })
      .order('hora')
    setMisCitas((data as unknown as Cita[]) ?? [])
  }

  useEffect(() => {
    cargarMisCitas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  const porCategoria = useMemo(() => {
    const mapa = new Map<string, Servicio[]>()
    for (const s of servicios) {
      const lista = mapa.get(s.categoria) ?? []
      lista.push(s)
      mapa.set(s.categoria, lista)
    }
    return [...mapa.entries()]
  }, [servicios])

  // El servicio genérico "Adicional (monto y concepto libre)" del catálogo.
  const servicioAdicional = servicios.find((s) => s.categoria === 'Adicional')
  const incluyeAdicional = serviciosIds.includes(servicioAdicional?.id ?? '') || servicioTemp === servicioAdicional?.id

  function agregarServicio() {
    if (!servicioTemp || serviciosIds.includes(servicioTemp)) return
    setServiciosIds((prev) => [...prev, servicioTemp])
    setServicioTemp('')
  }

  async function solicitar(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    const lista = servicioTemp && !serviciosIds.includes(servicioTemp) ? [...serviciosIds, servicioTemp] : serviciosIds
    if (lista.length === 0) { setError('Elige al menos un servicio.'); return }
    if (hora < HORA_APERTURA || hora > HORA_CIERRE) {
      setError(`El horario de atención es de ${HORA_APERTURA} a ${HORA_CIERRE}. Elige otra hora.`)
      return
    }
    if (servicioAdicional && lista.includes(servicioAdicional.id)) {
      if (!adicionalConcepto.trim()) { setError('Escribe qué es el adicional (ej: Mariposa).'); return }
      if (!adicionalValor || Number(adicionalValor) <= 0) { setError('Escribe el valor del adicional.'); return }
    }
    // El abono es obligatorio para apartar la cita: monto + medio + comprobante.
    const montoAbono = Number(abono)
    if (!montoAbono || montoAbono <= 0) { setError('Escribe el valor del abono que pagaste.'); return }
    if (!abonoMetodo) { setError('Elige el medio con el que pagaste el abono.'); return }
    if (!abonoFoto) { setError('Sube la foto del comprobante del abono.'); return }
    setError(null)
    setMensaje(null)
    setAlternativas([])

    // La clienta no define duración: usamos un estimado para avisar cruces.
    // La dueña ajusta el horario real (inicio/término) al agendar/confirmar.
    const horaFin = calcularHoraFin(hora, 60)

    // Si eligió una profesional, verificar disponibilidad; si no, ofrecer alternativas.
    if (profesionalId) {
      const { data: libres } = await supabase.rpc('profesionales_disponibles', {
        p_salon_id: profile?.salon_id, p_fecha: fecha, p_desde: hora, p_hasta: horaFin
      })
      const lista2 = (libres as { id: string; nombre: string }[]) ?? []
      if (!lista2.some((p) => p.id === profesionalId)) {
        setError('Esa profesional no está disponible a esa hora. Elige otra hora o una de estas disponibles:')
        setAlternativas(lista2)
        return
      }
    }

    setGuardando(true)
    try {
      // Subir la foto del comprobante del abono
      const comprimida = await comprimirImagen(abonoFoto)
      const path = `${profile.salon_id}/abonos/${profile.id}/${Date.now()}_${comprimida.name}`
      const { error: upErr } = await supabase.storage.from('evidencias').upload(path, comprimida)
      if (upErr) throw upErr

      const { error } = await supabase.from('citas').insert({
        salon_id: profile.salon_id,
        servicio_id: lista[0],
        servicios_ids: lista,
        cliente_id: profile.id,
        cliente_nombre: profile.nombre,
        cliente_telefono: profile.telefono,
        fecha,
        hora,
        hora_fin: horaFin,
        nota: nota || null,
        empleada_id: profesionalId || null,
        abono: montoAbono,
        abono_metodo_pago: abonoMetodo,
        abono_foto_url: path,
        adicional_concepto: servicioAdicional && lista.includes(servicioAdicional.id) ? adicionalConcepto.trim() : null,
        adicional_valor: servicioAdicional && lista.includes(servicioAdicional.id) ? Number(adicionalValor) : null,
        creado_por: profile.id
      })
      if (error) throw error

      setMensaje('¡Solicitud enviada! El salón verificará tu abono y confirmará la cita.')
      setServiciosIds([])
      setServicioTemp('')
      setAdicionalConcepto('')
      setAdicionalValor('')
      setHora('')
      setNota('')
      setProfesionalId('')
      setAbono('')
      setAbonoMetodo('')
      setAbonoFoto(null)
      setAlternativas([])
      cargarMisCitas()
    } catch (err) {
      setError('No se pudo enviar la solicitud: ' + (err instanceof Error ? err.message : ''))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="min-h-screen">
      <header className="bg-ink/95 backdrop-blur border-b border-brand-900 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <span className="flex items-center gap-2.5 min-w-0">
          <img src={logoParaSalon(salon)} alt={salon?.plan !== 'basico' ? salon?.nombre ?? 'KALLOS' : 'KALLOS'} className="w-10 h-10 object-contain shrink-0" />
          <span className="min-w-0 leading-tight">
            <span className="block font-serif font-semibold text-brand-300 tracking-[0.2em] truncate">KALLOS</span>
            <span className="block text-[9px] uppercase tracking-[0.14em] text-brand-500 truncate">{salon?.nombre ?? 'The order behind the beauty'}</span>
          </span>
        </span>
        <div className="flex items-center gap-3 text-sm">
          <a href="/manual.html?rol=cliente" target="_blank" rel="noopener noreferrer" className="text-brand-300" aria-label="Ayuda: cómo agendar tu cita">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 1.9-2.4 3.7" />
              <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
            </svg>
          </a>
          <span className="text-gray-400">{profile?.nombre}</span>
          <button onClick={signOut} className="text-gray-500 hover:text-red-400">Salir</button>
        </div>
      </header>

      <div className="max-w-lg mx-auto p-4 space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Hola, {profile?.nombre} 💗</h1>
          <p className="text-sm text-gray-500">Solicita tu cita y el salón te confirmará.</p>
        </div>

        <form onSubmit={solicitar} className="bg-white rounded-2xl shadow p-4 space-y-3">
          {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
          {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

          <div>
            <label className="block text-sm font-medium mb-1">¿Qué servicios quieres?</label>
            {serviciosIds.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {serviciosIds.map((id) => {
                  const s = servicios.find((x) => x.id === id)
                  return (
                    <span key={id} className="inline-flex items-center gap-1 text-xs bg-brand-100 text-brand-700 rounded-full px-2 py-1">
                      {s?.nombre ?? 'Servicio'}
                      <button type="button" onClick={() => setServiciosIds((p) => p.filter((x) => x !== id))} className="text-brand-500">✕</button>
                    </span>
                  )
                })}
              </div>
            )}
            <div className="flex gap-2">
              <select value={servicioTemp} onChange={(e) => setServicioTemp(e.target.value)} className="flex-1 rounded-lg border border-gray-300 px-3 py-2">
                <option value="">Selecciona un servicio</option>
                {porCategoria.map(([categoria, lista]) => (
                  <optgroup key={categoria} label={categoria}>
                    {lista.map((s) => (
                      <option key={s.id} value={s.id} disabled={serviciosIds.includes(s.id)}>{s.nombre} — ${Number(s.precio_base).toLocaleString('es-CO')}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button type="button" onClick={agregarServicio} disabled={!servicioTemp} className="px-3 rounded-lg border border-brand-300 text-brand-700 disabled:opacity-40 text-sm font-medium">
                Agregar
              </button>
            </div>

            {incluyeAdicional && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 bg-brand-50/50 border border-brand-100 rounded-lg p-3">
                <div>
                  <label className="block text-sm font-medium mb-1">¿Qué es el adicional?</label>
                  <input
                    value={adicionalConcepto}
                    onChange={(e) => setAdicionalConcepto(e.target.value)}
                    placeholder="Ej: Mariposa"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Valor</label>
                  <input
                    type="text" inputMode="numeric"
                    value={formatearPesosInput(adicionalValor)}
                    onChange={(e) => setAdicionalValor(soloDigitos(e.target.value))}
                    placeholder="Ej: 15.000"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Fecha deseada</label>
              <input type="date" required min={hoy()} value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Hora deseada</label>
              <input type="time" required min={HORA_APERTURA} max={HORA_CIERRE} value={hora} onChange={(e) => setHora(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
              <p className="text-xs text-gray-400 mt-1">Atendemos de {HORA_APERTURA} a {HORA_CIERRE}.</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Profesional (opcional)</label>
            <select value={profesionalId} onChange={(e) => { setProfesionalId(e.target.value); setAlternativas([]) }} className="w-full rounded-lg border border-gray-300 px-3 py-2">
              <option value="">Cualquiera (el salón asigna)</option>
              {profesionales.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            {alternativas.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {alternativas.map((a) => (
                  <button key={a.id} type="button" onClick={() => { setProfesionalId(a.id); setAlternativas([]); setError(null) }} className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-1">
                    {a.nombre}
                  </button>
                ))}
              </div>
            )}
            {alternativas.length === 0 && error && error.includes('disponible') && (
              <p className="text-xs text-amber-700 mt-1">No hay profesionales libres a esa hora. Prueba otra hora.</p>
            )}
          </div>

          {/* Abono obligatorio para apartar la cita */}
          <div className="border border-brand-200 bg-brand-50/50 rounded-xl p-3 space-y-3">
            <p className="text-sm font-medium text-brand-700">Abono para apartar tu cita</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Valor abonado</label>
                <input
                  type="text" inputMode="numeric" required
                  value={formatearPesosInput(abono)}
                  onChange={(e) => setAbono(soloDigitos(e.target.value))}
                  placeholder="Ej: 20.000"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Medio de pago</label>
                <select required value={abonoMetodo} onChange={(e) => setAbonoMetodo(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                  <option value="">Selecciona…</option>
                  {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Foto del comprobante</label>
              <input type="file" accept="image/*" required onChange={(e) => setAbonoFoto(e.target.files?.[0] ?? null)} className="w-full text-sm" />
              <p className="text-xs text-gray-400 mt-1">El salón verificará tu abono antes de confirmar la cita.</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Nota (opcional)</label>
            <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Algún detalle que quieras contarnos" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>

          <button type="submit" disabled={guardando} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition">
            {guardando ? 'Enviando…' : 'Solicitar cita'}
          </button>
        </form>

        <div>
          <h2 className="text-sm font-semibold text-gray-500 mb-2">Mis citas</h2>
          <ul className="space-y-2">
            {misCitas.map((c) => (
              <li key={c.id} className="bg-white rounded-xl shadow-sm p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {c.servicio?.categoria === 'Adicional' && c.adicional_concepto ? `Adicional: ${c.adicional_concepto}` : c.servicio?.nombre}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded-full ${ESTADO_ESTILOS[c.estado]}`}>{ESTADO_TEXTO[c.estado]}</span>
                </div>
                <p className="text-gray-500 text-xs mt-1">
                  {c.fecha} · {c.hora.slice(0, 5)}
                  {c.empleada?.nombre ? ` · con ${c.empleada.nombre}` : ' · manicurista por asignar'}
                </p>
              </li>
            ))}
            {misCitas.length === 0 && <li className="text-sm text-gray-400">Aún no has solicitado citas.</li>}
          </ul>
        </div>

        <p className="text-center text-[11px] text-gray-300 pt-2">Developed by Vulpex Software SAS</p>
      </div>
    </div>
  )
}
