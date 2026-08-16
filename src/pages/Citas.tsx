import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { linkWhatsApp, mensajeCita, MENSAJE_IMPORTANTE_POR_DEFECTO, type OpcionesMensajeCita } from '../lib/whatsapp'
import { fechaHoy as hoy } from '../lib/fechas'
import { crearClienta } from '../lib/crearClienta'
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

interface ClienteLite { id: string; nombre: string; telefono: string | null }

// Agrega/quita un valor de una lista de selección múltiple (checkboxes de obsequios).
function alternarEnLista(lista: string[], valor: string): string[] {
  return lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor]
}

export default function Citas() {
  const { profile, salon } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [fecha, setFecha] = useState(hoy())
  const [vistaAgenda, setVistaAgenda] = useState<'estado' | 'profesional'>('estado')
  const [citas, setCitas] = useState<Cita[]>([])
  const [servicios, setServicios] = useState<Servicio[]>([])
  const [empleadas, setEmpleadas] = useState<Profile[]>([])
  const [catalogoObsequios, setCatalogoObsequios] = useState<Obsequio[]>([])

  const [empleadaId, setEmpleadaId] = useState('')
  const [serviciosIds, setServiciosIds] = useState<string[]>([])
  const [servicioTemp, setServicioTemp] = useState('')
  // Cuando se elige el servicio "Adicional" (monto y concepto libre), se
  // piden estos dos datos: qué es (ej. "Mariposa") y cuánto vale (ej. 15.000).
  const [adicionalConcepto, setAdicionalConcepto] = useState('')
  const [adicionalValor, setAdicionalValor] = useState('')
  const [clienteId, setClienteId] = useState<string | null>(null)
  // Saldo a favor sin usar de la clienta seleccionada (ver Cuentas por cobrar).
  const [creditosDisponibles, setCreditosDisponibles] = useState<CreditoCliente[]>([])
  const [infoCliente, setInfoCliente] = useState<string | null>(null)
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
  const [obsequiosElegidos, setObsequiosElegidos] = useState<string[]>([])
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
  const [modalObsequios, setModalObsequios] = useState<string[]>([])
  const [modalNotaInterna, setModalNotaInterna] = useState('')
  const [confirmandoGuardando, setConfirmandoGuardando] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  // Antes se abría WhatsApp SIEMPRE al guardar, sin preguntar. Va marcado
  // por defecto para no cambiarle la costumbre a nadie, pero se puede
  // desmarcar (la clienta está enfrente, ya le avisaron por otro lado…) y el
  // link de WhatsApp de la tarjeta sigue ahí para mandarlo después.
  const [enviarWhatsApp, setEnviarWhatsApp] = useState(true)

  // Bloque "Importante" del mensaje, propio de cada salón. Se guarda por RPC
  // (actualizar_mensaje_importante) porque la policy de update de salones no
  // puede restringir columnas.
  const [mensajeImportante, setMensajeImportante] = useState('')
  const [editandoMensaje, setEditandoMensaje] = useState(false)
  const [guardandoMensaje, setGuardandoMensaje] = useState(false)
  const [mensajeGuardadoOk, setMensajeGuardadoOk] = useState(false)
  useEffect(() => {
    setMensajeImportante(salon?.mensaje_importante ?? '')
  }, [salon?.mensaje_importante])

  // Opciones comunes de todo mensaje de WhatsApp de esta pantalla.
  function opcionesMensaje(cita: Cita, extra: Partial<OpcionesMensajeCita> = {}): OpcionesMensajeCita {
    return {
      servicios: nombreServicios(cita),
      nombreSalon: salon?.nombre,
      mensajeImportante: mensajeImportante || salon?.mensaje_importante,
      ...extra
    }
  }

  async function guardarMensajeImportante() {
    setGuardandoMensaje(true)
    setMensajeGuardadoOk(false)
    const { error } = await supabase.rpc('actualizar_mensaje_importante', { p_texto: mensajeImportante })
    setGuardandoMensaje(false)
    if (error) {
      setError('No se pudo guardar el mensaje: ' + error.message)
      return
    }
    setMensajeGuardadoOk(true)
    setEditandoMensaje(false)
  }

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
      .then(({ data }) => setCatalogoObsequios((data as Obsequio[]) ?? []))
  }, [])

  // Agenda agrupada por profesional (Cambio 1): en vez de por estado, para
  // ver de un vistazo qué turnos tiene libre/ocupados cada una. Los grupos
  // siguen el mismo orden que la lista de empleadas; "Sin asignar" al final.
  const citasPorProfesional = useMemo(() => {
    const grupos = new Map<string, Cita[]>()
    for (const c of citas) {
      const clave = c.empleada_id ?? 'sin-asignar'
      grupos.set(clave, [...(grupos.get(clave) ?? []), c])
    }
    for (const lista of grupos.values()) lista.sort((a, b) => a.hora.localeCompare(b.hora))
    const ordenadas: { id: string; nombre: string; citas: Cita[] }[] = []
    for (const e of empleadas) {
      const lista = grupos.get(e.id)
      if (lista) ordenadas.push({ id: e.id, nombre: e.nombre, citas: lista })
    }
    const sinAsignar = grupos.get('sin-asignar')
    if (sinAsignar) ordenadas.push({ id: 'sin-asignar', nombre: 'Sin asignar', citas: sinAsignar })
    return ordenadas
  }, [citas, empleadas])

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

  // Búsqueda en vivo de clientas por nombre o teléfono.
  useEffect(() => {
    const q = busqueda.trim()
    if (q.length < 2) { setResultados([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, nombre, telefono')
        .eq('rol', 'cliente')
        .or(`nombre.ilike.%${q}%,telefono.ilike.%${q}%`)
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
    setInfoCliente(`✓ Clienta seleccionada: ${r.nombre}`)
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
    // Acá sí bloquea (a diferencia de asignar/reprogramar, que solo avisan):
    // la cita todavía no existe, así que cambiar la hora antes de guardar no
    // cuesta nada.
    if (empleadaId) {
      const cruces = await citasCruzadas(empleadaId, fechaCita, hora, horaFin || null)
      if (cruces.length > 0) {
        const nombre = empleadas.find((e) => e.id === empleadaId)?.nombre ?? 'Esa profesional'
        setError(`${textoCruce(nombre, cruces)} Elige otra hora u otra profesional (o déjala sin asignar).`)
        return
      }
    }

    setGuardando(true)

    // Clienta nueva (nombre + teléfono, sin cuenta ya enlazada): se crea su
    // cuenta en el mismo paso, sin pedir cédula ni un botón aparte -- el
    // teléfono queda como su usuario y contraseña. Sin teléfono no hay con
    // qué loguearla, así que en ese caso solo queda como texto libre en la
    // cita (igual que antes).
    let clienteIdParaCita = clienteId
    if (!clienteIdParaCita && clienteTelefono.trim() && profile.salon_id) {
      const { id, error: errCliente } = await crearClienta({
        salonId: profile.salon_id,
        nombre: clienteNombre,
        telefono: clienteTelefono,
        preservarSesion: true
      })
      if (errCliente) {
        setGuardando(false)
        setError(`No se pudo crear la cuenta de la clienta: ${errCliente} Puedes buscarla arriba si ya tiene cuenta, o agendar sin cuenta quitando el teléfono.`)
        return
      }
      clienteIdParaCita = id
    }

    // Si hay abono, subir la foto del comprobante antes de crear la cita.
    let abonoFotoPath: string | null = null
    if (montoAbono > 0 && abonoFoto) {
      const comprimida = await comprimirImagen(abonoFoto)
      const path = `${profile.salon_id}/abonos/${clienteIdParaCita ?? profile.id}/${Date.now()}_${comprimida.name}`
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
        cliente_id: clienteIdParaCita,
        cliente_nombre: clienteNombre,
        cliente_telefono: clienteTelefono || null,
        fecha: fechaCita,
        hora,
        hora_fin: horaFin,
        abono: montoAbono,
        abono_metodo_pago: montoAbono > 0 && abonoMetodo ? abonoMetodo : null,
        abono_foto_url: abonoFotoPath,
        obsequios: obsequiosElegidos,
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
    setClienteId(null)
    setInfoCliente(null)
    setBusqueda('')
    setResultados([])
    setClienteNombre('')
    setClienteTelefono('')
    setHora('')
    setHoraFin('')
    setAbono('')
    setAbonoMetodo('')
    setAbonoFoto(null)
    setObsequiosElegidos([])
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
    setModalObsequios(cita.obsequios ?? [])
    setModalNotaInterna(cita.nota_interna ?? '')
    setModalError(null)
    setEnviarWhatsApp(true)
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

    // El otro hueco: al mover la fecha/hora de una cita YA asignada, nadie
    // revisaba si la profesional quedaba encima de otra cita suya.
    if (confirmando.empleada_id) {
      const cruces = await citasCruzadas(
        confirmando.empleada_id, modalFecha, modalHora, modalHoraFin || null, confirmando.id
      )
      if (cruces.length > 0) {
        const nombre = confirmando.empleada?.nombre ?? 'La profesional asignada'
        if (!confirm(`${textoCruce(nombre, cruces)}\n\n¿Guardar de todas formas?`)) return
      }
    }

    setConfirmandoGuardando(true)
    setModalError(null)
    const { data, error } = await supabase
      .from('citas')
      .update({
        ...(esReprogramacion ? {} : { estado: 'confirmada' }),
        fecha: modalFecha,
        hora: modalHora,
        hora_fin: modalHoraFin || null,
        obsequios: modalObsequios,
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
    if (enviarWhatsApp) {
      window.open(
        linkWhatsApp(citaActualizada, opcionesMensaje(citaActualizada, {
          tipo: esReprogramacion ? 'reprogramada' : 'confirmada',
          citaAnterior: { fecha: confirmando.fecha, hora: confirmando.hora }
        })),
        '_blank'
      )
    }
    setConfirmando(null)
    cargarCitas()
  }

  // Las horas vienen 'HH:MM' del formulario y 'HH:MM:SS' de la base; sin
  // igualarlas, comparar '14:00' con '14:00:00' da resultados raros en los
  // bordes (una cadena más corta ordena antes que su propio prefijo largo).
  function hhmmss(t: string) {
    return t.length === 5 ? `${t}:00` : t
  }

  // Citas de esa profesional que se cruzan con ese horario, sin contar la
  // cita que se está editando. No se usa la RPC profesionales_disponibles
  // porque al reprogramar la cita se cruzaría consigo misma, y porque acá
  // hace falta saber CON QUIÉN se cruza para poder decirlo.
  async function citasCruzadas(empleadaId: string, fecha: string, desde: string, hasta: string | null, excluirId?: string) {
    let q = supabase
      .from('citas')
      .select('id, cliente_nombre, hora, hora_fin')
      .eq('empleada_id', empleadaId)
      .eq('fecha', fecha)
      .neq('estado', 'cancelada')
    if (excluirId) q = q.neq('id', excluirId)
    const { data } = await q
    const ini = hhmmss(desde)
    const fin = hhmmss(hasta || desde)
    return ((data as { id: string; cliente_nombre: string; hora: string; hora_fin: string | null }[]) ?? [])
      .filter((c) => hhmmss(c.hora) < fin && hhmmss(c.hora_fin ?? c.hora) > ini)
  }

  function textoCruce(nombreProfesional: string, cruces: { cliente_nombre: string; hora: string; hora_fin: string | null }[]) {
    const detalle = cruces
      .map((c) => `${c.cliente_nombre || 'sin nombre'} de ${c.hora.slice(0, 5)}${c.hora_fin ? ` a ${c.hora_fin.slice(0, 5)}` : ''}`)
      .join(', ')
    return `${nombreProfesional} ya tiene ${detalle} a esa hora.`
  }

  // "Ya que estoy, hazme también las cejas": la clienta pide un servicio más
  // días después de agendar. Antes el trigger congelaba servicios_ids al
  // confirmar y tocaba cancelar y volver a agendar, perdiendo el abono ya
  // registrado. El servicio nuevo se cobra al final, en Cuentas por cobrar;
  // el abono no se toca.
  const [agregandoServicioA, setAgregandoServicioA] = useState<string | null>(null)
  const [servicioAAgregar, setServicioAAgregar] = useState('')
  const [agregandoServicio, setAgregandoServicio] = useState(false)

  async function agregarServicioACita(cita: Cita) {
    if (!servicioAAgregar) return
    setAgregandoServicio(true)
    const actuales = cita.servicios_ids?.length > 0 ? cita.servicios_ids : [cita.servicio_id]
    const { error } = await supabase
      .from('citas')
      .update({ servicios_ids: [...actuales, servicioAAgregar] })
      .eq('id', cita.id)
    setAgregandoServicio(false)
    if (error) {
      setError('No se pudo agregar el servicio: ' + error.message)
      return
    }
    setAgregandoServicioA(null)
    setServicioAAgregar('')
    cargarCitas()
  }

  async function marcarVisto(cita: Cita) {
    await supabase.from('citas').update({ reprogramada: false }).eq('id', cita.id)
    cargarCitas()
  }

  // Este era el hueco por el que se colaban las citas cruzadas: el chequeo
  // solo existía al crear la cita CON profesional. Si se agendaba sin
  // asignar (lo normal) y se asignaba después desde este desplegable, no se
  // revisaba nada -- así terminaron dos clientas a la misma hora con la
  // misma profesional. Avisa y deja seguir solo si se confirma, porque a
  // veces cruzar es a propósito (dos servicios que se alternan).
  async function asignarManicurista(cita: Cita, empId: string) {
    if (!empId || empId === cita.empleada_id) return
    const cruces = await citasCruzadas(empId, cita.fecha, cita.hora, cita.hora_fin, cita.id)
    if (cruces.length > 0) {
      const nombre = empleadas.find((e) => e.id === empId)?.nombre ?? 'Esa profesional'
      if (!confirm(`${textoCruce(nombre, cruces)}\n\n¿Asignarla de todas formas?`)) {
        cargarCitas()
        return
      }
    }
    await supabase.from('citas').update({ empleada_id: empId }).eq('id', cita.id)
    cargarCitas()
  }

  async function copiarMensaje(cita: Cita) {
    await navigator.clipboard.writeText(mensajeCita(cita, opcionesMensaje(cita)))
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
            {c.obsequios.length > 0 && <p className="text-xs text-brand-600">{c.obsequios.length > 1 ? 'Obsequios' : 'Obsequio'}: {c.obsequios.join(', ')}</p>}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`text-xs px-2 py-1 rounded-full ${ESTADO_ESTILOS[c.estado]}`}>{c.estado}</span>
            {c.reprogramada && (
              <span className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700">Reprogramada</span>
            )}
          </div>
        </div>

        {c.estado !== 'completada' && c.estado !== 'cancelada' && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
            <label className="block text-xs font-medium text-amber-800 mb-1">
              {c.empleada_id ? 'Cambiar profesional' : 'Asignar profesional'}
            </label>
            <select
              value={c.empleada_id ?? ''}
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
            <a href={linkWhatsApp(c, opcionesMensaje(c, { tipo: c.estado === 'pendiente' ? 'agendada' : 'confirmada' }))} target="_blank" rel="noopener noreferrer" className="text-xs text-green-700 underline">WhatsApp</a>
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
              <button
                onClick={() => { setAgregandoServicioA(agregandoServicioA === c.id ? null : c.id); setServicioAAgregar('') }}
                className="text-xs text-brand-700 underline"
              >
                + Agregar servicio
              </button>
            )}
            {c.estado !== 'cancelada' && c.estado !== 'completada' && (
              <button onClick={() => cambiarEstado(c, 'cancelada')} className="text-xs text-red-600 underline">Cancelar</button>
            )}
          </div>
        </div>

        {agregandoServicioA === c.id && (
          <div className="bg-brand-50 border border-brand-200 rounded-lg p-2 space-y-2">
            <p className="text-xs text-brand-800">
              Se suma a lo que ya tiene agendado. Se cobra al final, en «Cuentas por cobrar» — el abono ya pagado no se toca.
            </p>
            <div className="flex gap-2">
              <select
                value={servicioAAgregar}
                onChange={(e) => setServicioAAgregar(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">Selecciona un servicio</option>
                {porCategoria.map(([categoria, lista]) => (
                  <optgroup key={categoria} label={categoria}>
                    {lista.map((s) => (
                      <option key={s.id} value={s.id} disabled={(c.servicios_ids ?? []).includes(s.id)}>{s.nombre}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                onClick={() => agregarServicioACita(c)}
                disabled={!servicioAAgregar || agregandoServicio}
                className="px-3 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-medium"
              >
                {agregandoServicio ? '…' : 'Agregar'}
              </button>
            </div>
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Citas</h1>

      {/* El bloque "Importante" del WhatsApp lo edita la dueña de cada salón:
          antes estaba escrito fijo en el código y todos los salones mandaban
          la misma política (sin niños, sin bicicletas) fuera o no la suya. */}
      {profile?.rol === 'superadmin' && (
        <div className="bg-white rounded-2xl shadow p-4">
          <button
            type="button"
            onClick={() => setEditandoMensaje((v) => !v)}
            className="w-full flex items-center justify-between text-sm font-semibold text-gray-600"
          >
            <span>Mensaje de WhatsApp del salón</span>
            <span className="text-xs text-gray-400">{editandoMensaje ? 'Ocultar ▴' : 'Editar ▾'}</span>
          </button>
          {editandoMensaje && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-gray-500">
                Es el bloque <b>«Importante»</b> que va al final de cada mensaje de cita (agendada, confirmada o
                reprogramada). Lo demás — servicio, fecha, hora, abono y el nombre del salón — se arma solo.
              </p>
              <textarea
                value={mensajeImportante}
                onChange={(e) => { setMensajeImportante(e.target.value); setMensajeGuardadoOk(false) }}
                rows={6}
                maxLength={2000}
                placeholder={MENSAJE_IMPORTANTE_POR_DEFECTO}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs"
              />
              <p className="text-xs text-gray-400">
                Si lo dejas vacío se usa el texto por defecto (el del recuadro gris de arriba). Los *asteriscos* se ven
                como negrita en WhatsApp.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={guardarMensajeImportante}
                  disabled={guardandoMensaje}
                  className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-4 py-2"
                >
                  {guardandoMensaje ? 'Guardando…' : 'Guardar mensaje'}
                </button>
                {mensajeImportante.trim() !== '' && (
                  <button
                    type="button"
                    onClick={() => { setMensajeImportante(''); setMensajeGuardadoOk(false) }}
                    className="text-xs text-gray-500 underline"
                  >
                    Volver al texto por defecto
                  </button>
                )}
              </div>
            </div>
          )}
          {mensajeGuardadoOk && (
            <p className="text-xs text-green-700 mt-2">Mensaje guardado ✓ — se usa desde el próximo WhatsApp que envíes.</p>
          )}
        </div>
      )}

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
          <label className="block text-sm font-medium mb-1">Buscar clienta (nombre o teléfono)</label>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Escribe el nombre o el teléfono…"
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
                  {r.nombre} <span className="text-gray-400">· {r.telefono ?? 'sin teléfono'}</span>
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
            <label className="block text-sm font-medium mb-1">Teléfono (WhatsApp)</label>
            <input value={clienteTelefono} onChange={(e) => { setClienteTelefono(e.target.value); if (!clienteId) setInfoCliente(null) }} placeholder="3001234567" className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>
        {!clienteId && clienteNombre.trim() && (
          <p className="text-xs text-gray-400 -mt-1">
            {clienteTelefono.trim()
              ? 'Como no la encontraste arriba, se le crea la cuenta sola al agendar (usuario y contraseña = su teléfono).'
              : 'Sin teléfono no se le puede crear cuenta -- queda solo agendada, sin poder loguearse a ver su cita.'}
          </p>
        )}
        {infoCliente && (
          <p className="text-xs -mt-1 text-green-700">{infoCliente}</p>
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
          <label className="block text-sm font-medium mb-1">Obsequios (opcional, según disponibilidad)</label>
          {catalogoObsequios.length === 0 ? (
            <p className="text-xs text-gray-400">No hay obsequios activos en el catálogo (Servicios → Obsequios).</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {catalogoObsequios.map((o) => {
                const activo = obsequiosElegidos.includes(o.nombre)
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setObsequiosElegidos((prev) => alternarEnLista(prev, o.nombre))}
                    className={`text-xs px-2 py-1 rounded-full border ${activo ? 'bg-brand-100 border-brand-300 text-brand-700' : 'bg-white border-gray-200 text-gray-400'}`}
                  >
                    {activo ? '✓ ' : ''}{o.nombre}
                  </button>
                )
              })}
            </div>
          )}
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
          <pre className="text-xs bg-white rounded-lg p-3 whitespace-pre-wrap border border-brand-100">{mensajeCita(ultimaCreada, opcionesMensaje(ultimaCreada))}</pre>
          <div className="flex gap-2">
            <a
              href={linkWhatsApp(ultimaCreada, opcionesMensaje(ultimaCreada))}
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

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 max-w-xs">
        <button
          type="button"
          onClick={() => setVistaAgenda('estado')}
          className={`flex-1 text-xs font-medium rounded-lg py-1.5 transition ${vistaAgenda === 'estado' ? 'bg-white shadow text-brand-700' : 'text-gray-500'}`}
        >
          Por estado
        </button>
        <button
          type="button"
          onClick={() => setVistaAgenda('profesional')}
          className={`flex-1 text-xs font-medium rounded-lg py-1.5 transition ${vistaAgenda === 'profesional' ? 'bg-white shadow text-brand-700' : 'text-gray-500'}`}
        >
          Por profesional
        </button>
      </div>

      {vistaAgenda === 'estado' ? (
        ORDEN_ESTADOS.map((est) => {
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
        })
      ) : (
        citasPorProfesional.map((grupo) => (
          <div key={grupo.id} className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{grupo.nombre} ({grupo.citas.length})</h3>
            <ul className="space-y-3">
              {grupo.citas.map((c) => renderCita(c))}
            </ul>
          </div>
        ))
      )}
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
              <label className="block text-xs font-medium mb-1">Obsequios (según disponibilidad)</label>
              {catalogoObsequios.length === 0 ? (
                <p className="text-xs text-gray-400">No hay obsequios activos en el catálogo.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {catalogoObsequios.map((o) => {
                    const activo = modalObsequios.includes(o.nombre)
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setModalObsequios((prev) => alternarEnLista(prev, o.nombre))}
                        className={`text-xs px-2 py-1 rounded-full border ${activo ? 'bg-brand-100 border-brand-300 text-brand-700' : 'bg-white border-gray-200 text-gray-400'}`}
                      >
                        {activo ? '✓ ' : ''}{o.nombre}
                      </button>
                    )
                  })}
                </div>
              )}
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

            <label className="flex items-start gap-2 text-xs bg-green-50 border border-green-200 rounded-lg p-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enviarWhatsApp}
                onChange={(e) => setEnviarWhatsApp(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <b className="text-green-800">Enviar por WhatsApp al guardar</b>
                <span className="block text-gray-500">
                  Si lo desmarcas solo se guarda el cambio. Puedes mandarlo después con el link «WhatsApp» de la cita.
                </span>
              </span>
            </label>

            {enviarWhatsApp && (
              <div>
                <label className="block text-xs font-medium mb-1">Mensaje que se enviará (revísalo antes de guardar)</label>
                <pre className="text-xs bg-gray-50 rounded-lg p-3 whitespace-pre-wrap border border-gray-200 max-h-48 overflow-y-auto">
                  {mensajeCita(
                    { ...confirmando, fecha: modalFecha, hora: modalHora, obsequios: modalObsequios },
                    opcionesMensaje(confirmando, {
                      tipo: confirmando.estado === 'pendiente' ? 'confirmada' : 'reprogramada',
                      citaAnterior: { fecha: confirmando.fecha, hora: confirmando.hora }
                    })
                  )}
                </pre>
              </div>
            )}

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
                    ? (enviarWhatsApp ? 'Confirmar y abrir WhatsApp' : 'Confirmar')
                    : (enviarWhatsApp ? 'Guardar cambio y abrir WhatsApp' : 'Guardar cambio')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
