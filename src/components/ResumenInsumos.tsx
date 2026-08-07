import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fechaHoy as hoy, haceDias, rangoUTC } from '../lib/fechas'
import type { Prestamo, Producto, Venta } from '../types'

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

interface VentaConProducto extends Venta {
  producto?: Producto
}

interface ResumenProducto {
  nombre: string
  cantidad: number
  total: number
}

interface ResumenPersona {
  persona: string
  items: ResumenProducto[]
  total: number
}

function agruparPorProducto(ventas: VentaConProducto[]): ResumenProducto[] {
  const mapa = new Map<string, ResumenProducto>()
  for (const v of ventas) {
    const nombre = v.producto?.nombre ?? 'Producto'
    const a = mapa.get(v.producto_id) ?? { nombre, cantidad: 0, total: 0 }
    a.cantidad += Number(v.cantidad)
    a.total += Number(v.total)
    mapa.set(v.producto_id, a)
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total)
}

function agruparPorPersona(prestamos: Prestamo[]): ResumenPersona[] {
  const mapa = new Map<string, { persona: string; items: Map<string, ResumenProducto> }>()
  for (const p of prestamos) {
    if (!p.producto_id) continue
    const nombre = p.persona?.nombre ?? 'Sin nombre'
    const entrada = mapa.get(p.persona_id) ?? { persona: nombre, items: new Map() }
    const item = entrada.items.get(p.producto_id) ?? { nombre: p.producto?.nombre ?? 'Producto', cantidad: 0, total: 0 }
    item.cantidad += Number(p.cantidad ?? 0)
    item.total += Number(p.monto ?? 0)
    entrada.items.set(p.producto_id, item)
    mapa.set(p.persona_id, entrada)
  }
  return [...mapa.values()]
    .map((e) => ({ persona: e.persona, items: [...e.items.values()], total: [...e.items.values()].reduce((s, i) => s + i.total, 0) }))
    .sort((a, b) => b.total - a.total || a.persona.localeCompare(b.persona))
}

// Resumen de los 3 destinos de un insumo, en un rango de fechas:
// vendido a clientas (Ventas), fiado/vendido a estilistas (Préstamos tipo
// "insumo", vitrina) y asignado para el trabajo diario (Préstamos tipo
// "insumo_interno", sin costo). Se usa en la subpestaña "Insumos" de
// Contabilidad, para que la dueña sepa a quién se le ha dado qué.
export default function ResumenInsumos() {
  const [desde, setDesde] = useState(haceDias(29))
  const [hasta, setHasta] = useState(hoy())
  const [ventas, setVentas] = useState<VentaConProducto[]>([])
  const [prestamos, setPrestamos] = useState<Prestamo[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCargando(true)
      const rango = rangoUTC(desde, hasta)
      const [{ data: ventasData }, { data: prestData }] = await Promise.all([
        supabase
          .from('ventas')
          .select('*, producto:productos(*)')
          .eq('anulado', false)
          .gte('created_at', rango.desde)
          .lt('created_at', rango.hasta),
        supabase
          .from('prestamos')
          .select('*, persona:profiles!prestamos_persona_id_fkey(nombre), producto:productos(nombre)')
          .in('tipo', ['insumo', 'insumo_interno'])
          .gte('created_at', rango.desde)
          .lt('created_at', rango.hasta)
      ])
      if (!cancelado) {
        setVentas((ventasData as VentaConProducto[]) ?? [])
        setPrestamos((prestData as Prestamo[]) ?? [])
        setCargando(false)
      }
    }
    cargar()
    return () => { cancelado = true }
  }, [desde, hasta])

  const vendidoClientas = useMemo(() => agruparPorProducto(ventas), [ventas])
  const totalVendidoClientas = vendidoClientas.reduce((s, i) => s + i.total, 0)

  const fiadoEstilistas = useMemo(
    () => agruparPorPersona(prestamos.filter((p) => p.tipo === 'insumo')),
    [prestamos]
  )
  const totalFiadoEstilistas = fiadoEstilistas.reduce((s, p) => s + p.total, 0)

  const asignadoInterno = useMemo(
    () => agruparPorPersona(prestamos.filter((p) => p.tipo === 'insumo_interno')),
    [prestamos]
  )
  const totalAsignadoInterno = asignadoInterno.reduce((s, p) => s + p.items.reduce((x, i) => x + i.cantidad, 0), 0)

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div className="flex gap-2 text-xs">
          <button onClick={() => { setDesde(haceDias(6)); setHasta(hoy()) }} className="px-2 py-1 rounded-lg bg-brand-50 text-brand-700">Última semana</button>
          <button onClick={() => { setDesde(haceDias(29)); setHasta(hoy()) }} className="px-2 py-1 rounded-lg bg-brand-50 text-brand-700">Último mes</button>
        </div>
      </div>

      {cargando ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : (
        <>
          {/* 1. Vendido a clientas (vitrina) */}
          <div className="bg-white rounded-2xl shadow p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-gray-600">Vendido a clientas</h2>
              <span className="text-sm font-semibold text-green-700">{pesos(totalVendidoClientas)}</span>
            </div>
            <ul className="space-y-1">
              {vendidoClientas.map((i) => (
                <li key={i.nombre} className="flex justify-between text-sm border-b border-gray-50 pb-1">
                  <span>{i.nombre} <span className="text-gray-400">× {i.cantidad}</span></span>
                  <span className="font-medium">{pesos(i.total)}</span>
                </li>
              ))}
              {vendidoClientas.length === 0 && <li className="text-sm text-gray-400">Sin ventas de vitrina en este rango.</li>}
            </ul>
          </div>

          {/* 2. Fiado/vendido a estilistas (vitrina, con costo — Préstamos) */}
          <div className="bg-white rounded-2xl shadow p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-gray-600">Fiado/vendido a estilistas (vitrina)</h2>
              <span className="text-sm font-semibold text-brand-700">{pesos(totalFiadoEstilistas)}</span>
            </div>
            <div className="space-y-2">
              {fiadoEstilistas.map((p) => (
                <div key={p.persona} className="border-b border-gray-50 pb-2">
                  <p className="text-sm font-medium">{p.persona} <span className="text-gray-400 font-normal">· {pesos(p.total)}</span></p>
                  <ul className="text-xs text-gray-500 pl-2">
                    {p.items.map((i) => (
                      <li key={i.nombre}>{i.nombre} × {i.cantidad} — {pesos(i.total)}</li>
                    ))}
                  </ul>
                </div>
              ))}
              {fiadoEstilistas.length === 0 && <p className="text-sm text-gray-400">Sin insumos fiados en este rango.</p>}
            </div>
          </div>

          {/* 3. Asignado para el trabajo diario (interno, sin costo) */}
          <div className="bg-white rounded-2xl shadow p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-gray-600">Asignado para el trabajo diario (interno)</h2>
              <span className="text-sm font-semibold text-purple-700">{totalAsignadoInterno} unidades</span>
            </div>
            <div className="space-y-2">
              {asignadoInterno.map((p) => (
                <div key={p.persona} className="border-b border-gray-50 pb-2">
                  <p className="text-sm font-medium">{p.persona}</p>
                  <ul className="text-xs text-gray-500 pl-2">
                    {p.items.map((i) => (
                      <li key={i.nombre}>{i.nombre} × {i.cantidad}</li>
                    ))}
                  </ul>
                </div>
              ))}
              {asignadoInterno.length === 0 && <p className="text-sm text-gray-400">Sin insumos asignados en este rango.</p>}
            </div>
          </div>

          <p className="text-xs text-gray-400">
            Del {desde} al {hasta}. "Vendido a clientas" viene de Ventas; "Fiado/vendido a estilistas" y "Asignado
            para el trabajo diario" vienen de Préstamos e insumos fiados, separados por tipo.
          </p>
        </>
      )}
    </div>
  )
}
