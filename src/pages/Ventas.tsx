import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { fechaHoy, rangoDiaUTC } from '../lib/fechas'
import { comprimirImagen } from '../lib/comprimirImagen'
import { formatearPesosInput, soloDigitos } from '../lib/pesos'
import { METODOS_PAGO, type Producto, type Venta, type VentaPago } from '../types'

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

interface VentaConPagos extends Venta {
  pagos: VentaPago[]
}

export default function Ventas() {
  const { profile } = useAuth()
  const [productos, setProductos] = useState<Producto[]>([])
  const [ventasHoy, setVentasHoy] = useState<VentaConPagos[]>([])

  const [productoId, setProductoId] = useState('')
  const [cantidad, setCantidad] = useState('1')
  const [clienteNombre, setClienteNombre] = useState('')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  // Pago del carrito: puede pagarse con varios medios (ej. mitad efectivo,
  // mitad Nequi) en un solo registro de venta.
  const [lineasPago, setLineasPago] = useState<{ key: string; metodo: string; monto: number; foto: File | null }[]>([])
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState('')
  const [foto, setFoto] = useState<File | null>(null)

  async function cargarProductos() {
    const { data } = await supabase.from('productos').select('*').eq('tipo', 'vitrina').eq('activo', true).gt('stock', 0).order('nombre')
    setProductos((data as Producto[]) ?? [])
  }

  async function cargarVentasHoy() {
    const { desde, hasta } = rangoDiaUTC(fechaHoy())
    const { data } = await supabase
      .from('ventas')
      .select('*, producto:productos(*), vendedor:profiles!ventas_vendido_por_fkey(nombre)')
      .gte('created_at', desde)
      .lt('created_at', hasta)
      .order('created_at', { ascending: false })
    const ventas = (data as Venta[]) ?? []
    const ids = ventas.map((v) => v.id)
    const { data: pagosData } = ids.length > 0
      ? await supabase.from('venta_pagos').select('*').in('venta_id', ids)
      : { data: [] as VentaPago[] }
    const pagos = (pagosData as VentaPago[]) ?? []
    setVentasHoy(ventas.map((v) => ({ ...v, pagos: pagos.filter((p) => p.venta_id === v.id) })))
  }

  useEffect(() => {
    cargarProductos()
    cargarVentasHoy()
  }, [])

  const productoSel = productos.find((p) => p.id === productoId)
  const total = productoSel ? Math.round(Number(productoSel.precio_venta) * Number(cantidad || 0)) : 0
  const sumaLineas = lineasPago.reduce((s, l) => s + l.monto, 0) + (Number(monto) > 0 && metodo ? Number(monto) : 0)
  const faltaPorAsignar = total - sumaLineas

  function agregarLineaPago() {
    const valor = Number(monto)
    if (!valor || valor <= 0) { setError('Escribe el monto de este pago.'); return }
    if (!metodo) { setError('Elige el medio de pago.'); return }
    if (metodo !== 'efectivo' && !foto) { setError('Sube la foto del comprobante para este medio.'); return }
    setError(null)
    setLineasPago((prev) => [...prev, { key: crypto.randomUUID(), metodo, monto: valor, foto }])
    setMonto('')
    setMetodo('')
    setFoto(null)
  }

  function quitarLineaPago(key: string) {
    setLineasPago((prev) => prev.filter((l) => l.key !== key))
  }

  async function registrarVenta(e: FormEvent) {
    e.preventDefault()
    if (!profile || !productoSel) return
    setError(null)
    setMensaje(null)
    const cant = Number(cantidad)
    if (!cant || cant <= 0) { setError('La cantidad debe ser mayor a 0.'); return }
    if (cant > productoSel.stock) { setError(`Solo hay ${productoSel.stock} en stock.`); return }

    // Si dejó un medio escrito sin agregarlo a la lista, lo incluimos igual.
    let lineas = lineasPago
    const valorSuelto = Number(monto)
    if (valorSuelto > 0 || metodo) {
      if (!valorSuelto || valorSuelto <= 0) { setError('Escribe el monto del pago.'); return }
      if (!metodo) { setError('Elige el medio de pago.'); return }
      if (metodo !== 'efectivo' && !foto) { setError('Sube la foto del comprobante para este medio.'); return }
      lineas = [...lineasPago, { key: 'actual', metodo, monto: valorSuelto, foto }]
    }
    if (lineas.length === 0) { setError('Agrega el pago de esta venta.'); return }
    const sumaFinal = lineas.reduce((s, l) => s + l.monto, 0)
    if (sumaFinal !== total) {
      setError(`Los pagos suman ${pesos(sumaFinal)}, pero el total es ${pesos(total)}. Ajusta los montos.`)
      return
    }

    setGuardando(true)
    try {
      const { data: ventaCreada, error: insErr } = await supabase.from('ventas').insert({
        salon_id: profile.salon_id,
        producto_id: productoSel.id,
        cantidad: cant,
        precio_unitario: productoSel.precio_venta,
        total,
        cliente_nombre: clienteNombre || null,
        nota: nota || null,
        vendido_por: profile.id
      }).select('id').single()
      if (insErr) throw insErr

      const filas = []
      for (const l of lineas) {
        let fotoUrl: string | null = null
        if (l.foto) {
          const comprimida = await comprimirImagen(l.foto)
          const path = `${profile.salon_id}/ventas/${profile.id}/${Date.now()}_${comprimida.name}`
          const { error: upErr } = await supabase.storage.from('evidencias').upload(path, comprimida)
          if (upErr) throw upErr
          fotoUrl = path
        }
        filas.push({
          venta_id: ventaCreada.id,
          monto: l.monto,
          metodo_pago: l.metodo,
          foto_url: fotoUrl,
          pagado_por: profile.id
        })
      }
      const { error: pagoErr } = await supabase.from('venta_pagos').insert(filas)
      if (pagoErr) throw pagoErr

      setMensaje(`Venta de ${cant} × ${productoSel.nombre} registrada.`)
      setProductoId(''); setCantidad('1'); setClienteNombre(''); setNota('')
      setLineasPago([]); setMonto(''); setMetodo(''); setFoto(null)
      cargarProductos()
      cargarVentasHoy()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la venta.')
    } finally {
      setGuardando(false)
    }
  }

  async function anularVenta(v: Venta) {
    const motivo = prompt('¿Por qué se anula esta venta? (el producto vuelve al inventario)')
    if (motivo === null) return
    await supabase.from('ventas').update({
      anulado: true,
      motivo_anulacion: motivo || null,
      anulado_por: profile?.id,
      anulado_at: new Date().toISOString()
    }).eq('id', v.id)
    cargarProductos()
    cargarVentasHoy()
  }

  // Abre la foto del pago en una pestaña nueva (URL firmada, 5 min).
  async function verFoto(path: string) {
    const { data } = await supabase.storage.from('evidencias').createSignedUrl(path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const totalHoy = useMemo(
    () => ventasHoy.filter((v) => !v.anulado).reduce((s, v) => s + Number(v.total), 0),
    [ventasHoy]
  )

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Ventas de vitrina</h1>
      <p className="text-sm text-gray-500 -mt-4">
        Para cuando una clienta (o cualquiera) compra un producto de la vitrina, distinto del insumo
        fiado a una empleada (eso sigue siendo por Préstamos).
      </p>

      <form onSubmit={registrarVenta} className="bg-white rounded-2xl shadow p-4 space-y-3">
        {error && <div className="text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg p-2">{error}</div>}
        {mensaje && <div className="text-sm bg-green-50 text-green-700 border border-green-200 rounded-lg p-2">{mensaje}</div>}

        <div>
          <label className="block text-sm font-medium mb-1">Producto</label>
          <select required value={productoId} onChange={(e) => setProductoId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2">
            <option value="">Selecciona…</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre} — {pesos(p.precio_venta)} ({p.stock} en stock)</option>
            ))}
          </select>
          {productos.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">No hay productos con stock disponible. Pídele a la dueña que los agregue en Inventario.</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Cantidad</label>
            <input
              type="number" min="1" step="1" required
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              max={productoSel?.stock}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Cliente (opcional)</label>
            <input value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
          </div>
        </div>

        {productoSel && (
          <p className="text-sm font-semibold text-brand-700">Total: {pesos(total)}</p>
        )}

        <div className="border-t border-gray-100 pt-3 space-y-2">
          <h3 className="text-sm font-semibold text-gray-600">Pago</h3>

          {lineasPago.length > 0 && (
            <ul className="space-y-1">
              {lineasPago.map((l) => (
                <li key={l.key} className="flex items-center justify-between text-sm bg-brand-50/50 rounded-lg px-2 py-1.5">
                  <span>{METODOS_PAGO.find((m) => m.valor === l.metodo)?.etiqueta}: {pesos(l.monto)}</span>
                  <button type="button" onClick={() => quitarLineaPago(l.key)} className="text-xs text-red-500">Quitar</button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium mb-1">Monto {lineasPago.length > 0 ? 'de este medio' : ''}</label>
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
            <button type="button" onClick={agregarLineaPago} className="w-full text-xs border border-brand-300 text-brand-700 rounded-lg py-1.5 font-medium">
              + Agregar este medio y sumar otro (ej. el resto en Nequi)
            </button>
          )}

          {productoSel && (
            <p className={`text-xs font-medium ${faltaPorAsignar === 0 ? 'text-green-700' : 'text-amber-600'}`}>
              {faltaPorAsignar === 0 ? '✓ Pago completo' : faltaPorAsignar > 0 ? `Falta por asignar: ${pesos(faltaPorAsignar)}` : `Sobra: ${pesos(-faltaPorAsignar)}`}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Nota (opcional)</label>
          <input value={nota} onChange={(e) => setNota(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
        </div>

        <button type="submit" disabled={guardando || !productoId} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium rounded-lg py-2 transition">
          {guardando ? 'Guardando…' : 'Registrar venta'}
        </button>
      </form>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-500">Ventas de hoy</h2>
          <span className="text-sm font-semibold text-brand-700">Total: {pesos(totalHoy)}</span>
        </div>
        <ul className="space-y-2">
          {ventasHoy.map((v) => (
            <li key={v.id} className={`bg-white rounded-xl shadow-sm p-3 text-sm ${v.anulado ? 'opacity-50' : ''}`}>
              <div className="flex justify-between">
                <span>
                  {v.cantidad} × {v.producto?.nombre ?? 'Producto'}
                  {v.cliente_nombre && <span className="text-gray-400"> · {v.cliente_nombre}</span>}
                  {v.anulado && <span className="text-red-500"> (anulada)</span>}
                </span>
                <span className={v.anulado ? 'line-through text-red-500' : 'font-medium'}>{pesos(Number(v.total))}</span>
              </div>
              <p className="text-xs text-gray-400">{v.vendedor?.nombre}</p>
              {v.pagos.length > 0 && (
                <ul className="text-xs text-green-700 space-y-0.5 mt-1">
                  {v.pagos.map((p) => (
                    <li key={p.id}>
                      ✓ {pesos(Number(p.monto))} en {METODOS_PAGO.find((m) => m.valor === p.metodo_pago)?.etiqueta}
                      {p.foto_url && (
                        <button onClick={() => verFoto(p.foto_url!)} className="ml-1 underline">ver foto</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {profile?.rol === 'superadmin' && !v.anulado && (
                <button onClick={() => anularVenta(v)} className="text-xs text-red-500 mt-1">Anular</button>
              )}
            </li>
          ))}
          {ventasHoy.length === 0 && <li className="text-sm text-gray-400">Aún no hay ventas hoy.</li>}
        </ul>
      </div>
    </div>
  )
}
