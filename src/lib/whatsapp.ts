import type { Cita } from '../types'

function formatearFecha(fecha: string) {
  const [anio, mes, dia] = fecha.split('-')
  return `${dia}/${mes}/${anio}`
}

function formatearHora(hora: string) {
  const [h, m] = hora.split(':').map(Number)
  const periodo = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''}${periodo}`
}

// El mismo texto servía para los tres momentos, así que confirmar una cita
// le mandaba a la clienta exactamente el mismo WhatsApp que cuando se
// agendó, y reprogramar tampoco decía que algo había cambiado.
export type TipoMensajeCita = 'agendada' | 'confirmada' | 'reprogramada'

const TITULOS: Record<TipoMensajeCita, string> = {
  agendada: '*Tu cita quedó agendada*',
  confirmada: '*Tu cita está confirmada*',
  reprogramada: '*Tu cita cambió de fecha*'
}

// El bloque "Importante" que va al final del mensaje. Cada salón puede
// guardar el suyo (salones.mensaje_importante); este es el que se usa
// mientras no lo haya cambiado. Los *asteriscos* son negrita en WhatsApp.
export const MENSAJE_IMPORTANTE_POR_DEFECTO = [
  '* Recuerda asistir sin niños, los amamos, pero por salud y comodidad no te podemos atender con ellos.',
  '* Recuerda no traer bicicletas.',
  '',
  'Te pedimos llegar puntual para brindarte la mejor experiencia y no retrasar nuestra agenda.'
].join('\n')

export interface OpcionesMensajeCita {
  servicios?: string[]
  nombreSalon?: string
  // Texto propio del salón para el bloque "Importante". Si viene vacío o
  // null se usa MENSAJE_IMPORTANTE_POR_DEFECTO.
  mensajeImportante?: string | null
  tipo?: TipoMensajeCita
  // Fecha y hora que tenía la cita ANTES de reprogramarla. Sin esto la
  // clienta lee la fecha nueva sin enterarse de que cambió, que es justo lo
  // único que importa de ese mensaje.
  citaAnterior?: { fecha: string; hora: string } | null
}

export function mensajeCita(cita: Cita, opciones: OpcionesMensajeCita = {}): string {
  const { servicios: serviciosNombres, nombreSalon = 'KALLOS', mensajeImportante, tipo = 'agendada', citaAnterior } = opciones
  const servicios = serviciosNombres && serviciosNombres.length > 0
    ? serviciosNombres.join(', ')
    : cita.servicio?.nombre ?? ''

  const cambioDeHorario =
    tipo === 'reprogramada' &&
    !!citaAnterior &&
    (citaAnterior.fecha !== cita.fecha || citaAnterior.hora !== cita.hora)

  // Sin emojis: en los enlaces de WhatsApp se veían como ◆ en algunos equipos.
  const lineas = [TITULOS[tipo], ``, `Servicio: ${servicios}`]
  if (cambioDeHorario && citaAnterior) {
    lineas.push(
      `Antes: ${formatearFecha(citaAnterior.fecha)} a las ${formatearHora(citaAnterior.hora)}`,
      `Ahora: ${formatearFecha(cita.fecha)} a las ${formatearHora(cita.hora)}`
    )
  } else {
    lineas.push(`Fecha: ${formatearFecha(cita.fecha)}`, `Hora: ${formatearHora(cita.hora)}`)
  }
  lineas.push(`Abono: $${Number(cita.abono).toLocaleString('es-CO')}`)
  if (cita.obsequios.length > 0) lineas.push(`Obsequio${cita.obsequios.length > 1 ? 's' : ''}: ${cita.obsequios.join(', ')}`)
  if (tipo === 'confirmada') {
    lineas.push(``, `Te esperamos el ${formatearFecha(cita.fecha)} a las ${formatearHora(cita.hora)}.`)
  }

  const importante = (mensajeImportante ?? '').trim() || MENSAJE_IMPORTANTE_POR_DEFECTO
  lineas.push(
    ``,
    `*Importante*`,
    ``,
    importante,
    ``,
    `Gracias por elegirnos.`,
    ``,
    `*${nombreSalon}*`
  )
  return lineas.join('\n')
}

function normalizarTelefonoCO(telefono: string): string {
  const soloDigitos = telefono.replace(/\D/g, '')
  if (soloDigitos.startsWith('57')) return soloDigitos
  if (soloDigitos.length === 10) return `57${soloDigitos}`
  return soloDigitos
}

export function linkWhatsApp(cita: Cita, opciones: OpcionesMensajeCita = {}): string {
  const texto = encodeURIComponent(mensajeCita(cita, opciones))
  if (cita.cliente_telefono) {
    const numero = normalizarTelefonoCO(cita.cliente_telefono)
    return `https://wa.me/${numero}?text=${texto}`
  }
  // Sin teléfono del cliente: abre el selector de chats de WhatsApp
  // (útil para pegarlo en el grupo del equipo en vez de a un cliente puntual).
  return `https://api.whatsapp.com/send?text=${texto}`
}
