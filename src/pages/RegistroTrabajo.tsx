import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy, rangoDiaUTC } from '../lib/fechas'
import { comprimirImagen } from '../lib/comprimirImagen'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import type { Cita, RegistroTrabajo, Servicio } from '../types'

interface Linea {
  key: string
  servicioId: string
  servicioNombre: string
  precioBase: number
  descuento: number
  total: number
  nota: string | null
}

export default function RegistroTrabajoPage() {
  const { profile } = useAuth()
  const [servicios, setServicios] = useState<Servicio[]>([])

  // Línea que se está agregando
  const [servicioId, setServicioId] = useState('')
  const [precio, setPrecio] = useState('')
  const [descuento, setDescuento] = useState('0')
  const [notaLinea, setNotaLinea] = useState('')

  // Carrito de servicios de esta misma clienta
  const [lineas, setLineas] = useState<Linea[]>([])

  // Datos compartidos
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteTelefono, setClienteTelefono] = useState('')
  const [foto, setFoto] = useState<File | null>(null)

  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [misRegistrosHoy, setMisRegistrosHoy] = useState<RegistroTrabajo[]>([])

  // Citas asignadas hoy a esta profesional (pendientes/confirmadas)
  const [citasHoy, setCitasHoy] = useState<Cita[]>([])
  const [citaSeleccionada, setCitaSeleccionada] = useState<Cita | null>(null)

  useEffect(() => {
    supabase.from('servicios').select('*').eq('activo', true).order('categoria').order('nombre')
      .then(({ data }) => setServicios(data ?? []))
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

  const servicioSel = servicios.find((s) => s.id === servicioId)
  const esAdicional = servicioSel?.categoria === 'Adicional'
  const base = Number(precio) || 0
  const desc = Number(descuento) || 0
  const totalLinea = Math.max(0, Math.round(base * (1 - desc / 100)))
  const notaRequerida = esAdicional || desc > 0
  const etiquetaNota = esAdicional ? 'Concepto del adicional' : desc > 0 ? 'Motivo del descuento' : 'Nota (opcional)'

  const totalGeneral = lineas.reduce((s, l) => s + l.total, 0)

  function handleServicioChange(id: string) {
    setServicioId(id)
    const s = servicios.find((x) => x.id === id)
    if (s) setPrecio(String(s.precio_base))
  }

  function agregarLinea(): boolean {
    if (!servicioId) { setError('Elige un servicio.'); return false }
    if (notaRequerida && !notaLinea.trim()) {
      setError(esAdicional ? 'Escribe el concepto del adicional.' : 'Escribe el motivo del descuento.')
      return false
    }
    setError(null)
    setLineas((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        servicioId,
        servicioNombre: servicioSel?.nombre ?? 'Servicio',
        precioBase: base,
        descuento: desc,
        total: totalLinea,
        nota: notaLinea.trim() || null
      }
    ])
    setServicioId('')
    setPrecio('')
    setDescuento('0')
    setNotaLinea('')
    return true
  }

  function quitarLinea(key: string) {
    setLineas((prev) => prev.filter((l) => l.key !== key))
  }

  // Si la clienta cambia de servicio a mitad de la atención (o la profesional
  // la convence de uno mejor), esto quita esa línea y la deja lista para
  // reemplazarla abajo: el total y el saldo a cobrar (total - abono ya
  // pagado) se recalculan solos con el nuevo precio.
  function cambiarLinea(l: Linea) {
    quitarLinea(l.key)
    setServicioId(l.servicioId)
    setPrecio(String(l.precioBase))
    setDescuento(String(l.descuento))
    setNotaLinea(l.nota ?? '')
    setError(null)
  }

  async function cargarRegistrosHoy() {
    if (!profile) return
    const { desde, hasta } = rangoDiaUTC(fechaHoy())
    const { data } = await supabase
      .from('registros_trabajo')
      .select('*, servicio:servicios(*)')
      .eq('empleada_id', profile.id)
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .order('created_at', { ascending: false })
    setMisRegistrosHoy((data as RegistroTrabajo[]) ?? [])
  }

  async function cargarCitasHoy() {
    if (!profile) return
    const { data } = await supabase
      .from('citas')
      .select('*, servicio:servicios(*)')
      .eq('empleada_id', profile.id)
      .eq('fecha', fechaHoy())
      .in('estado', ['pendiente', 'confirmada'])
      .order('hora')
    setCitasHoy((data as Cita[]) ?? [])
  }

  useEffect(() => {
    cargarRegistrosHoy()
    cargarCitasHoy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  function nombresDeCita(c: Cita): string[] {
    const ids = c.servicios_ids && c.servicios_ids.length > 0 ? c.servicios_ids : c.servicio_id ? [c.servicio_id] : []
    return ids.map((id) => {
      const s = servicios.find((x) => x.id === id)
      if (s?.categoria === 'Adicional' && c.adicional_concepto) return `Adicional: ${c.adicional_concepto}`
      return s?.nombre ?? c.servicio?.nombre ?? 'Servicio'
    })
  }

  // Carga la cita en el formulario con sus servicios y valores. Si algún
  // servicio es el "Adicional" (monto y concepto libre), trae el nombre y
  // el valor que se escribieron al agendar la cita.
  function cargarDesdeCita(c: Cita) {
    const ids = c.servicios_ids && c.servicios_ids.length > 0 ? c.servicios_ids : c.servicio_id ? [c.servicio_id] : []
    const nuevas: Linea[] = ids.map((id) => {
      const s = servicios.find((x) => x.id === id)
      const esAdicionalConDatos = s?.categoria === 'Adicional' && c.adicional_concepto
      const precioBase = esAdicionalConDatos ? Number(c.adicional_valor ?? 0) : Number(s?.precio_base ?? 0)
      return {
        key: crypto.randomUUID(),
        servicioId: id,
        servicioNombre: esAdicionalConDatos ? c.adicional_concepto! : (s?.nombre ?? 'Servicio'),
        precioBase,
        descuento: 0,
        total: Math.round(precioBase),
        nota: null
      }
    })
    setLineas(nuevas)
    setClienteNombre(c.cliente_nombre)
    setClienteTelefono(c.cliente_telefono ?? '')
    setCitaSeleccionada(c)
    setServicioId(''); setPrecio(''); setDescuento('0'); setNotaLinea('')
    setError(null); setMensaje(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    setMensaje(null)

    // Si dejó una línea escrita sin haberla agregado al carrito, la incluimos.
    const items = [...lineas]
    if (servicioId) {
      if (notaRequerida && !notaLinea.trim()) {
        setError(esAdicional ? 'Escribe el concepto del adicional.' : 'Escribe el motivo del descuento.')
        return
      }
      items.push({
        key: 'actual', servicioId, servicioNombre: servicioSel?.nombre ?? '', precioBase: base,
        descuento: desc, total: totalLinea, nota: notaLinea.trim() || null
      })
    }
    if (items.length === 0) { setError('Agrega al menos un servicio.'); return }
    if (!foto) { setError('Sube la foto del trabajo terminado.'); return }

    setGuardando(true)
    try {
      let fotoUrl: string | null = null
      if (foto) {
        const comprimida = await comprimirImagen(foto)
        const path = `${profile.salon_id}/${profile.id}/${Date.now()}_${comprimida.name}`
        const { error: upErr } = await supabase.storage.from('evidencias').upload(path, comprimida)
        if (upErr) throw upErr
        fotoUrl = path
      }

      // visita_id agrupa los servicios de esta clienta: la administradora
      // recibe UNA cuenta por cobrar por la visita completa.
      const visitaId = crypto.randomUUID()
      const filas = items.map((l) => ({
        salon_id: profile.salon_id,
        empleada_id: profile.id,
        servicio_id: l.servicioId,
        precio_cobrado: l.total,
        descuento_porcentaje: l.descuento,
        cliente_nombre: clienteNombre || null,
        cliente_telefono: clienteTelefono || null,
        nota: l.nota,
        foto_url: fotoUrl,
        visita_id: visitaId,
        cita_id: citaSeleccionada?.id ?? null
      }))

      const { error: insErr } = await supabase.from('registros_trabajo').insert(filas)
      if (insErr) throw insErr

      // Si venía de una cita, la marcamos como Completada.
      // El dinero NO lo cobra la profesional: la cuenta por cobrar
      // le aparece a la administradora, que registra el pago.
      if (citaSeleccionada) {
        await supabase.from('citas').update({ estado: 'completada' }).eq('id', citaSeleccionada.id)
      }

      setMensaje(
        citaSeleccionada
          ? `Trabajo registrado y cita de ${citaSeleccionada.cliente_nombre} marcada como Completada. La administradora cobrará el saldo.`
          : `Se registraron ${filas.length} servicio(s). La administradora hará el cobro.`
      )
      setLineas([])
      setServicioId('')
      setPrecio('')
      setDescuento('0')
      setNotaLinea('')
      setClienteNombre('')
      setClienteTelefono('')
      setFoto(null)
      setCitaSeleccionada(null)
      cargarRegistrosHoy()
      cargarCitasHoy()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Registrar trabajo</h1>

      {/* Citas asignadas hoy: al tocar "Registrar" se cargan sus servicios y valores */}
      {citasHoy.length > 0 && (
        <div className="bg-white rounded-2xl shadow p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-600">Tus citas de hoy</h2>
          {citasHoy.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 border-b border-gray-50 pb-2 last:border-0">
              <div className="min-w-0">
                <p className="font-medium text-sm">{c.hora.slice(0, 5)} · {c.cliente_nombre}</p>
                <p className="text-xs text-gray-400 truncate">
                  {nombresDeCita(c).join(', ')}
                  {Number(c.abono) > 0 && <span className="text-brand-500"> · abonó ${Number(c.abono).toLocaleString('es-CO')}</span>}
                </p>
                {c.obsequios.length > 0 && (
                  <p className="text-xs text-brand-700 bg-brand-50 rounded px-2 py-0.5 mt-1">
                    🎁 {c.obsequios.length > 1 ? 'Obsequios' : 'Obsequio'}: {c.obsequios.join(', ')}
                  </p>
                )}
                {c.nota_interna && (
                  <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-0.5 mt-1">
                    📌 {c.nota_interna}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => cargarDesdeCita(c)}
                className="shrink-0 text-xs bg-brand-600 text-white rounded-lg px-3 py-1.5"
              >
                Registrar
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow p-4 space-y-4">
        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
        {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

        {citaSeleccionada && (
          <div className="bg-brand-50 border border-brand-200 rounded-lg p-3 text-sm text-brand-800 space-y-1">
            <p>Registrando la cita de <b>{citaSeleccionada.cliente_nombre}</b></p>
            <p className="text-xs">
              Total: ${totalGeneral.toLocaleString('es-CO')}
              {Number(citaSeleccionada.abono) > 0 && (
                <> · Abono ya pagado: ${Number(citaSeleccionada.abono).toLocaleString('es-CO')} · Saldo a cobrar: <b>${Math.max(0, totalGeneral - Number(citaSeleccionada.abono)).toLocaleString('es-CO')}</b></>
              )}
            </p>
            {citaSeleccionada.obsequios.length > 0 && (
              <p className="text-xs bg-brand-100 rounded px-2 py-1 font-medium">
                🎁 No olvides {citaSeleccionada.obsequios.length > 1 ? 'los obsequios' : 'el obsequio'}: {citaSeleccionada.obsequios.join(', ')}
              </p>
            )}

            <p className="text-xs text-brand-600">
              Al guardar, la cita quedará <b>Completada</b> y el saldo le aparecerá a la
              administradora como cuenta por cobrar.
            </p>
            <p className="text-xs text-brand-600">
              ¿La clienta cambió de idea o se llevó un servicio distinto al que pidió? Usa
              "Cambiar" en esa línea del carrito de abajo — el total y el saldo a cobrar se
              ajustan solos con el nuevo precio, sin tocar el abono que ya pagó.
            </p>
          </div>
        )}

        {/* Datos de la clienta (compartidos por todos los servicios) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Cliente (nombre)</label>
            <input value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Teléfono</label>
            <input
              value={clienteTelefono ? '•'.repeat(10) : ''}
              disabled
              readOnly
              placeholder="No visible para tu rol"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-gray-100 text-gray-400"
            />
          </div>
        </div>

        {/* Carrito de servicios */}
        {lineas.length > 0 && (
          <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-2 space-y-1">
            {lineas.map((l) => (
              <div key={l.key} className="flex items-center justify-between text-sm bg-white rounded-lg px-3 py-2">
                <span className="min-w-0">
                  {l.servicioNombre}
                  {l.descuento > 0 && <span className="text-brand-500"> (-{l.descuento}%)</span>}
                  {l.nota && <span className="text-gray-400"> · {l.nota}</span>}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="font-medium">${l.total.toLocaleString('es-CO')}</span>
                  <button type="button" onClick={() => cambiarLinea(l)} className="text-brand-600 text-xs font-medium">Cambiar</button>
                  <button type="button" onClick={() => quitarLinea(l.key)} className="text-red-500 text-xs">Quitar</button>
                </span>
              </div>
            ))}
            <p className="text-right text-sm font-semibold text-brand-700 pt-1">Total: ${totalGeneral.toLocaleString('es-CO')}</p>
          </div>
        )}

        {/* Agregar un servicio */}
        <div className="space-y-3 border-t border-gray-100 pt-3">
          <div>
            <label className="block text-sm font-medium mb-1">Servicio Adicional</label>
            <select value={servicioId} onChange={(e) => handleServicioChange(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
              <option value="">Selecciona un servicio</option>
              {porCategoria.map(([categoria, lista]) => (
                <optgroup key={categoria} label={categoria}>
                  {lista.map((s) => (
                    <option key={s.id} value={s.id}>{s.nombre}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Precio</label>
              <input type="text" inputMode="numeric" value={formatearPesosInput(precio)} onChange={(e) => setPrecio(soloDigitos(e.target.value))} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Descuento (%)</label>
              <input type="number" min="0" max="100" step="1" value={descuento} onChange={(e) => setDescuento(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
          </div>

          {desc > 0 && (
            <p className="text-sm text-brand-700 font-medium -mt-1">Con {desc}% queda en ${totalLinea.toLocaleString('es-CO')}</p>
          )}

          {(notaRequerida || servicioId) && (
            <div>
              <label className="block text-sm font-medium mb-1">{etiquetaNota}</label>
              <input
                value={notaLinea}
                onChange={(e) => setNotaLinea(e.target.value)}
                placeholder={esAdicional ? 'Ej: diseño personalizado' : desc > 0 ? 'Ej: promoción' : ''}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => agregarLinea()}
            disabled={!servicioId}
            className="w-full border border-brand-300 text-brand-700 disabled:opacity-40 font-medium rounded-lg py-2"
          >
            + Agregar servicio
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Foto del trabajo terminado (obligatoria)</label>
          <input type="file" accept="image/*" required onChange={(e) => setFoto(e.target.files?.[0] ?? null)} className="w-full text-sm" />
        </div>

        <button
          type="submit"
          disabled={guardando}
          className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition"
        >
          {guardando ? 'Guardando…' : `Registrar ${lineas.length + (servicioId ? 1 : 0) || ''} trabajo(s)`}
        </button>
      </form>

      <div>
        <h2 className="text-sm font-semibold text-gray-500 mb-2">Mis registros de hoy</h2>
        <ul className="space-y-2">
          {misRegistrosHoy.map((r) => (
            <li key={r.id} className="bg-white rounded-xl shadow-sm p-3 text-sm flex justify-between">
              <span>
                {r.servicio?.nombre ?? 'Servicio'} · {r.cliente_nombre || 'Sin nombre'}
                {r.nota && <span className="text-gray-400"> ({r.nota})</span>}
              </span>
              <span className={r.anulado ? 'line-through text-red-500' : 'font-medium'}>
                ${r.precio_cobrado.toLocaleString('es-CO')}
              </span>
            </li>
          ))}
          {misRegistrosHoy.length === 0 && (
            <li className="text-sm text-gray-400">Aún no has registrado trabajos hoy.</li>
          )}
        </ul>
      </div>
    </div>
  )
}
