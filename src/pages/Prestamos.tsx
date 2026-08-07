import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import { METODOS_PAGO, type Prestamo, type PrestamoPago, type Producto, type Profile, type TipoPrestamo } from '../types'

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

type Pestana = 'dinero' | 'insumos'
type InventarioInsumo = 'vitrina' | 'interno'

export default function Prestamos() {
  const { profile } = useAuth()
  const [pestana, setPestana] = useState<Pestana>('dinero')
  const [prestamos, setPrestamos] = useState<Prestamo[]>([])
  const [pagos, setPagos] = useState<PrestamoPago[]>([])
  const [personal, setPersonal] = useState<Profile[]>([])
  const [productos, setProductos] = useState<Producto[]>([])

  const [personaId, setPersonaId] = useState('')
  // Solo aplica en la pestaña de insumos: de qué inventario sale.
  const [inventarioInsumo, setInventarioInsumo] = useState<InventarioInsumo>('vitrina')
  const [descripcion, setDescripcion] = useState('')
  const [monto, setMonto] = useState('')
  const [metodoPago, setMetodoPago] = useState('')
  const [productoId, setProductoId] = useState('')
  const [cantidadProducto, setCantidadProducto] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  // Registrar pago (abono) de un préstamo, con su propio medio de pago.
  const [pagandoId, setPagandoId] = useState<string | null>(null)
  const [montoPago, setMontoPago] = useState('')
  const [metodoPagoAbono, setMetodoPagoAbono] = useState('')
  const [notaPago, setNotaPago] = useState('')
  const [guardandoPago, setGuardandoPago] = useState(false)
  const [pagoError, setPagoError] = useState<string | null>(null)

  async function cargar() {
    const [{ data: prest }, { data: pagosData }] = await Promise.all([
      supabase
        .from('prestamos')
        .select('*, persona:profiles!prestamos_persona_id_fkey(nombre), producto:productos(nombre)')
        .order('created_at', { ascending: false }),
      supabase.from('prestamo_pagos').select('*').order('created_at', { ascending: false })
    ])
    setPrestamos((prest as Prestamo[]) ?? [])
    setPagos((pagosData as PrestamoPago[]) ?? [])
  }

  async function cargarProductos() {
    const { data } = await supabase.from('productos').select('*').eq('activo', true).gt('stock', 0).order('nombre')
    setProductos((data as Producto[]) ?? [])
  }

  useEffect(() => {
    cargar()
    cargarProductos()
    supabase.from('profiles').select('*').eq('rol', 'personal').eq('activo', true).order('nombre')
      .then(({ data }) => setPersonal((data as Profile[]) ?? []))
  }, [])

  // La pestaña "Dinero" siempre registra tipo 'dinero'. En "Insumos", el
  // inventario elegido decide el tipo: vitrina (con costo, genera deuda) o
  // interno (sin costo, sin deuda).
  const tipoActual: TipoPrestamo = pestana === 'dinero' ? 'dinero' : (inventarioInsumo === 'vitrina' ? 'insumo' : 'insumo_interno')
  const esInsumoInterno = tipoActual === 'insumo_interno'
  const productosDisponibles = productos.filter((p) => p.tipo === inventarioInsumo)
  const productoSel = productos.find((p) => p.id === productoId)

  function cambiarPestana(nueva: Pestana) {
    setPestana(nueva)
    setInventarioInsumo('vitrina')
    setProductoId('')
    setCantidadProducto('1')
    setMonto('')
    setMetodoPago('')
    setDescripcion('')
    setError(null)
    setMensaje(null)
  }

  function cambiarInventario(nuevo: InventarioInsumo) {
    setInventarioInsumo(nuevo)
    setProductoId('')
    setCantidadProducto('1')
  }

  async function registrar(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null); setMensaje(null)
    if (pestana === 'insumos' && productoId && Number(cantidadProducto) > (productoSel?.stock ?? 0)) {
      setError(`Solo hay ${productoSel?.stock ?? 0} en stock de ese producto.`)
      return
    }
    if (esInsumoInterno && !productoId) {
      setError('Elige el producto interno que se le asignó.')
      return
    }
    const { error } = await supabase.from('prestamos').insert({
      salon_id: profile.salon_id,
      persona_id: personaId,
      tipo: tipoActual,
      descripcion: descripcion || null,
      monto: esInsumoInterno ? 0 : Number(monto || 0),
      metodo_pago: esInsumoInterno ? null : (metodoPago || null),
      producto_id: pestana === 'insumos' && productoId ? productoId : null,
      cantidad: pestana === 'insumos' && productoId ? Number(cantidadProducto || 1) : null,
      // Un insumo asignado no es una deuda: no hay nada que "pagar" de vuelta.
      pagado: esInsumoInterno,
      creado_por: profile.id
    })
    if (error) { setError('No se pudo registrar: ' + error.message); return }
    setMensaje('Registrado.')
    setPersonaId(''); setDescripcion(''); setMonto(''); setMetodoPago('')
    setProductoId(''); setCantidadProducto('1')
    cargar()
    cargarProductos()
  }

  const pagosPorPrestamo = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of pagos) m.set(p.prestamo_id, (m.get(p.prestamo_id) ?? 0) + Number(p.monto))
    return m
  }, [pagos])

  function pendienteDe(p: Prestamo): number {
    if (p.pagado) return 0
    return Math.max(0, Number(p.monto) - (pagosPorPrestamo.get(p.id) ?? 0))
  }

  function abrirPago(p: Prestamo) {
    setPagandoId(p.id)
    setMontoPago(String(pendienteDe(p)))
    setMetodoPagoAbono('')
    setNotaPago('')
    setPagoError(null)
  }

  // Para cuando la deuda se salda descontándola de la comisión (no entra
  // dinero nuevo a caja, así que no se registra en el ledger de pagos).
  async function marcarSaldadoSinCaja(p: Prestamo) {
    if (!confirm(`¿Confirmas que ya se descontó ${pesos(pendienteDe(p))} de la comisión de ${p.persona?.nombre}? Esto no queda registrado en el cierre de caja.`)) return
    await supabase.from('prestamos').update({ pagado: true }).eq('id', p.id)
    cargar()
  }

  async function registrarPago(p: Prestamo) {
    if (!profile) return
    setPagoError(null)
    const valor = Number(montoPago)
    if (!valor || valor <= 0) { setPagoError('Escribe el monto pagado.'); return }
    if (valor > pendienteDe(p) + 0.01) { setPagoError('Ese monto es mayor a lo pendiente.'); return }
    if (!metodoPagoAbono) { setPagoError('Elige el medio de pago.'); return }
    setGuardandoPago(true)
    const { error } = await supabase.from('prestamo_pagos').insert({
      prestamo_id: p.id,
      monto: valor,
      metodo_pago: metodoPagoAbono,
      nota: notaPago || null,
      pagado_por: profile.id
    })
    setGuardandoPago(false)
    if (error) { setPagoError('No se pudo registrar: ' + error.message); return }
    setPagandoId(null)
    cargar()
  }

  // Cada pestaña solo muestra lo suyo: "Dinero" son préstamos en efectivo;
  // "Insumos" agrupa fiado (vitrina, con deuda) y asignado (interno, sin
  // deuda) — ambos son "se le dio un producto físico".
  const prestamosTab = useMemo(
    () => prestamos.filter((p) => (pestana === 'dinero' ? p.tipo === 'dinero' : p.tipo !== 'dinero')),
    [prestamos, pestana]
  )

  const porPersona = useMemo(() => {
    const mapa = new Map<string, { nombre: string; pendiente: number }>()
    for (const p of prestamosTab) {
      const pend = pendienteDe(p)
      if (pend <= 0) continue
      const nombre = p.persona?.nombre ?? 'Sin nombre'
      const a = mapa.get(p.persona_id) ?? { nombre, pendiente: 0 }
      a.pendiente += pend
      mapa.set(p.persona_id, a)
    }
    return [...mapa.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prestamosTab, pagosPorPrestamo])

  const totalPrestado = useMemo(
    () => prestamosTab.reduce((s, p) => s + pendienteDe(p), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prestamosTab, pagosPorPrestamo]
  )

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Préstamos y asignación de insumos</h1>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        <button
          onClick={() => cambiarPestana('dinero')}
          className={`flex-1 text-sm font-medium rounded-lg py-2 transition ${pestana === 'dinero' ? 'bg-white shadow text-brand-700' : 'text-gray-500'}`}
        >
          Préstamos de dinero
        </button>
        <button
          onClick={() => cambiarPestana('insumos')}
          className={`flex-1 text-sm font-medium rounded-lg py-2 transition ${pestana === 'insumos' ? 'bg-white shadow text-brand-700' : 'text-gray-500'}`}
        >
          Asignación de Insumos
        </button>
      </div>

      {totalPrestado > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4">
          <p className="text-xs text-amber-700">{pestana === 'dinero' ? 'Prestado' : 'Fiado de vitrina'} (pendiente de pago)</p>
          <p className="text-2xl font-bold text-amber-800">{pesos(totalPrestado)}</p>
        </div>
      )}

      <form onSubmit={registrar} className="bg-white rounded-2xl shadow p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-600">
          Registrar {pestana === 'dinero' ? 'préstamo de dinero' : 'insumo'}
        </h2>
        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
        {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Persona</label>
            <select required value={personaId} onChange={(e) => setPersonaId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
              <option value="">Selecciona…</option>
              {personal.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          {pestana === 'insumos' && (
            <div>
              <label className="block text-sm font-medium mb-1">¿De qué inventario?</label>
              <select value={inventarioInsumo} onChange={(e) => cambiarInventario(e.target.value as InventarioInsumo)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                <option value="vitrina">Vitrina (genera deuda)</option>
                <option value="interno">Interno (sin costo)</option>
              </select>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Descripción</label>
            <input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder={pestana === 'dinero' ? 'Ej: adelanto' : inventarioInsumo === 'vitrina' ? 'Ej: labial, esmalte…' : 'Ej: base para su día a día'}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          {!esInsumoInterno && (
            <div>
              <label className="block text-sm font-medium mb-1">Monto</label>
              <input type="text" inputMode="numeric" required value={formatearPesosInput(monto)} onChange={(e) => setMonto(soloDigitos(e.target.value))} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
          )}
          {!esInsumoInterno && (
            <div>
              <label className="block text-sm font-medium mb-1">¿Por qué medio se dio?</label>
              <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                <option value="">Selecciona…</option>
                {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
              </select>
            </div>
          )}
        </div>
        {esInsumoInterno && (
          <p className="text-xs text-gray-400 -mt-2">Un insumo asignado no tiene costo ni genera deuda — solo queda registrado a quién y qué se le dio.</p>
        )}

        {pestana === 'insumos' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-gray-100 pt-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                {inventarioInsumo === 'vitrina' ? 'Producto de vitrina (opcional)' : 'Producto interno'}
              </label>
              {productosDisponibles.length > 0 ? (
                <select required={esInsumoInterno} value={productoId} onChange={(e) => setProductoId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
                  <option value="">{inventarioInsumo === 'vitrina' ? 'No descontar de inventario' : 'Selecciona…'}</option>
                  {productosDisponibles.map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre} ({p.stock} en stock)</option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Aún no hay productos {inventarioInsumo === 'vitrina' ? 'de vitrina' : 'internos'} con stock en el inventario.
                  Agrégalos primero en Inventario → pestaña {inventarioInsumo === 'vitrina' ? '"Vitrina"' : '"Interno"'}.
                </p>
              )}
            </div>
            {productoId && (
              <div>
                <label className="block text-sm font-medium mb-1">Cantidad</label>
                <input
                  type="number" min="1" step="1"
                  value={cantidadProducto}
                  onChange={(e) => setCantidadProducto(e.target.value)}
                  max={productoSel?.stock}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                />
              </div>
            )}
          </div>
        )}

        <button type="submit" className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg py-2 transition">Registrar</button>
      </form>

      {porPersona.length > 0 && (
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-sm font-semibold text-gray-600 mb-2">Deben (pendiente)</h2>
          <ul className="space-y-1">
            {porPersona.map((x) => (
              <li key={x.nombre} className="flex justify-between text-sm">
                <span>{x.nombre}</span>
                <span className="font-semibold text-red-600">{pesos(x.pendiente)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-gray-500 mb-2">Historial</h2>
        <ul className="space-y-2">
          {prestamosTab.map((p) => {
            const pendiente = pendienteDe(p)
            const pagosDeEste = pagos.filter((pg) => pg.prestamo_id === p.id)
            return (
              <li key={p.id} className={`bg-white rounded-xl shadow-sm p-3 text-sm space-y-2 ${pendiente <= 0 ? 'opacity-70' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {p.persona?.nombre}
                      {pestana === 'insumos' && ` · ${p.tipo === 'insumo' ? 'Insumo fiado' : 'Insumo asignado'}`}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {p.descripcion || '—'}
                      {p.producto ? ` · ${p.cantidad}× ${p.producto.nombre}` : ''}
                      {p.metodo_pago ? ` · ${p.metodo_pago}` : ''} · {p.created_at.slice(0, 10)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {p.tipo !== 'insumo_interno' && <span className="font-semibold">{pesos(Number(p.monto))}</span>}
                    {p.tipo === 'insumo_interno' ? (
                      <span className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700">Sin costo</span>
                    ) : pendiente <= 0 ? (
                      <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">Pagado</span>
                    ) : (
                      <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700">Debe {pesos(pendiente)}</span>
                    )}
                  </div>
                </div>

                {pagosDeEste.length > 0 && (
                  <ul className="text-xs text-green-700 space-y-0.5 pl-1">
                    {pagosDeEste.map((pg) => (
                      <li key={pg.id}>✓ {pesos(Number(pg.monto))} en {METODOS_PAGO.find((m) => m.valor === pg.metodo_pago)?.etiqueta}{pg.nota ? ` · ${pg.nota}` : ''}</li>
                    ))}
                  </ul>
                )}

                {pendiente > 0 && pagandoId !== p.id && (
                  <div className="flex flex-wrap gap-3">
                    <button onClick={() => abrirPago(p)} className="text-xs text-brand-600 font-medium">
                      Registrar pago ▾
                    </button>
                    {p.tipo === 'dinero' && (
                      <button onClick={() => marcarSaldadoSinCaja(p)} className="text-xs text-gray-400 font-medium">
                        Ya se descontó de su comisión
                      </button>
                    )}
                  </div>
                )}

                {pagandoId === p.id && (
                  <div className="border border-brand-200 bg-brand-50/50 rounded-xl p-3 space-y-2">
                    {pagoError && <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{pagoError}</div>}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium mb-1">Monto pagado</label>
                        <input type="text" inputMode="numeric" value={formatearPesosInput(montoPago)} onChange={(e) => setMontoPago(soloDigitos(e.target.value))} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Medio de pago</label>
                        <select value={metodoPagoAbono} onChange={(e) => setMetodoPagoAbono(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
                          <option value="">Selecciona…</option>
                          {METODOS_PAGO.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                        </select>
                      </div>
                    </div>
                    <input placeholder="Nota (opcional)" value={notaPago} onChange={(e) => setNotaPago(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                    <div className="flex gap-2">
                      <button onClick={() => registrarPago(p)} disabled={guardandoPago} className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg py-1.5">
                        {guardandoPago ? 'Guardando…' : 'Registrar pago'}
                      </button>
                      <button onClick={() => setPagandoId(null)} className="px-3 text-sm text-gray-500">Cancelar</button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
          {prestamosTab.length === 0 && <li className="text-sm text-gray-400">Sin registros.</li>}
        </ul>
      </div>
    </div>
  )
}
