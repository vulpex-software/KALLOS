import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import type { ConsumoInterno, Producto, TipoProducto } from '../types'

export default function Productos() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<TipoProducto>('vitrina')
  const [productos, setProductos] = useState<Producto[]>([])
  const [consumos, setConsumos] = useState<ConsumoInterno[]>([])
  const [editando, setEditando] = useState<Record<string, { precio_venta: string; costo: string; stock: string }>>({})
  const [guardandoId, setGuardandoId] = useState<string | null>(null)

  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [precioVenta, setPrecioVenta] = useState('')
  const [costo, setCosto] = useState('')
  const [stock, setStock] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  // Formulario de "registrar consumo" abierto (por producto interno).
  const [consumiendoId, setConsumiendoId] = useState<string | null>(null)
  const [cantidadConsumo, setCantidadConsumo] = useState('1')
  const [notaConsumo, setNotaConsumo] = useState('')
  const [guardandoConsumo, setGuardandoConsumo] = useState(false)

  async function cargar() {
    const { data } = await supabase.from('productos').select('*').order('nombre')
    const lista = (data as Producto[]) ?? []
    setProductos(lista)
    setEditando(
      Object.fromEntries(
        lista.map((p) => [p.id, {
          precio_venta: String(p.precio_venta),
          costo: p.costo != null ? String(p.costo) : '',
          stock: String(p.stock)
        }])
      )
    )
  }

  async function cargarConsumos() {
    const { data } = await supabase
      .from('consumos_internos')
      .select('*, producto:productos(*)')
      .order('created_at', { ascending: false })
      .limit(30)
    setConsumos((data as ConsumoInterno[]) ?? [])
  }

  useEffect(() => {
    cargar()
    cargarConsumos()
  }, [])

  async function crearProducto(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMensaje(null)
    if (!profile) return
    const { error } = await supabase.from('productos').insert({
      salon_id: profile.salon_id,
      tipo: tab,
      nombre,
      descripcion: descripcion || null,
      precio_venta: tab === 'vitrina' ? Number(precioVenta || 0) : 0,
      costo: costo ? Number(costo) : null,
      stock: Number(stock || 0),
      creado_por: profile.id
    })
    if (error) {
      setError('No se pudo crear el producto: ' + error.message)
    } else {
      setMensaje('Producto agregado.')
      setNombre(''); setDescripcion(''); setPrecioVenta(''); setCosto(''); setStock('0')
      cargar()
    }
  }

  async function guardarCambios(id: string) {
    const e = editando[id]
    if (!e) return
    setGuardandoId(id)
    await supabase.from('productos').update({
      precio_venta: Number(e.precio_venta || 0),
      costo: e.costo ? Number(e.costo) : null,
      stock: Math.max(0, Math.round(Number(e.stock || 0)))
    }).eq('id', id)
    setGuardandoId(null)
    cargar()
  }

  async function alternarActivo(p: Producto) {
    await supabase.from('productos').update({ activo: !p.activo }).eq('id', p.id)
    cargar()
  }

  function abrirConsumo(p: Producto) {
    setConsumiendoId(p.id)
    setCantidadConsumo('1')
    setNotaConsumo('')
    setError(null)
    setMensaje(null)
  }

  async function registrarConsumo(e: FormEvent, p: Producto) {
    e.preventDefault()
    if (!profile) return
    const cant = Math.round(Number(cantidadConsumo || 0))
    if (!cant || cant <= 0) { setError('Escribe la cantidad usada.'); return }
    if (cant > p.stock) { setError(`No hay suficiente stock (disponible: ${p.stock}).`); return }
    setError(null)
    setGuardandoConsumo(true)
    const { error: insErr } = await supabase.from('consumos_internos').insert({
      salon_id: profile.salon_id,
      producto_id: p.id,
      cantidad: cant,
      nota: notaConsumo || null,
      registrado_por: profile.id
    })
    setGuardandoConsumo(false)
    if (insErr) {
      setError('No se pudo registrar el consumo: ' + insErr.message)
      return
    }
    setMensaje(`Se descontaron ${cant} de "${p.nombre}".`)
    setConsumiendoId(null)
    cargar()
    cargarConsumos()
  }

  const productosTab = productos.filter((p) => p.tipo === tab)

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Inventario</h1>
      <p className="text-sm text-gray-500 -mt-4">
        Dos inventarios separados: <b>Vitrina</b> son los productos que se venden o se prestan (a clientas o al
        personal) y generan un pago; <b>Interno</b> son los insumos de uso profesional (bases, esmaltes…) que solo
        se descuentan por consumo, sin ningún valor ni pago asociado.
      </p>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        <button
          onClick={() => setTab('vitrina')}
          className={`flex-1 text-sm font-medium rounded-lg py-2 transition ${tab === 'vitrina' ? 'bg-white shadow text-brand-700' : 'text-gray-500'}`}
        >
          Vitrina
        </button>
        <button
          onClick={() => setTab('interno')}
          className={`flex-1 text-sm font-medium rounded-lg py-2 transition ${tab === 'interno' ? 'bg-white shadow text-brand-700' : 'text-gray-500'}`}
        >
          Interno
        </button>
      </div>

      <form onSubmit={crearProducto} className="bg-white rounded-2xl shadow p-4 space-y-3">
        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
        {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}
        <h2 className="font-semibold text-sm text-gray-600">Agregar producto {tab === 'vitrina' ? 'de vitrina' : 'interno'}</h2>

        <div>
          <label className="block text-sm font-medium mb-1">Nombre</label>
          <input required value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Descripción (opcional)</label>
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>
        <div className={`grid grid-cols-1 ${tab === 'vitrina' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-3`}>
          {tab === 'vitrina' && (
            <div>
              <label className="block text-sm font-medium mb-1">Precio de venta</label>
              <input type="text" inputMode="numeric" required value={formatearPesosInput(precioVenta)} onChange={(e) => setPrecioVenta(soloDigitos(e.target.value))} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Costo (opcional)</label>
            <input type="text" inputMode="numeric" value={formatearPesosInput(costo)} onChange={(e) => setCosto(soloDigitos(e.target.value))} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Stock inicial</label>
            <input type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>
        <button type="submit" className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg py-2 transition">
          Agregar producto
        </button>
      </form>

      <div className="bg-white rounded-2xl shadow p-4">
        <ul className="divide-y divide-gray-100">
          {productosTab.map((p) => {
            const e = editando[p.id] ?? { precio_venta: '', costo: '', stock: '' }
            const cambiado =
              e.precio_venta !== String(p.precio_venta) ||
              e.costo !== (p.costo != null ? String(p.costo) : '') ||
              e.stock !== String(p.stock)
            return (
              <li key={p.id} className="py-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`flex-1 text-sm font-medium ${p.activo ? '' : 'text-gray-400 line-through'}`}>{p.nombre}</span>
                  <button
                    onClick={() => alternarActivo(p)}
                    className={`text-xs px-2 py-1 rounded-full ${p.activo ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
                  >
                    {p.activo ? 'Activo' : 'Inactivo'}
                  </button>
                </div>
                {p.descripcion && <p className="text-xs text-gray-400">{p.descripcion}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  {tab === 'vitrina' && (
                    <label className="text-xs text-gray-500">Precio
                      <input
                        type="text" inputMode="numeric"
                        value={formatearPesosInput(e.precio_venta)}
                        onChange={(ev) => setEditando((prev) => ({ ...prev, [p.id]: { ...e, precio_venta: soloDigitos(ev.target.value) } }))}
                        className="ml-1 w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                      />
                    </label>
                  )}
                  <label className="text-xs text-gray-500">Costo
                    <input
                      type="text" inputMode="numeric"
                      value={formatearPesosInput(e.costo)}
                      onChange={(ev) => setEditando((prev) => ({ ...prev, [p.id]: { ...e, costo: soloDigitos(ev.target.value) } }))}
                      className="ml-1 w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs text-gray-500">Stock
                    <input
                      type="number" min="0" step="1"
                      value={e.stock}
                      onChange={(ev) => setEditando((prev) => ({ ...prev, [p.id]: { ...e, stock: ev.target.value } }))}
                      className="ml-1 w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <button
                    onClick={() => guardarCambios(p.id)}
                    disabled={!cambiado || guardandoId === p.id}
                    className="text-xs px-2 py-1 rounded-lg bg-brand-100 text-brand-700 disabled:opacity-40"
                  >
                    Guardar
                  </button>
                  {p.stock <= 3 && p.activo && (
                    <span className="text-xs text-amber-600 font-medium">⚠ Stock bajo</span>
                  )}
                  {tab === 'interno' && p.activo && consumiendoId !== p.id && (
                    <button
                      onClick={() => abrirConsumo(p)}
                      className="text-xs px-2 py-1 rounded-lg bg-purple-100 text-purple-700 font-medium"
                    >
                      Registrar consumo
                    </button>
                  )}
                </div>

                {consumiendoId === p.id && (
                  <form onSubmit={(e) => registrarConsumo(e, p)} className="border border-purple-200 bg-purple-50/50 rounded-xl p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium mb-1">Cantidad usada</label>
                        <input
                          type="number" min="1" step="1" max={p.stock}
                          value={cantidadConsumo}
                          onChange={(ev) => setCantidadConsumo(ev.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Nota (opcional)</label>
                        <input
                          value={notaConsumo}
                          onChange={(ev) => setNotaConsumo(ev.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button type="submit" disabled={guardandoConsumo} className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg py-2">
                        {guardandoConsumo ? 'Guardando…' : 'Descontar del inventario'}
                      </button>
                      <button type="button" onClick={() => setConsumiendoId(null)} className="px-3 text-sm text-gray-500">
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}
              </li>
            )
          })}
          {productosTab.length === 0 && (
            <li className="py-3 text-sm text-gray-400">
              Aún no hay productos {tab === 'vitrina' ? 'de vitrina' : 'internos'}. Agrega el primero arriba.
            </li>
          )}
        </ul>
      </div>

      {tab === 'interno' && consumos.length > 0 && (
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-sm font-semibold text-gray-600 mb-2">Últimos consumos registrados</h2>
          <ul className="divide-y divide-gray-50">
            {consumos.map((c) => (
              <li key={c.id} className="py-1.5 flex items-center justify-between text-sm">
                <span className="min-w-0 truncate">
                  {c.producto?.nombre ?? 'Producto'} {c.nota ? `· ${c.nota}` : ''}
                </span>
                <span className="shrink-0 text-gray-500 font-medium">-{c.cantidad}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
