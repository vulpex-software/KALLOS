import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy, rangoDiaUTC } from '../lib/fechas'
import { comprimirImagen } from '../lib/comprimirImagen'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import { METODOS_PAGO, type Cita, type Cobro, type Condonacion, type CreditoCliente, type RegistroTrabajo, type ResolucionCredito } from '../types'

// Una "visita" agrupa los servicios registrados juntos para una misma clienta.
interface Visita {
  visitaId: string
  clienteId: string | null
  citaId: string | null
  clienteNombre: string
  empleadaNombre: string
  hora: string
  registros: RegistroTrabajo[]
  total: number
  abono: number
  cobrado: number
  pendiente: number
  // Cuando el abono ya pagado supera el total (ej. cambió a un servicio más
  // barato con el 100% abonado), esta es la diferencia a favor de la clienta.
  saldoFavor: number
  credito: CreditoCliente | null
  cobros: Cobro[]
  // Suma de lo condonado (perdonado, no cobrado) de esta visita.
  condonado: number
  condonaciones: Condonacion[]
}

export default function CuentasPorCobrar() {
  const { profile } = useAuth()
  // Devolver dinero (reembolso) y eliminar saldo pendiente (condonación)
  // son solo de la dueña -- ambas mueven o dejan de mover caja de verdad.
  const esSuperadmin = profile?.rol === 'superadmin'
  const [fecha, setFecha] = useState(fechaHoy())
  const [visitas, setVisitas] = useState<Visita[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  // Formulario de cobro abierto (por visita). Permite varios medios de pago
  // en un solo cobro (ej. mitad efectivo, mitad Nequi): cada uno se agrega
  // como una línea y se registran todas juntas al final.
  const [cobrandoId, setCobrandoId] = useState<string | null>(null)
  const [lineasCobro, setLineasCobro] = useState<{ key: string; metodo: string; monto: number; foto: File | null }[]>([])
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [notaCobro, setNotaCobro] = useState('')
  const [guardando, setGuardando] = useState(false)

  // Formulario para resolver un saldo a favor (abono > total). Se elige entre
  // dejarlo como crédito para la próxima cita, o devolverlo (sale de caja).
  const [resolviendoId, setResolviendoId] = useState<string | null>(null)
  const [resolucionTipo, setResolucionTipo] = useState<'' | ResolucionCredito>('')
  const [metodoReembolso, setMetodoReembolso] = useState('')
  const [notaResolucion, setNotaResolucion] = useState('')
  const [guardandoResolucion, setGuardandoResolucion] = useState(false)

  // Formulario para eliminar (condonar) un saldo pendiente -- solo superadmin.
  const [condonandoId, setCondonandoId] = useState<string | null>(null)
  const [montoCondonar, setMontoCondonar] = useState('')
  const [motivoCondonar, setMotivoCondonar] = useState('')
  const [guardandoCondonacion, setGuardandoCondonacion] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { desde, hasta } = rangoDiaUTC(fecha)
    const { data: regs } = await supabase
      .from('registros_trabajo')
      .select('*, servicio:servicios(*), empleada:profiles!registros_trabajo_empleada_id_fkey(*)')
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .eq('anulado', false)
      .order('created_at')
    const registros = (regs as RegistroTrabajo[]) ?? []

    // Agrupar por visita (los registros viejos sin visita_id cuentan como visita propia)
    const grupos = new Map<string, RegistroTrabajo[]>()
    for (const r of registros) {
      const clave = r.visita_id ?? r.id
      const lista = grupos.get(clave) ?? []
      lista.push(r)
      grupos.set(clave, lista)
    }

    const visitaIds = [...grupos.keys()]
    const citaIds = [...new Set(registros.map((r) => r.cita_id).filter(Boolean))] as string[]

    const [{ data: cobrosData }, { data: citasData }, { data: creditosData }, { data: condonacionesData }] = await Promise.all([
      visitaIds.length > 0
        ? supabase.from('cobros').select('*').in('visita_id', visitaIds)
        : Promise.resolve({ data: [] as Cobro[] }),
      citaIds.length > 0
        ? supabase.from('citas').select('*').in('id', citaIds)
        : Promise.resolve({ data: [] as Cita[] }),
      visitaIds.length > 0
        ? supabase.from('creditos_clientes').select('*').in('visita_id', visitaIds)
        : Promise.resolve({ data: [] as CreditoCliente[] }),
      visitaIds.length > 0
        ? supabase.from('condonaciones').select('*').in('visita_id', visitaIds)
        : Promise.resolve({ data: [] as Condonacion[] })
    ])
    const cobros = (cobrosData as Cobro[]) ?? []
    const citas = (citasData as Cita[]) ?? []
    const creditos = (creditosData as CreditoCliente[]) ?? []
    const condonaciones = (condonacionesData as Condonacion[]) ?? []

    const lista: Visita[] = [...grupos.entries()].map(([visitaId, regsVisita]) => {
      const total = regsVisita.reduce((s, r) => s + Number(r.precio_cobrado), 0)
      const cita = citas.find((c) => c.id === regsVisita[0].cita_id)
      const abono = cita ? Number(cita.abono) : 0
      const cobrosVisita = cobros.filter((c) => c.visita_id === visitaId)
      const cobrado = cobrosVisita.reduce((s, c) => s + Number(c.monto), 0)
      const condonacionesVisita = condonaciones.filter((c) => c.visita_id === visitaId)
      const condonado = condonacionesVisita.reduce((s, c) => s + Number(c.monto), 0)
      return {
        visitaId,
        clienteId: cita?.cliente_id ?? null,
        citaId: cita?.id ?? null,
        clienteNombre: regsVisita[0].cliente_nombre || 'Sin nombre',
        empleadaNombre: regsVisita[0].empleada?.nombre ?? '',
        hora: new Date(regsVisita[0].created_at).toLocaleTimeString('es-CO', {
          hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Bogota'
        }),
        registros: regsVisita,
        total,
        abono,
        cobrado,
        pendiente: Math.max(0, total - abono - cobrado - condonado),
        saldoFavor: Math.max(0, abono - total),
        credito: creditos.find((cr) => cr.visita_id === visitaId) ?? null,
        cobros: cobrosVisita,
        condonado,
        condonaciones: condonacionesVisita
      }
    })
    setVisitas(lista)
    setCargando(false)
  }, [fecha])

  useEffect(() => {
    cargar()
  }, [cargar])

  function abrirCobro(v: Visita) {
    setCobrandoId(v.visitaId)
    setLineasCobro([])
    setMonto(String(v.pendiente))
    setMetodo('')
    setFoto(null)
    setNotaCobro('')
    setError(null)
    setMensaje(null)
  }

  // Agrega el medio de pago actual a la lista, para poder sumar otro más
  // (ej. mitad efectivo, mitad Nequi) antes de registrar el cobro completo.
  function agregarLineaCobro() {
    const valor = Number(monto)
    if (!valor || valor <= 0) { setError('Escribe el monto de este pago.'); return }
    if (!metodo) { setError('Elige el medio de pago.'); return }
    if (metodo !== 'efectivo' && !foto) { setError('Sube la foto del comprobante para este medio.'); return }
    setError(null)
    setLineasCobro((prev) => [...prev, { key: crypto.randomUUID(), metodo, monto: valor, foto }])
    setMonto('')
    setMetodo('')
    setFoto(null)
  }

  function quitarLineaCobro(key: string) {
    setLineasCobro((prev) => prev.filter((l) => l.key !== key))
  }

  async function registrarCobro(e: FormEvent, v: Visita) {
    e.preventDefault()
    if (!profile) return
    setError(null)

    // Si dejó un medio escrito sin agregarlo a la lista, lo incluimos igual.
    let lineas = lineasCobro
    const valorSuelto = Number(monto)
    if (valorSuelto > 0 || metodo) {
      if (!valorSuelto || valorSuelto <= 0) { setError('Escribe el monto del pago.'); return }
      if (!metodo) { setError('Elige el medio de pago.'); return }
      if (metodo !== 'efectivo' && !foto) { setError('Sube la foto del comprobante para este medio.'); return }
      lineas = [...lineasCobro, { key: 'actual', metodo, monto: valorSuelto, foto }]
    }
    if (lineas.length === 0) { setError('Agrega al menos un pago.'); return }

    setGuardando(true)
    try {
      const filas = []
      for (const l of lineas) {
        let fotoUrl: string | null = null
        if (l.foto) {
          const comprimida = await comprimirImagen(l.foto)
          const path = `${profile.salon_id}/cobros/${profile.id}/${Date.now()}_${comprimida.name}`
          const { error: upErr } = await supabase.storage.from('evidencias').upload(path, comprimida)
          if (upErr) throw upErr
          fotoUrl = path
        }
        filas.push({
          salon_id: profile.salon_id,
          visita_id: v.visitaId,
          monto: l.monto,
          metodo_pago: l.metodo,
          foto_url: fotoUrl,
          nota: notaCobro || null,
          cobrado_por: profile.id
        })
      }

      const { error: insErr } = await supabase.from('cobros').insert(filas)
      if (insErr) throw insErr

      const totalCobrado = filas.reduce((s, f) => s + f.monto, 0)
      setMensaje(`Cobro de $${totalCobrado.toLocaleString('es-CO')} registrado a ${v.clienteNombre}.`)
      setCobrandoId(null)
      setLineasCobro([])
      cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el cobro.')
    } finally {
      setGuardando(false)
    }
  }

  function abrirResolver(v: Visita) {
    setResolviendoId(v.visitaId)
    setResolucionTipo('')
    setMetodoReembolso('')
    setNotaResolucion('')
    setError(null)
    setMensaje(null)
  }

  async function resolverSaldoFavor(e: FormEvent, v: Visita) {
    e.preventDefault()
    if (!profile || !v.clienteId) return
    if (!resolucionTipo) { setError('Elige cómo resolver el saldo a favor.'); return }
    // Defensa extra en el cliente -- la RLS ya lo bloquea igual, pero así el
    // mensaje es claro en vez de un error genérico de base de datos.
    if (resolucionTipo === 'reembolso' && !esSuperadmin) { setError('Solo la dueña puede devolver dinero de caja.'); return }
    if (resolucionTipo === 'reembolso' && !metodoReembolso) { setError('Elige el medio de pago del reembolso.'); return }
    setError(null)
    setGuardandoResolucion(true)
    const { error: insErr } = await supabase.from('creditos_clientes').insert({
      salon_id: profile.salon_id,
      cliente_id: v.clienteId,
      cita_id: v.citaId,
      visita_id: v.visitaId,
      monto: v.saldoFavor,
      resolucion: resolucionTipo,
      metodo_pago: resolucionTipo === 'reembolso' ? metodoReembolso : null,
      nota: notaResolucion || null,
      creado_por: profile.id
    })
    setGuardandoResolucion(false)
    if (insErr) {
      setError('No se pudo registrar: ' + insErr.message)
      return
    }
    setMensaje(
      resolucionTipo === 'credito'
        ? `Se dejó $${v.saldoFavor.toLocaleString('es-CO')} como saldo a favor de ${v.clienteNombre}.`
        : `Se registró la devolución de $${v.saldoFavor.toLocaleString('es-CO')} a ${v.clienteNombre}.`
    )
    setResolviendoId(null)
    cargar()
  }

  function abrirCondonar(v: Visita) {
    setCondonandoId(v.visitaId)
    setMontoCondonar(String(v.pendiente))
    setMotivoCondonar('')
    setError(null)
    setMensaje(null)
  }

  async function condonarSaldo(e: FormEvent, v: Visita) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    const valor = Number(montoCondonar)
    if (!valor || valor <= 0) { setError('Escribe el monto a eliminar.'); return }
    if (valor > v.pendiente) { setError(`No puede ser mayor al saldo pendiente ($${v.pendiente.toLocaleString('es-CO')}).`); return }
    if (!motivoCondonar.trim()) { setError('Escribe el motivo.'); return }
    if (!profile.salon_id) { setError('No se pudo determinar tu salón. Vuelve a iniciar sesión.'); return }
    setGuardandoCondonacion(true)
    const { error: insErr } = await supabase.from('condonaciones').insert({
      salon_id: profile.salon_id,
      visita_id: v.visitaId,
      monto: valor,
      motivo: motivoCondonar.trim(),
      condonado_por: profile.id
    })
    setGuardandoCondonacion(false)
    if (insErr) {
      setError('No se pudo eliminar el saldo: ' + insErr.message)
      return
    }
    setMensaje(`Se eliminó $${valor.toLocaleString('es-CO')} sin cobrar de la cuenta de ${v.clienteNombre}.`)
    setCondonandoId(null)
    cargar()
  }

  // Abre la foto del pago en una pestaña nueva (URL firmada, 5 min).
  async function verFoto(path: string) {
    const { data } = await supabase.storage.from('evidencias').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const pendientes = visitas.filter((v) => v.pendiente > 0)
  const porResolver = visitas.filter((v) => v.pendiente === 0 && v.saldoFavor > 0 && !v.credito)
  const cobradas = visitas.filter((v) => v.pendiente === 0 && (v.saldoFavor === 0 || v.credito))
  const totalPendiente = pendientes.reduce((s, v) => s + v.pendiente, 0)

  function tarjetaVisita(v: Visita) {
    const conSaldoFavorSinResolver = v.pendiente === 0 && v.saldoFavor > 0 && !v.credito
    return (
      <li key={v.visitaId} className="bg-white rounded-2xl shadow p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{v.clienteNombre}</p>
            <p className="text-xs text-gray-400">{v.hora} · atendió {v.empleadaNombre}</p>
          </div>
          {v.pendiente > 0 ? (
            <span className="shrink-0 text-sm font-semibold text-amber-600">
              Debe ${v.pendiente.toLocaleString('es-CO')}
            </span>
          ) : conSaldoFavorSinResolver ? (
            <span className="shrink-0 text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700">
              Saldo a favor ${v.saldoFavor.toLocaleString('es-CO')}
            </span>
          ) : (
            <span className="shrink-0 text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">Cobrada</span>
          )}
        </div>

        {/* Cuenta detallada, como un recibo: servicios, subtotal, abono/cobros y total */}
        <div className="text-sm border-y border-dashed border-gray-200 py-2 space-y-1">
          {v.registros.map((r) => (
            <div key={r.id} className="flex justify-between text-gray-600">
              <span className="truncate pr-2">{r.servicio?.nombre ?? 'Servicio'}{r.nota ? ` · ${r.nota}` : ''}</span>
              <span className="shrink-0">${Number(r.precio_cobrado).toLocaleString('es-CO')}</span>
            </div>
          ))}
          <div className="flex justify-between text-gray-500 pt-1 border-t border-gray-100">
            <span>Subtotal</span>
            <span>${v.total.toLocaleString('es-CO')}</span>
          </div>
          {v.abono > 0 && (
            <div className="flex justify-between text-gray-500">
              <span>Abono</span>
              <span>-${v.abono.toLocaleString('es-CO')}</span>
            </div>
          )}
          {v.cobrado > 0 && (
            <div className="flex justify-between text-gray-500">
              <span>Cobrado</span>
              <span>-${v.cobrado.toLocaleString('es-CO')}</span>
            </div>
          )}
          {v.condonado > 0 && (
            <div className="flex justify-between text-gray-500">
              <span>Eliminado (no cobrado)</span>
              <span>-${v.condonado.toLocaleString('es-CO')}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline pt-1 border-t border-gray-200">
            <span className="font-semibold text-gray-700">{v.saldoFavor > 0 ? 'SALDO A FAVOR' : 'TOTAL'}</span>
            <span className={`font-bold text-base ${v.pendiente > 0 ? 'text-amber-600' : v.saldoFavor > 0 ? 'text-purple-700' : 'text-green-700'}`}>
              ${(v.saldoFavor > 0 ? v.saldoFavor : v.pendiente).toLocaleString('es-CO')}
            </span>
          </div>
        </div>

        {v.cobros.length > 0 && (
          <ul className="text-xs text-green-700 space-y-0.5">
            {v.cobros.map((c) => (
              <li key={c.id}>
                ✓ ${Number(c.monto).toLocaleString('es-CO')} en {METODOS_PAGO.find((m) => m.valor === c.metodo_pago)?.etiqueta}
                {c.foto_url && (
                  <button onClick={() => verFoto(c.foto_url!)} className="ml-1 underline">ver foto</button>
                )}
              </li>
            ))}
          </ul>
        )}

        {v.credito && (
          <p className="text-xs text-purple-700 bg-purple-50 rounded-lg px-2 py-1.5">
            {v.credito.resolucion === 'credito'
              ? `✓ Se dejó $${Number(v.credito.monto).toLocaleString('es-CO')} como saldo a favor para su próxima cita.`
              : `✓ Se devolvieron $${Number(v.credito.monto).toLocaleString('es-CO')} en ${METODOS_PAGO.find((m) => m.valor === v.credito!.metodo_pago)?.etiqueta}.`}
            {v.credito.nota ? ` · ${v.credito.nota}` : ''}
          </p>
        )}

        {v.condonaciones.length > 0 && (
          <ul className="text-xs text-gray-500 space-y-0.5">
            {v.condonaciones.map((c) => (
              <li key={c.id}>
                ✓ Se eliminó ${Number(c.monto).toLocaleString('es-CO')} sin cobrar · {c.motivo}
              </li>
            ))}
          </ul>
        )}

        {v.pendiente > 0 && cobrandoId !== v.visitaId && condonandoId !== v.visitaId && (
          <div className="flex gap-2">
            <button
              onClick={() => abrirCobro(v)}
              className="flex-1 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg py-2 transition"
            >
              Cobrar
            </button>
            {esSuperadmin && (
              <button
                onClick={() => abrirCondonar(v)}
                className="flex-1 bg-gray-700 hover:bg-gray-800 text-white text-sm font-medium rounded-lg py-2 transition"
              >
                Eliminar saldo
              </button>
            )}
          </div>
        )}

        {condonandoId === v.visitaId && (
          <form onSubmit={(e) => condonarSaldo(e, v)} className="border border-gray-300 bg-gray-50 rounded-xl p-3 space-y-2">
            <p className="text-xs text-gray-600">
              Elimina de "Cuentas por cobrar" sin registrarlo como dinero cobrado — para cortesías o saldos que la dueña decide no cobrar.
            </p>
            <div>
              <label className="block text-xs font-medium mb-1">Monto a eliminar</label>
              <input
                type="text" inputMode="numeric"
                value={formatearPesosInput(montoCondonar)}
                onChange={(e) => setMontoCondonar(soloDigitos(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Motivo</label>
              <input
                required
                value={motivoCondonar}
                onChange={(e) => setMotivoCondonar(e.target.value)}
                placeholder="Ej. cortesía, la clienta no volvió…"
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={guardandoCondonacion} className="flex-1 bg-gray-700 hover:bg-gray-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg py-2">
                {guardandoCondonacion ? 'Guardando…' : 'Eliminar saldo pendiente'}
              </button>
              <button type="button" onClick={() => setCondonandoId(null)} className="px-3 text-sm text-gray-500">
                Cancelar
              </button>
            </div>
          </form>
        )}

        {conSaldoFavorSinResolver && resolviendoId !== v.visitaId && (
          v.clienteId ? (
            <button
              onClick={() => abrirResolver(v)}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg py-2 transition"
            >
              Resolver saldo a favor
            </button>
          ) : (
            <p className="text-xs text-purple-700 bg-purple-50 rounded-lg px-2 py-1.5">
              Esta clienta no tiene cuenta registrada en el sistema — anota aparte cómo se resolvió el saldo a favor de ${v.saldoFavor.toLocaleString('es-CO')} (crédito o devolución).
            </p>
          )
        )}

        {resolviendoId === v.visitaId && (
          <form onSubmit={(e) => resolverSaldoFavor(e, v)} className="border border-purple-200 bg-purple-50/50 rounded-xl p-3 space-y-2">
            <p className="text-xs text-purple-800">
              {v.clienteNombre} pagó ${v.abono.toLocaleString('es-CO')} de abono pero el total quedó en ${v.total.toLocaleString('es-CO')} — hay ${v.saldoFavor.toLocaleString('es-CO')} a su favor.
            </p>
            <div>
              <label className="block text-xs font-medium mb-1">¿Cómo se resuelve?</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setResolucionTipo('credito')}
                  className={`flex-1 text-xs rounded-lg py-2 border font-medium ${resolucionTipo === 'credito' ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-300 text-gray-600'}`}
                >
                  Dejar como saldo a favor
                </button>
                {esSuperadmin && (
                  <button
                    type="button"
                    onClick={() => setResolucionTipo('reembolso')}
                    className={`flex-1 text-xs rounded-lg py-2 border font-medium ${resolucionTipo === 'reembolso' ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-300 text-gray-600'}`}
                  >
                    Devolver el dinero
                  </button>
                )}
              </div>
              {!esSuperadmin && (
                <p className="text-[11px] text-purple-700 mt-1">
                  Sacar dinero de caja es solo de la dueña — si la clienta necesita que le devuelvan efectivo, pídele a la dueña que lo registre.
                </p>
              )}
            </div>
            {resolucionTipo === 'reembolso' && (
              <div>
                <label className="block text-xs font-medium mb-1">Medio por el que se devuelve</label>
                <select
                  value={metodoReembolso}
                  onChange={(e) => setMetodoReembolso(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">Selecciona…</option>
                  {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1">Nota (opcional)</label>
              <input
                value={notaResolucion}
                onChange={(e) => setNotaResolucion(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={guardandoResolucion} className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg py-2">
                {guardandoResolucion ? 'Guardando…' : 'Registrar'}
              </button>
              <button type="button" onClick={() => setResolviendoId(null)} className="px-3 text-sm text-gray-500">
                Cancelar
              </button>
            </div>
          </form>
        )}

        {cobrandoId === v.visitaId && (
          <form onSubmit={(e) => registrarCobro(e, v)} className="border border-brand-200 bg-brand-50/50 rounded-xl p-3 space-y-2">
            {lineasCobro.length > 0 && (
              <ul className="space-y-1">
                {lineasCobro.map((l) => (
                  <li key={l.key} className="flex items-center justify-between text-sm bg-white rounded-lg px-2 py-1.5">
                    <span>{METODOS_PAGO.find((m) => m.valor === l.metodo)?.etiqueta}: ${l.monto.toLocaleString('es-CO')}</span>
                    <button type="button" onClick={() => quitarLineaCobro(l.key)} className="text-xs text-red-500">Quitar</button>
                  </li>
                ))}
                <li className="text-right text-xs font-semibold text-brand-700 pt-0.5">
                  Suma agregada: ${lineasCobro.reduce((s, l) => s + l.monto, 0).toLocaleString('es-CO')} de ${v.pendiente.toLocaleString('es-CO')}
                </li>
              </ul>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Monto {lineasCobro.length > 0 ? 'de este medio' : 'cobrado'}</label>
                <input
                  type="text" inputMode="numeric"
                  value={formatearPesosInput(monto)}
                  onChange={(e) => setMonto(soloDigitos(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Medio de pago</label>
                <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                  <option value="">Selecciona…</option>
                  {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">
                Foto del pago {metodo && metodo !== 'efectivo' ? '(obligatoria)' : '(opcional en efectivo)'}
              </label>
              <input type="file" accept="image/*" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} className="w-full text-xs" />
            </div>

            {(monto || metodo) && (
              <button type="button" onClick={agregarLineaCobro} className="w-full text-xs border border-brand-300 text-brand-700 rounded-lg py-1.5 font-medium">
                + Agregar este medio y sumar otro (ej. el resto en Nequi)
              </button>
            )}

            <div>
              <label className="block text-xs font-medium mb-1">Nota (opcional)</label>
              <input value={notaCobro} onChange={(e) => setNotaCobro(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
            </div>

            <div className="flex gap-2">
              <button type="submit" disabled={guardando} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg py-2">
                {guardando ? 'Guardando…' : 'Registrar cobro'}
              </button>
              <button type="button" onClick={() => setCobrandoId(null)} className="px-3 text-sm text-gray-500">
                Cancelar
              </button>
            </div>
          </form>
        )}
      </li>
    )
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Cuentas por cobrar</h1>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
      </div>

      {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
      {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

      {pendientes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
          {pendientes.length} visita(s) por cobrar · Total pendiente: <b>${totalPendiente.toLocaleString('es-CO')}</b>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-gray-500 mb-2">Por cobrar</h2>
        <ul className="space-y-3">
          {pendientes.map((v) => tarjetaVisita(v))}
          {!cargando && pendientes.length === 0 && (
            <li className="text-sm text-gray-400">No hay cuentas pendientes este día. 🎉</li>
          )}
        </ul>
      </div>

      {porResolver.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-purple-600 mb-2">Saldo a favor por resolver</h2>
          <ul className="space-y-3">
            {porResolver.map((v) => tarjetaVisita(v))}
          </ul>
        </div>
      )}

      {cobradas.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 mb-2">Ya cobradas</h2>
          <ul className="space-y-3">
            {cobradas.map((v) => tarjetaVisita(v))}
          </ul>
        </div>
      )}
    </div>
  )
}
