// Utilidades de fecha en la zona horaria del NAVEGADOR (no en UTC).
// Antes se usaba new Date().toISOString() que devuelve UTC y, en Colombia (UTC-5),
// tomaba el día equivocado a ciertas horas.

export function fechaLocal(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

// Fecha de hoy (local), formato YYYY-MM-DD.
export function fechaHoy(): string {
  return fechaLocal(new Date())
}

// Fecha de hace N días (local).
export function haceDias(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return fechaLocal(d)
}

// Rango de instantes UTC que cubre un día LOCAL completo. Sirve para filtrar
// columnas timestamptz (created_at, momento), que se guardan en UTC.
export function rangoDiaUTC(fecha: string): { desde: string; hasta: string } {
  const desde = new Date(`${fecha}T00:00:00`) // string con hora => se interpreta como hora local
  const hasta = new Date(`${fecha}T00:00:00`)
  hasta.setDate(hasta.getDate() + 1)
  return { desde: desde.toISOString(), hasta: hasta.toISOString() }
}

// Rango UTC desde el inicio del día 'desde' hasta el fin del día 'hasta' (ambos locales).
export function rangoUTC(desde: string, hasta: string): { desde: string; hasta: string } {
  const ini = new Date(`${desde}T00:00:00`)
  const fin = new Date(`${hasta}T00:00:00`)
  fin.setDate(fin.getDate() + 1)
  return { desde: ini.toISOString(), hasta: fin.toISOString() }
}
