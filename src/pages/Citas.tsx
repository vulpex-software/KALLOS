import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase, crearClienteEfimero } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { linkWhatsApp, mensajeCita } from '../lib/whatsapp'
import { fechaHoy as hoy } from '../lib/fechas'
import { DOMINIO_INTERNO } from '../lib/authDominio'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import { comprimirImagen } from '../lib/comprimirImagen'
import { METODOS_PAGO, type Cita, type CreditoCliente, type EstadoCita, type Obsequio, type Profile, type Servicio } from '../types'

const ESTADO_ESTILOS: Record<EstadoCita, string> = {
  pendiente: 'bg-amber-100 text-amber-700',
  confirmada: 'bg-blue-100 text-blue-700',
  completada: 'bg-green-100 text-green-700',
  cancelada: 'bg-gray-200 text-gray-500'
}

// El horario de atención del salón: no se agendan citas fuera de este rango.
const HORA_APERTURA = '09:00'
const HORA_CIERRE = '20:00'

const ORDEN_ESTADOS: EstadoCita[] = ['pendiente', 'confirmada', 'completada', 'cancelada']
const ETIQUETA_ESTADO: Record<EstadoCita, string> = {
  pendiente: 'Pendientes',
  confirmada: 'Confirmadas',
  completada: 'Completadas',
  cancelada: 'Canceladas'
}

interface ClienteLite { id: string; nombre: string; telefono: string | null; cedula: string | null }

export default function Citas() {
  const { profile, salon } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [fecha, setFecha] = useState(hoy())
  const [citas, setCitas] = useState<Cita[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [empleadas, setEmpleadas] = useState<Profile[]>([])
  const [obsequios, setObsequios] = useState<Obsequio[]>([])

  const [empleadaId, setEmpleadaId] = useState('')
  const [serviciosIds, setServiciosIds] = useState<string[]>([])
  const [servicioTemp, setServicioTemp] = useState('')
  // Cuando se elige el servicio "Adicional" (monto y concepto libre), se
  // piden estos dos datos: qué es (ej. "Mariposa") y cuánto vale (ej. 15.000).
  const [adicionalConcepto, setAdicionalConcepto] = useState('')
  const [adicionalValor, setAdicionalValor] = useState('')
  const [cedula, setCedula] = useState('')
  const [clienteId, setClienteId] = useState<string | null>(null)
  // Saldo a favor sin usar de la clienta seleccionada (ver Cuentas por cobrar).
  const [creditosDisponibles, setCreditosDisponibles] = useState<CreditoCliente[]>([])
  const [buscando, setBuscando] = useState(false)
  const [infoCedula, setInfoCedula] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<ClienteLite[]>([])
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [fechaCita, setFechaCita] = useState(hoy())
  const [hora, setHora] = useState('')
  const [horaFin, setHoraFin] = useState('')
  const [abono, setAbono] = useState('')
  const [abonoMetodo, setAbonoMetodo] = useState('')
  const [abonoFoto, setAbonoFoto] = useState<File | null>(null)
  const [obsequio, setObsequio] = useState('')
  const [notaInterna, setNotaInterna] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimaCreada, setUltimaCreada] = useState<Cita | null>(null)

  // Modal de "Confirmar" / "Reprogramar": deja ajustar fecha, hora, hora de
  // término y obsequio antes de enviar el WhatsApp. Se usa tanto para
  // confirmar una solicitud pendiente como para reprogramar una ya
  // confirmada (la clienta cambia de opinión o hubo un error).
  const [confirmando, setConfirmando] = useState<Cita | null>(null)
  const [modalFecha, setModalFecha] = useState('')
  const [modalHora, setModalHora] = useState('')
  const [modalHoraFin, setModalHoraFin] = useState('')
  const [modalObsequio, setModalObsequio] = useState('')
  const [modalNotaInterna, setModalNotaInterna] = useState('')
  const [confirmandoGuardando, setConfirmandoGuardando] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  async function cargarCitas() {
    const { data } = await supabase
      .from('citas')
      .select('*, servicio:servicios(*), empleada:profiles!citas_empleada_id_fkey(*)')
      .eq('fecha', fecha)
      .order('hora')
    setCitas((data as Cita[]) ?? [])
  }

  useEffect(() => {
    cargarCitas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha])

  // Si se llegó aquí desde la campanita de notificaciones (ver Layout), abre
  // directamente el modal de esa cita para confirmarla/reprogramarla.
  useEffect(() => {
    const state = location.state as { citaParaAbrir?: Cita } | null
    if (state?.citaParaAbrir) {
      abrirConfirmar(state.citaParaAbrir)
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  useEffect(() => {
    supabase.from('servicios').select('*').eq('activo', true).order('categoria').order('nombre')
      .then(({ data }) => setServicios(data ?? []))
    // Cualquier profesional activa puede recibir cualquier servicio, sin importar
    // su especialidad, así que aquí se listan TODAS las del personal.
    supabase.from('profiles').select('*').eq('rol', 'personal').eq('activo', true).order('nombre')
      .then(({ data }) => setEmpleadas(data ?? []))
    supabase.from('obsequios').select('*').eq('activo', true).order('nombre')
      .then(({ data }) => setObsequios((data as Obsequio[]) ?? []))
  }, [])

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

  const nombreServicios = (c: Cita): string[] => {
    const ids = c.servicios_ids && c.servicios_ids.length > 0 ? c.servicios_ids : c.servicio_id ? [c.servicio_id] : []
    return ids.map((id) => {
      const s = servicios.find((x) => x.id === id)
      if (s?.categoria === 'Adicional' && c.adicional_concepto) {
        const valorTxt = c.adicional_valor != null ? ` ($${Number(c.adicional_valor).toLocaleString('es-CO')})` : ''
        return `Adicional: ${c.adicional_concepto}${valorTxt}`
      }
      return s?.nombre ?? c.servicio?.nombre ?? 'Servicio'
    })
  }

  function agregarServicio() {
    if (!servicioTemp || serviciosIds.includes(servicioTemp)) return
    setServiciosIds((prev) => [...prev, servicioTemp])
    setServicioTemp('')
  }

  // Búsqueda en vivo de clientas por nombre o cédula.
  useEffect(() => {
    const q = busqueda.trim()
    if (q.length < 2) { setResultados([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, nombre, telefono, cedula')
        .eq('rol', 'cliente')
        .or(`nombre.ilike.%${q}%,cedula.ilike.%${q}%`)
        .order('nombre')
        .limit(8)
      setResultados((data as ClienteLite[]) ?? [])
    }, 250)
    return () => clearTimeout(t)
  }, [busqueda])

  function seleccionarCliente(r: ClienteLite) {
    setClienteId(r.id)
    setClienteNombre(r.nombre)
    setClienteTelefono(r.telefono ?? '')
    setCedula(r.cedula ?? '')
    setInfoCedula(`✓ Clienta seleccionada: ${r.nombre}`)
    setBusqueda('')
    setResultados([])
    supabase
      .from('creditos_clientes')
      .select('*')
      .eq('cliente_id', r.id)
      .eq('resolucion', 'credito')
      .eq('usado', false)
      .then(({ data }) => setCreditosDisponibles((data as CreditoCliente[]) ?? []))
  }

  // Marca el saldo a favor como aplicado, una vez la administradora ya lo
  // descontó del abono al agendar esta cita.
  async function marcarCreditosUsados(cita: Cita) {
    if (creditosDisponibles.length === 0) return
    await supabase
      .from('creditos_clientes')
      .update({ usado: true, usado_en_cita_id: cita.id })
      .in('id', creditosDisponibles.map((c) => c.id))
    setCreditosDisponibles([])
  }

  // Crea la clienta con su cédula (usuario y contraseña = cédula) y la enlaza.
  async function crearClientePorCedula() {
    const ced = cedula.trim()
    if (ced.length < 6) { setInfoCedula('La cédula debe tener al menos 6 dígitos.'); return }
    if (!clienteNombre.trim()) { setInfoCedula('Escribe el nombre de la clienta.'); return }
    if (!profile?.salon_id) { setInfoCedula('No se pudo determinar tu salón. Vuelve a iniciar sesión.'); return }
    setBuscando(true); setInfoCedula(null)
    const efimero = crearClienteEfimero()
    const { data, error } = await efimero.auth.signUp({
      email: `${ced}@${DOMINIO_INTERNO}`,
      password: ced,
      options: { data: { nombre: clienteNombre, telefono: clienteTelefono, cedula: ced, salon_id: profile.salon_id } }
    })
    setBuscando(false)
    if (error) {
      setInfoCedula(
        error.message.toLowerCase().includes('registered') || error.message.toLowerCase().includes('already')
          ? 'Esa cédula ya tiene cuenta. Usa "Buscar" para traerla.'
          : 'No se pudo crear la clienta: ' + error.message
      )
      return
    }
    if (data.user?.id) {
      setClienteId(data.user.id)
      setInfoCedula(`✓ Clienta creada: ${clienteNombre}. Entrará con su cédula.`)
    }
  }

  async function crearCita(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    // Si eligió un servicio pero no le dio "Agregar", lo incluimos igual.
    const lista = servicioTemp && !serviciosIds.includes(servicioTemp) ? [...serviciosIds, servicioTemp] : serviciosIds
    if (lista.length === 0) { setError('Elige al menos un servicio.'); return }
    if (horaFin <= hora) { setError('La hora de término debe ser después de la hora de inicio.'); return }
    if (hora < HORA_APERTURA || hora > HORA_CIERRE) {
      setError(`La hora de inicio debe estar entre ${HORA_APERTURA} y ${HORA_CIERRE}.`)
      return
    }
    if (servicioAdicional && lista.includes(servicioAdicional.id)) {
      if (!adicionalConcepto.trim()) { setError('Escribe qué es el adicional (ej: Mariposa).'); return }
      if (!adicionalValor || Number(adicionalValor) <= 0) { setError('Escribe el valor del adicional.'); return }
    }
    const montoAbono = Number(abono || 0)
    if (montoAbono > 0 && !abonoFoto) { setError('Sube la foto del comprobante del abono.'); return }
    setError(null)

    // Si hay profesional elegida, verificar que no tenga cruce en ese horario.
    if (empleadaId) {
      const { data: libres } = await supabase.rpc('profesionales_disponibles', {
        p_salon_id: profile?.salon_id, p_fecha: fechaCita, p_desde: hora, p_hasta: horaFin
      })
      const disponible = ((libres as { id: string }[]) ?? []).some((p) => p.id === empleadaId)
      if (!disponible) {
        setError('Esa profesional ya tiene una cita en ese horario. Elige otra hora u otra profesional (o déjala sin asignar).')
        return
      }
    }

    setGuardando(true)

    // Si hay abono, subir la foto del comprobante antes de crear la cita.
    let abonoFotoPath: string | null = null
    if (montoAbono > 0 && abonoFoto) {
      const comprimida = await comprimirImagen(abonoFoto)
      const path = `${profile.salon_id}/abonos/${clienteId ?? profile.id}/${Date.now()}_${comprimida.name}`
      const { error: upErr } = await supabase.storage.from('evidencias').upload(path, comprimida)
      if (upErr) {
        setGuardando(false)
        setError('No se pudo subir la foto del comprobante: ' + upErr.message)
        return
      }
      abonoFotoPath = path
    }

    const { data, error } = await supabase
      .from('citas')
      .insert({
        salon_id: profile.salon_id,
        empleada_id: empleadaId || null,
        servicio_id: lista[0],
        servicios_ids: lista,
        cliente_id: clienteId,
        cliente_nombre: clienteNombre,
        cliente_telefono: clienteTelefono || null,
        fecha: fechaCita,
        hora,
        hora_fin: horaFin,
        abono: montoAbono,
        abono_metodo_pago: montoAbono > 0 && abonoMetodo ? abonoMetodo : null,
        abono_foto_url: abonoFotoPath,
        obsequio: obsequio || null,
        nota_interna: notaInterna.trim() || null,
        adicional_concepto: servicioAdicional && lista.includes(servicioAdicional.id) ? adicionalConcepto.trim() : null,
        adicional_valor: servicioAdicional && lista.includes(servicioAdicional.id) ? Number(adicionalValor) : null,
        creado_por: profile.id
      })
      .select('*, servicio:servicios(*), empleada:profiles!citas_empleada_id_fkey(*)')
      .single()

    setGuardando(false)
    if (error) {
      setError('No se pudo agendar la cita: ' + error.message)
      return
    }

    const citaCreada = data as Cita

    // Notificación push a la profesional asignada (fire-and-forget).
    if (empleadaId) {
      const empleadaNombre = empleadas.find((e) => e.id === empleadaId)?.nombre ?? 'tú'
      const notaParaEnvio = notaInterna.trim()
      const cuerpoAviso = `${citaCreada.cliente_nombre} · ${citaCreada.fecha} ${citaCreada.hora.slice(0, 5)}${notaParaEnvio ? ` · 📌 ${notaParaEnvio}` : ''} — ${empleadaNombre}`
      supabase.auth.getSession().then(({ data: sesion }) => {
        fetch('/api/send-push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(sesion.session?.access_token ? { Authorization: `Bearer ${sesion.session.access_token}` } : {})
          },
          body: JSON.stringify({
            empleada_id: empleadaId,
            titulo: '📅 Nueva cita asignada',
            cuerpo: cuerpoAviso,
            url: '/jornada',
          }),
        }).catch(() => { /* notificación opcional, no bloquea */ })
      }).catch(() => { /* notificación opcional, no bloquea */ })
    }

    setUltimaCreada(citaCreada)
    setEmpleadaId('')
    setServiciosIds([])
    setServicioTemp('')
    setAdicionalConcepto('')
    setAdicionalValor('')
    setCedula('')
    setClienteId(null)
    setInfoCedula(null)
    setBusqueda('')
    setResultados([])
    setClienteNombre('')
    setClienteTelefono('')
    setHora('')
    setHoraFin('')
    setAbono('')
    setAbonoMetodo('')
    setAbonoFoto(null)
    setObsequio('')
    setNotaInterna('')
    if (citaCreada.fecha === fecha) cargarCitas()
  }

  async function cambiarEstado(cita: Cita, estado: EstadoCita) {
    await supabase.from('citas').update({ estado }).eq('id', cita.id)
    cargarCitas()
  }

  function abrirConfirmar(cita: Cita) {
    setConfirmando(cita)
    setModalFecha(cita.fecha)
    setModalHora(cita.hora.slice(0, 5))
    setModalHoraFin(cita.hora_fin ?? '')
    setModalObsequio(cita.obsequio ?? '')
    setModalNotaInterna(cita.nota_interna ?? '')
    setModalError(null)
  }

  // Guarda fecha, hora, hora de término y obsequio (todo ajustable), y abre
  // WhatsApp con el mensaje ya actualizado. Si la cita estaba pendiente, la
  // pasa a Confirmada; si ya estaba confirmada, la reprograma (el trigger de
  // la base de datos la marca para avisar en la campanita).
  async function confirmarCita() {
    if (!confirmando) return
    if (!modalFecha || !modalHora) {
      setModalError('Escribe la fecha y la hora.')
      return
    }
    if (modalHora < HORA_APERTURA || modalHora > HORA_CIERRE) {
      setModalError(`La hora de inicio debe estar entre ${HORA_APERTURA} y ${HORA_CIERRE}.`)
      return
    }
    const esReprogramacion = confirmando.estado !== 'pendiente'
    setConfirmandoGuardando(true)
    setModalError(null)
    const { data, error } = await supabase
      .from('citas')
      .update({
        ...(esReprogramacion ? {} : { estado: 'confirmada' }),
        fecha: modalFecha,
        hora: modalHora,
        hora_fin: modalHoraFin || null,
        obsequio: modalObsequio || null,
        nota_interna: modalNotaInterna.trim() || null,
      })
      .eq('id', confirmando.id)
      .select('*, servicio:servicios(*), empleada:profiles!citas_empleada_id_fkey(*)')
      .single()
    setConfirmandoGuardando(false)
    if (error) {
      setModalError('No se pudo guardar: ' + error.message)
      return
    }
    const citaActualizada = data as Cita
    window.open(linkWhatsApp(citaActualizada, nombreServicios(citaActualizada), salon?.nombre), '_blank')
    setConfirmando(null)
    cargarCitas()
  }

  async function marcarVisto(cita: Cita) {
    await supabase.from('citas').update({ reprogramada: false }).eq('id', cita.id)
    cargarCitas()
  }

  async function asignarManicurista(cita: Cita, empId: string) {
    if (!empId) return
    await supabase.from('citas').update({ empleada_id: empId }).eq('id', cita.id)
    cargarCitas()
  }

  async function copiarMensaje(cita: Cita) {
    await navigator.clipboard.writeText(mensajeCita(cita, nombreServicios(cita), salon?.nombre))
  }

  // Abre la foto del comprobante del abono en una pestaña nueva (URL firmada, 5 min).
  async function verComprobante(path: string) {
    const { data } = await supabase.storage.from('evidencias').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  function renderCita(c: Cita) {
    return (
      <li key={c.id} className="bg-white rounded-2xl shadow p-4 space-y-2">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-medium text-sm">
              {c.hora.slice(0, 5)}{c.hora_fin ? `–${c.hora_fin.slice(0, 5)}` : ''} · {nombreServicios(c).join(', ')}
            </p>
            <p className="text-xs text-gray-500">
              {c.empleada?.nombre ?? 'Sin asignar'} · {c.cliente_nombre}
            </p>
            {c.nota && <p className="text-xs text-gray-400">{c.nota}</p>}
            {c.nota_interna && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-0.5 mt-0.5">
                📌 {c.nota_interna}
              </p>
            )}
            {c.obsequio && <p className="text-xs text-brand-600">Obsequio: {c.obsequio}</p>}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`text-xs px-2 py-1 rounded-full ${ESTADO_ESTILOS[c.estado]}`}>{c.estado}</span>
            {c.reprogramada && (
              <span className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700">Reprogramada</span>
            )}
          </div>
        </div>

        {!c.empleada_id && c.estado !== 'cancelada' && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
            <label className="block text-xs font-medium text-amber-800 mb-1">Asignar profesional</label>
            <select
              defaultValue=""
              onChange={(e) => asignarManicurista(c, e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="" disabled>Selecciona una profesional</option>
              {empleadas.map((e) => (
                <option key={e.id} value={e.id}>{e.nombre}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">
            Abono: ${Number(c.abono).toLocaleString('es-CO')}{c.abono_metodo_pago ? ` (${c.abono_metodo_pago})` : ''}
            {c.abono_foto_url && (
              <button onClick={() => verComprobante(c.abono_foto_url!)} className="ml-2 text-xs text-brand-600 underline">
                Ver comprobante
              </button>
            )}
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <a href={linkWhatsApp(c, nombreServicios(c), salon?.nombre)} target="_blank" rel="noopener noreferrer" className="text-xs text-green-700 underline">WhatsApp</a>
            {c.estado === 'pendiente' && (
              <button onClick={() => abrirConfirmar(c)} className="text-xs text-blue-700 underline">Confirmar</button>
            )}
            {c.estado === 'confirmada' && (
              <button onClick={() => abrirConfirmar(c)} className="text-xs text-blue-700 underline">Reprogramar</button>
            )}
            {c.reprogramada && (
              <button onClick={() => marcarVisto(c)} className="text-xs text-purple-700 underline">Marcar como visto</button>
            )}
            {c.estado !== 'completada' && c.estado !== 'cancelada' && (
              <button onClick={() => cambiarEstado(c, 'completada')} className="text-xs text-green-700 underline">Completar</button>
            )}
            {c.estado !== 'cancelada' && c.estado !== 'completada' && (
              <button onClick={() => cambiarEstado(c, 'cancelada')} className="text-xs text-red-600 underline">Cancelar</button>
            )}
          </div>
        </div>
      </li>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Citas</h1>

      <form onSubmit={crearCita} className="bg-white rounded-2xl shadow p-4 space-y-3">
        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
        <h2 className="font-semibold text-sm text-gray-600">Agendar nueva cita</h2>

        <div>
          <label className="block text-sm font-medium mb-1">Profesional (opcional)</label>
          <select value={empleadaId} onChange={(e) => setEmpleadaId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
            <option value="">Sin asignar (se asigna después)</option>
            {empleadas.map((e) => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Servicios</label>
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
                    <option key={s.id} value={s.id} disabled={serviciosIds.includes(s.id)}>{s.nombre}</option>
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Fecha</label>
            <input type="date" required value={fechaCita} onChange={(e) => setFechaCita(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Hora inicio</label>
            <input type="time" required min={HORA_APERTURA} max={HORA_CIERRE} value={hora} onChange={(e) => setHora(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Hora término</label>
            <input type="time" required value={horaFin} onChange={(e) => setHoraFin(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>
        <p className="text-xs text-gray-400 -mt-2">Horario de inicio de atención: {HORA_APERTURA} a {HORA_CIERRE} (el servicio puede terminar después si se extiende).</p>

        <div className="relative">
          <label className="block text-sm font-medium mb-1">Buscar clienta (nombre o cédula)</label>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Escribe el nombre o la cédula…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
          {resultados.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow max-h-56 overflow-y-auto">
              {resultados.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => seleccionarCliente(r)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50 border-b border-gray-50 last:border-0"
                >
                  {r.nombre} <span className="text-gray-400">· {r.cedula ?? 'sin cédula'}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Clienta {clienteId && <span className="text-green-600 text-xs">(registrada)</span>}</label>
            <input required value={clienteNombre} onChange={(e) => { setClienteNombre(e.target.value); setClienteId(null); setCreditosDisponibles([]) }} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Cédula</label>
            <input inputMode="numeric" value={cedula} onChange={(e) => { setCedula(e.target.value); setClienteId(null); setCreditosDisponibles([]) }} placeholder="Documento" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Teléfono (para WhatsApp)</label>
            <input value={clienteTelefono} onChange={(e) => setClienteTelefono(e.target.value)} placeholder="3001234567" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div className="flex items-end">
            {!clienteId && cedula.trim() && clienteNombre.trim() && (
              <button type="button" onClick={crearClientePorCedula} disabled={buscando} className="w-full border border-brand-300 text-brand-700 rounded-lg py-2 text-sm font-medium disabled:opacity-40">
                {buscando ? 'Creando…' : 'Crear clienta con esta cédula'}
              </button>
            )}
          </div>
        </div>
        {infoCedula && (
          <p className={`text-xs -mt-1 ${infoCedula.startsWith('✓') ? 'text-green-700' : 'text-amber-700'}`}>{infoCedula}</p>
        )}

        {creditosDisponibles.length > 0 && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-2 text-xs text-purple-800">
            💳 {clienteNombre} tiene ${creditosDisponibles.reduce((s, c) => s + Number(c.monto), 0).toLocaleString('es-CO')} de saldo a favor de una cita anterior — considera descontarlo del abono que le pidas.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Abono</label>
            <input type="text" inputMode="numeric" value={formatearPesosInput(abono)} onChange={(e) => setAbono(soloDigitos(e.target.value))} placeholder="Ej: 20.000" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Medio de pago del abono</label>
            <select
              value={abonoMetodo}
              onChange={(e) => setAbonoMetodo(e.target.value)}
              disabled={!(Number(abono || 0) > 0)}
              required={Number(abono || 0) > 0}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-400"
            >
              <option value="">{Number(abono || 0) > 0 ? 'Selecciona…' : '(sin abono)'}</option>
              {METODOS_PAGO.map((m) => (
                <option key={m.valor} value={m.valor}>{m.etiqueta}</option>
              ))}
            </select>
          </div>
        </div>

        {Number(abono || 0) > 0 && (
          <div>
            <label className="block text-sm font-medium mb-1">Foto del comprobante del abono</label>
            <input
              type="file" accept="image/*" required
              onChange={(e) => setAbonoFoto(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Obsequio (opcional, según disponibilidad)</label>
          <select value={obsequio} onChange={(e) => setObsequio(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
            <option value="">Sin obsequio</option>
            {obsequios.map((o) => <option key={o.id} value={o.nombre}>{o.nombre}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">📌 Nota interna para la profesional (opcional)</label>
          <textarea
            value={notaInterna}
            onChange={(e) => setNotaInterna(e.target.value)}
            placeholder="Recomendaciones, preferencias del cliente, indicaciones especiales…"
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
          />
          <p className="text-xs text-gray-400 mt-0.5">Solo la ven las profesionales del salón, no la clienta.</p>
        </div>

        <button type="submit" disabled={guardando} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition">
          {guardando ? 'Agendando…' : 'Agendar cita'}
        </button>
      </form>

      {ultimaCreada && (
        <div className="bg-brand-50 border border-brand-200 rounded-2xl p-4 space-y-3">
          <p className="text-sm text-brand-700 font-medium">Cita agendada. Envíala por WhatsApp:</p>
          <pre className="text-xs bg-white rounded-lg p-3 whitespace-pre-wrap border border-brand-100">{mensajeCita(ultimaCreada, nombreServicios(ultimaCreada), salon?.nombre)}</pre>
          <div className="flex gap-2">
            <a
              href={linkWhatsApp(ultimaCreada, nombreServicios(ultimaCreada), salon?.nombre)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-center bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg py-2 transition"
            >
              Enviar por WhatsApp
            </a>
            <button
              onClick={() => copiarMensaje(ultimaCreada)}
              className="flex-1 text-center bg-white border border-gray-300 text-sm font-medium rounded-lg py-2 transition"
            >
              Copiar mensaje
            </button>
          </div>
          {creditosDisponibles.length > 0 && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-800 space-y-2">
              <p>
                💳 Esta clienta tenía ${creditosDisponibles.reduce((s, c) => s + Number(c.monto), 0).toLocaleString('es-CO')} de saldo a favor.
                Si ya lo descontaste del abono de esta cita, márcalo como usado:
              </p>
              <button
                type="button"
                onClick={() => marcarCreditosUsados(ultimaCreada)}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-lg py-2"
              >
                Marcar crédito como usado en esta cita
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm text-gray-600">Agenda</h2>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
      </div>

      {ORDEN_ESTADOS.map((est) => {
        const grupo = citas.filter((c) => c.estado === est)
        if (grupo.length === 0) return null
        return (
          <div key={est} className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{ETIQUETA_ESTADO[est]} ({grupo.length})</h3>
            <ul className="space-y-3">
              {grupo.map((c) => renderCita(c))}
            </ul>
          </div>
        )
      })}
      {citas.length === 0 && <p className="text-sm text-gray-400">No hay citas agendadas este día.</p>}

      {confirmando && (
        <div className="fixed inset-0 bg-black/40 z-30 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-4 space-y-3 max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-sm text-gray-700">
              {confirmando.estado === 'pendiente' ? 'Confirmar' : 'Reprogramar'} cita de {confirmando.cliente_nombre}
            </h2>
            {modalError && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{modalError}</div>}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Fecha</label>
                <input
                  type="date"
                  value={modalFecha}
                  onChange={(e) => setModalFecha(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Hora inicio</label>
                <input
                  type="time"
                  min={HORA_APERTURA}
                  max={HORA_CIERRE}
                  value={modalHora}
                  onChange={(e) => setModalHora(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Hora término</label>
              <input
                type="time"
                value={modalHoraFin}
                onChange={(e) => setModalHoraFin(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
              <p className="text-[11px] text-gray-400 mt-1">Ajústala si se va a demorar más o menos de lo previsto.</p>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Obsequio (según disponibilidad)</label>
              <select value={modalObsequio} onChange={(e) => setModalObsequio(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                <option value="">Sin obsequio</option>
                {obsequios.map((o) => <option key={o.id} value={o.nombre}>{o.nombre}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">📌 Nota interna para la profesional</label>
              <textarea
                value={modalNotaInterna}
                onChange={(e) => setModalNotaInterna(e.target.value)}
                placeholder="Recomendaciones, indicaciones especiales…"
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Mensaje que se enviará (revísalo antes de guardar)</label>
              <pre className="text-xs bg-gray-50 rounded-lg p-3 whitespace-pre-wrap border border-gray-200 max-h-48 overflow-y-auto">
                {mensajeCita(
                  { ...confirmando, fecha: modalFecha, hora: modalHora, obsequio: modalObsequio || null },
                  nombreServicios(confirmando),
                  salon?.nombre
                )}
              </pre>
            </div>

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setConfirmando(null)} className="flex-1 text-sm border border-gray-300 rounded-lg py-2">
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarCita}
                disabled={confirmandoGuardando}
                className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg py-2"
              >
                {confirmandoGuardando
                  ? 'Guardando…'
                  : confirmando.estado === 'pendiente'
                    ? 'Confirmar y abrir WhatsApp'
                    : 'Guardar cambio y abrir WhatsApp'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
