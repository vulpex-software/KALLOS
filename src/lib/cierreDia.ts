import { supabase } from './supabaseClient'
import { rangoDiaUTC } from './fechas'
import type { TipoCierreCaja } from '../types'

export interface RangoEfectivo {
  desde: string
  hasta: string
  // Hora del cierre de AYER, cuando ese cierre ocurrió dentro de ayer y por
  // eso la cola de ayer (lo que entró después) se arrastra a hoy.
  arrastreDeAyer: string | null
  // Hora del cierre de HOY, cuando ya se cerró y por eso lo posterior cuenta
  // para mañana.
  corteDeHoy: string | null
}

// El "día" de caja no siempre coincide con el día calendario: si ya se
// cerró la caja de HOY, lo que se cobre/venda/preste DESPUÉS de ese cierre
// (aunque siga siendo el mismo día calendario) cuenta para el cierre de
// MAÑANA. Y si AYER se cerró temprano (ej. 8pm) pero después siguió
// entrando plata, esa cola quedó fuera del cierre de ayer y se arrastra a
// hoy. Se toma el PRIMER cierre de cada fecha como el corte (los siguientes
// cierres de la misma fecha son correcciones, no un nuevo corte). RLS ya
// limita cierres_caja al salón de quien consulta.
//
// El corte es por tipo de cuadre: cerrar «servicios» no debe cortar
// «abonos» (son dos cuadres independientes), así que cada uno mira solo sus
// propios cierres anteriores.
export async function calcularRangoEfectivo(
  fecha: string,
  tipo: TipoCierreCaja = 'servicios'
): Promise<RangoEfectivo> {
  const calendario = rangoDiaUTC(fecha)
  const ayer = new Date(`${fecha}T00:00:00`)
  ayer.setDate(ayer.getDate() - 1)
  const fechaAyer = ayer.toISOString().slice(0, 10)

  const [{ data: cierreAyer }, { data: cierreHoy }] = await Promise.all([
    supabase.from('cierres_caja').select('created_at').eq('fecha', fechaAyer).eq('tipo', tipo).order('created_at', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('cierres_caja').select('created_at').eq('fecha', fecha).eq('tipo', tipo).order('created_at', { ascending: true }).limit(1).maybeSingle()
  ])

  // El corte de ayer solo arrastra su cola a hoy si de verdad ocurrió ANTES
  // del inicio de hoy. Si el cierre de ayer se guardó HOY (cuadrar el día
  // anterior al día siguiente es normal, la pantalla misma lo ofrece), ese
  // cierre igual cubrió ayer completo y no debe recortarle horas a hoy.
  const arrastreDeAyer = cierreAyer?.created_at && cierreAyer.created_at < calendario.desde
    ? cierreAyer.created_at
    : null
  const corteDeHoy = cierreHoy?.created_at && cierreHoy.created_at < calendario.hasta
    ? cierreHoy.created_at
    : null

  return {
    desde: arrastreDeAyer ?? calendario.desde,
    hasta: corteDeHoy ?? calendario.hasta,
    arrastreDeAyer,
    corteDeHoy
  }
}
