import type { Salon } from '../types'

// El logo propio del cliente solo se muestra en Pro/Enterprise. En Básico
// siempre es el logo de KALLOS, aunque el salón ya tenga uno guardado
// (mismo criterio que el color -- ver aplicarTemaSalon en theme.ts).
export function logoParaSalon(salon: Salon | null): string {
  if (salon && salon.plan !== 'basico' && salon.logo_url) return salon.logo_url
  return '/logo.png'
}

// Nombre del negocio en el header: el propio del salón en Pro/Enterprise,
// "KALLOS" en Básico (mismo gate que el logo y el color).
export function nombreParaSalon(salon: Salon | null): string {
  if (salon && salon.plan !== 'basico' && salon.nombre) return salon.nombre
  return 'KALLOS'
}

// Eslogan del header: el propio del salón en Pro/Enterprise (si lo
// definió), el de KALLOS en Básico o si el salón no puso uno.
export function esloganParaSalon(salon: Salon | null): string {
  if (salon && salon.plan !== 'basico' && salon.eslogan) return salon.eslogan
  return 'The order behind the beauty'
}
