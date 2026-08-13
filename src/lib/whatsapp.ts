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

export function mensajeCita(cita: Cita, serviciosNombres?: string[], nombreSalon = 'KALLOS'): string {
  const servicios = serviciosNombres && serviciosNombres.length > 0
    ? serviciosNombres.join(', ')
    : cita.servicio?.nombre ?? ''
  // Sin emojis: en los enlaces de WhatsApp se veían como ◆ en algunos equipos.
  // Los *asteriscos* son negrita en WhatsApp. Texto definido por la dueña.
  const lineas = [
    `*Tu cita quedó agendada*`,
    ``,
    `Servicio: ${servicios}`,
    `Fecha: ${formatearFecha(cita.fecha)}`,
    `Hora: ${formatearHora(cita.hora)}`,
    `Abono: $${Number(cita.abono).toLocaleString('es-CO')}`
  ]
  if (cita.obsequios.length > 0) lineas.push(`Obsequio${cita.obsequios.length > 1 ? 's' : ''}: ${cita.obsequios.join(', ')}`)
  lineas.push(
    ``,
    `*Importante*`,
    ``,
    `* Recuerda asistir sin niños, los amamos, pero por salud y comodidad no te podemos atender con ellos.`,
    `* Recuerda no traer bicicletas.`,
    ``,
    `Te pedimos llegar puntual para brindarte la mejor experiencia y no retrasar nuestra agenda.`,
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

export function linkWhatsApp(cita: Cita, serviciosNombres?: string[], nombreSalon?: string): string {
  const texto = encodeURIComponent(mensajeCita(cita, serviciosNombres, nombreSalon))
  if (cita.cliente_telefono) {
    const numero = normalizarTelefonoCO(cita.cliente_telefono)
    return `https://wa.me/${numero}?text=${texto}`
  }
  // Sin teléfono del cliente: abre el selector de chats de WhatsApp
  // (útil para pegarlo en el grupo del equipo en vez de a un cliente puntual).
  return `https://api.whatsapp.com/send?text=${texto}`
}
