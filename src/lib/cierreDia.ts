import { supabase } from './supabaseClient'
import { rangoDiaUTC } from './fechas'

export interface RangoEfectivo {
  desde: string
  hasta: string
  // true si el rango efectivo NO es el día calendario puro -- por un corte
  // de caja temprano el día anterior, o porque este día ya se cerró.
  esDiferenteDelCalendario: boolean
}

// El "día" de caja no siempre coincide con el día calendario: si ya se
// cerró la caja de HOY, lo que se cobre/venda/preste DESPUÉS de ese cierre
// (aunque siga siendo el mismo día calendario) cuenta para el cierre de
// MAÑANA. Y si AYER se cerró temprano, lo que pasó entre ese cierre y la
// medianoche ya contó para ayer, así que el día de HOY arranca justo ahí,
// no a medianoche. Se toma el PRIMER cierre de cada fecha como el corte
// (los siguientes cierres de la misma fecha son correcciones, no un nuevo
// corte). RLS ya limita cierres_caja al salón de quien consulta.
export async function calcularRangoEfectivo(fecha: string): Promise<RangoEfectivo> {
  const calendario = rangoDiaUTC(fecha)
  const ayer = new Date(`${fecha}T00:00:00`)
  ayer.setDate(ayer.getDate() - 1)
  const fechaAyer = ayer.toISOString().slice(0, 10)

  const [{ data: cierreAyer }, { data: cierreHoy }] = await Promise.all([
    supabase.from('cierres_caja').select('created_at').eq('fecha', fechaAyer).order('created_at', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('cierres_caja').select('created_at').eq('fecha', fecha).order('created_at', { ascending: true }).limit(1).maybeSingle()
  ])

  const desde = cierreAyer?.created_at && cierreAyer.created_at > calendario.desde ? cierreAyer.created_at : calendario.desde
  const hasta = cierreHoy?.created_at && cierreHoy.created_at < calendario.hasta ? cierreHoy.created_at : calendario.hasta

  return { desde, hasta, esDiferenteDelCalendario: desde !== calendario.desde || hasta !== calendario.hasta }
}
