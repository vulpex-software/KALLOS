import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fechaHoy as hoy, haceDias, rangoUTC } from '../lib/fechas'
import type { Prestamo, PrestamoPago, Producto, Venta } from '../types'
import ComisionesAbonos from '../components/ComisionesAbonos'
import ResumenInsumos from '../components/ResumenInsumos'

const PORCENTAJE_COMISION = 0.5

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-CO')
}

interface VentaConProducto extends Venta {
  producto?: Producto
}

export default function Contabilidad() {
  const [pestana, setPestana] = useState<'resumen' | 'comisiones' | 'insumos'>('resumen')
  const [desde, setDesde] = useState(haceDias(6))
  const [hasta, setHasta] = useState(hoy())
  const [cargando, setCargando] = useState(true)

  // Valor de los servicios PRESTADOS en el rango (mismo criterio que la
  // comisión del 50%, para que "recaudado - comisión" cuadre siempre).
  const [valorServicios, setValorServicios] = useState(0)
  // Dinero efectivamente COBRADO en el rango (cobros + abonos): es un dato
  // de flujo de caja distinto, puede no coincidir con el valor de arriba
  // porque un servicio de esta semana puede seguir pendiente de cobro, o
  // un abono de esta semana puede ser de una cita de otra semana.
  const [cobradoEnCaja, setCobradoEnCaja] = useState(0)
  const [ventas, setVentas] = useState<VentaConProducto[]>([])
  const [pagoProveedores, setPagoProveedores] = useState(0)
  const [prestamosDadosDinero, setPrestamosDadosDinero] = useState(0)
  const [totalComisiones, setTotalComisiones] = useState(0)

  const [prestamosPendientes, setPrestamosPendientes] = useState<Prestamo[]>([])
  const [pagosPrestamoTodos, setPagosPrestamoTodos] = useState<PrestamoPago[]>([])

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCargando(true)
      const rango = rangoUTC(desde, hasta)
      const [
        { data: cobrosData },
        { data: citasAbono },
        { data: ventasData },
        { data: cierresData },
        { data: prestData },
        { data: registrosData }
      ] = await Promise.all([
        supabase.from('cobros').select('monto').gte('created_at', rango.desde).lt('created_at', rango.hasta),
        supabase.from('citas').select('abono').gt('abono', 0).neq('estado', 'cancelada').gte('created_at', rango.desde).lt('created_at', rango.hasta),
        supabase.from('ventas').select('*, producto:productos(*)').eq('anulado', false).gte('created_at', rango.desde).lt('created_at', rango.hasta),
        supabase.from('cierres_caja').select('proveedor_monto').gte('fecha', desde).lte('fecha', hasta),
        supabase.from('prestamos').select('monto, tipo').eq('tipo', 'dinero').gte('created_at', rango.desde).lt('created_at', rango.hasta),
        supabase.from('registros_trabajo').select('precio_cobrado').eq('anulado', false).gte('created_at', rango.desde).lt('created_at', rango.hasta)
      ])
      if (cancelado) return
      const cobros = (cobrosData as { monto: number }[]) ?? []
      const abonos = (citasAbono as { abono: number }[]) ?? []
      setCobradoEnCaja(cobros.reduce((s, c) => s + Number(c.monto), 0) + abonos.reduce((s, c) => s + Number(c.abono), 0))
      setVentas((ventasData as VentaConProducto[]) ?? [])
      setPagoProveedores(((cierresData as { proveedor_monto: number }[]) ?? []).reduce((s, c) => s + Number(c.proveedor_monto), 0))
      setPrestamosDadosDinero(((prestData as { monto: number }[]) ?? []).reduce((s, p) => s + Number(p.monto), 0))
      const totalServicios = ((registrosData as { precio_cobrado: number }[]) ?? []).reduce((s, r) => s + Number(r.precio_cobrado), 0)
      setValorServicios(totalServicios)
      setTotalComisiones(totalServicios * PORCENTAJE_COMISION)
      setCargando(false)
    }
    cargar()
    return () => { cancelado = true }
  }, [desde, hasta])

  useEffect(() => {
    supabase.from('prestamos').select('*').eq('pagado', false)
      .then(({ data }) => setPrestamosPendientes((data as Prestamo[]) ?? []))
    supabase.from('prestamo_pagos').select('prestamo_id, monto')
      .then(({ data }) => setPagosPrestamoTodos((data as PrestamoPago[]) ?? []))
  }, [])

  const totalPrestadoPendiente = useMemo(() => {
    const pagadoPorPrestamo = new Map<string, number>()
    for (const pg of pagosPrestamoTodos) {
      pagadoPorPrestamo.set(pg.prestamo_id, (pagadoPorPrestamo.get(pg.prestamo_id) ?? 0) + Number(pg.monto))
    }
    return prestamosPendientes.reduce((s, p) => s + Math.max(0, Number(p.monto) - (pagadoPorPrestamo.get(p.id) ?? 0)), 0)
  }, [prestamosPendientes, pagosPrestamoTodos])

  const recaudoVentas = ventas.reduce((s, v) => s + Number(v.total), 0)
  const costoMercancia = ventas.reduce((s, v) => s + Number(v.cantidad) * Number(v.producto?.costo ?? 0), 0)
  // "Recaudado" para efectos de ganancia = valor de lo trabajado (mismo
  // criterio que la comisión) + ventas. Así la cuenta siempre cuadra:
  // Ganancia = Recaudado - Comisión(50% de ese mismo recaudado) - Salidas - Costo.
  const recaudoTotal = valorServicios + recaudoVentas
  const salidas = pagoProveedores + prestamosDadosDinero
  const ganancia = recaudoTotal - salidas - totalComisiones - costoMercancia
  // Cobrado en caja: dinero que ya entró físicamente (cobros + abonos + ventas).
  // Puede diferir de "Recaudado" porque un servicio de este rango aún puede
  // estar pendiente de cobro (ver Cuentas por cobrar), o un abono cobrado en
  // este rango puede ser de una cita agendada para otra fecha.
  const totalCobradoCaja = cobradoEnCaja + recaudoVentas
  const diferenciaCajaVsTrabajo = totalCobradoCaja - recaudoTotal

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <h1 className="text-lg font-semibold">Contabilidad</h1>

      <div className="flex gap-1 bg-white/70 rounded-xl p-1 shadow-sm">
        <button
          onClick={() => setPestana('resumen')}
          className={`flex-1 text-sm font-medium rounded-lg py-2 transition ${pestana === 'resumen' ? 'bg-brand-600 text-white' : 'text-gray-500'}`}
        >
          Resumen financiero
        </button>
        <button
          onClick={() => setPestana('comisiones')}
          className={`flex-1 text-sm font-medium rounded-lg py-2 transition ${pestana === 'comisiones' ? 'bg-brand-600 text-white' : 'text-gray-500'}`}
        >
          Comisiones y abonos
        </button>
        <button
          onClick={() => setPestana('insumos')}
          className={`flex-1 text-sm font-medium rounded-lg py-2 transition ${pestana === 'insumos' ? 'bg-brand-600 text-white' : 'text-gray-500'}`}
        >
          Insumos
        </button>
      </div>

      {pestana === 'comisiones' && <ComisionesAbonos />}
      {pestana === 'insumos' && <ResumenInsumos />}

      {pestana === 'resumen' && (
      <>
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

      {totalPrestadoPendiente > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4">
          <p className="text-xs text-amber-700">Prestado (pendiente de pago) — no depende del rango de fechas</p>
          <p className="text-2xl font-bold text-amber-800">{pesos(totalPrestadoPendiente)}</p>
        </div>
      )}

      {cargando ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-2xl shadow p-4">
              <p className="text-xs text-gray-500">Recaudado (trabajado)</p>
              <p className="text-xl font-bold text-green-700">{pesos(recaudoTotal)}</p>
            </div>
            <div className="bg-white rounded-2xl shadow p-4">
              <p className="text-xs text-gray-500">Salidas</p>
              <p className="text-xl font-bold text-red-600">{pesos(salidas)}</p>
            </div>
            <div className="bg-white rounded-2xl shadow p-4">
              <p className="text-xs text-gray-500">Pago a empleados (50%)</p>
              <p className="text-xl font-bold text-brand-700">{pesos(totalComisiones)}</p>
            </div>
            <div className="bg-white rounded-2xl shadow p-4">
              <p className="text-xs text-gray-500">Ganancia</p>
              <p className={`text-xl font-bold ${ganancia >= 0 ? 'text-green-700' : 'text-red-600'}`}>{pesos(ganancia)}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4 space-y-2">
            <h2 className="text-sm font-semibold text-gray-600">Detalle de recaudo (para la ganancia)</h2>
            <p className="text-xs text-gray-400 -mt-1">
              Valor de lo trabajado en el rango — la misma base sobre la que se calcula el 50% de comisión,
              para que estas cuentas siempre cuadren entre sí.
            </p>
            <div className="flex justify-between text-sm">
              <span>Servicios prestados (valor)</span>
              <span className="font-medium">{pesos(valorServicios)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Ventas de vitrina</span>
              <span className="font-medium">{pesos(recaudoVentas)}</span>
            </div>
            {costoMercancia > 0 && (
              <div className="flex justify-between text-sm text-gray-500">
                <span>Costo de mercancía vendida</span>
                <span>-{pesos(costoMercancia)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-semibold border-t border-gray-100 pt-2">
              <span>Comisión del 50% sobre servicios</span>
              <span className="text-brand-700">-{pesos(totalComisiones)}</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4 space-y-2">
            <h2 className="text-sm font-semibold text-gray-600">Cobrado en caja (flujo de dinero real)</h2>
            <p className="text-xs text-gray-400 -mt-1">
              Esto es lo que efectivamente entró en efectivo/Nequi/etc. en el rango (cobros + abonos + ventas).
              Puede no ser igual al recaudado de arriba: un servicio de esta semana puede seguir pendiente de
              cobro (ver Cuentas por cobrar), o un abono cobrado ahora puede ser de una cita para otra fecha.
            </p>
            <div className="flex justify-between text-sm">
              <span>Total cobrado en caja</span>
              <span className="font-medium">{pesos(totalCobradoCaja)}</span>
            </div>
            {diferenciaCajaVsTrabajo !== 0 && (
              <div className="flex justify-between text-sm text-gray-500">
                <span>{diferenciaCajaVsTrabajo > 0 ? 'De más (abonos/cobros de otras fechas)' : 'Aún falta por cobrar de este rango'}</span>
                <span>{diferenciaCajaVsTrabajo > 0 ? '+' : ''}{pesos(diferenciaCajaVsTrabajo)}</span>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow p-4 space-y-2">
            <h2 className="text-sm font-semibold text-gray-600">Detalle de salidas</h2>
            <div className="flex justify-between text-sm">
              <span>Pago a proveedores</span>
              <span className="font-medium">{pesos(pagoProveedores)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Préstamos de dinero dados</span>
              <span className="font-medium">{pesos(prestamosDadosDinero)}</span>
            </div>
          </div>

          <p className="text-xs text-gray-400">
            Del {desde} al {hasta}. Ganancia = valor de servicios prestados + ventas − 50% de comisión − salidas
            − costo de mercancía vendida. El bloque "Cobrado en caja" es solo de referencia (cuánto dinero entró
            realmente), no afecta la ganancia.
          </p>
        </>
      )}
      </>
      )}
    </div>
  )
}
