// Utilidades de hora "HH:MM".
export function horaAMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function minutosAHora(min: number): string {
  const total = ((min % 1440) + 1440) % 1440
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Hora de término = inicio + duración (minutos).
export function calcularHoraFin(horaInicio: string, duracionMin: number): string {
  return minutosAHora(horaAMinutos(horaInicio) + duracionMin)
}
